-- ============================================================================
-- 0006 手表一次取一周计划 + 版本号增量校验 (可重复执行)
--
-- 背景: 手表没有 Wi-Fi, 走蓝牙经手机上网, 而转发服务多半只在家/校园网可达。
--       原来每次只缓存「今天」一天, 换一天就得联网, 出门基本用不了。
--
-- 方案: watch_get_week 一次返回整周计划, 手表整份缓存;
--       每次联网时把上次的 version 带上来 ——
--         version 相同 -> 只回 { unchanged: true, today_done: {...} }, 约 200 字节
--         version 不同 -> 回整周计划, 手表整份覆盖旧缓存(单键覆盖, 不堆垃圾)
--
-- version 覆盖两类会影响手表显示的东西:
--   1. 计划结构: plan_days / plan_exercises 的内容与 updated_at
--   2. 预填用的历史最大重量 (v_exercise_pr.max_weight_kg), 破 PR 后要跟着变
--   刻意不含「今天做了什么」—— 那是每天都在变的动态数据, 放进版本号会让
--   缓存天天失效; 它由 today_done 每次单独回传, 很小。
--
-- 返回结构:
--   {
--     "version": "<md5>",
--     "unchanged": false,
--     "date": "2026-08-14", "weekday": 5,
--     "days": { "1": { "title": "...", "exercises": [ ... ] }, ... },  // unchanged 时不含
--     "today_done": { "卧推": {"weight_kg":60,"sets":4,"reps":8,"rir":2} }
--   }
--
-- days 里只放手表真正显示的字段 (动作名/目标组次/RIR 区间/历史最大重量),
-- rest / cues / equipment / id 一概不带 —— 一周七天的量, 能省则省。
-- 没有安排的周几直接不出现在 days 里, 手表侧视为休息日。
--
-- 旧的 watch_get_today 保留不动: 装着旧版应用的手表还在调它, 且新版在
-- 本函数不存在时(比如这份迁移还没执行)会回落到它。
-- ============================================================================

create or replace function public.watch_get_week(p_token text, p_version text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid := public.watch_uid_from_token(p_token);
  today date := (now() at time zone 'Asia/Shanghai')::date;
  wd int := extract(isodow from (now() at time zone 'Asia/Shanghai'))::int;
  ver text;
  days jsonb;
  done jsonb;
begin
  -- ---- 版本号 ----------------------------------------------------------
  -- 把所有影响显示的东西拼成一行再 md5; 顺序固定(order by), 否则同样的数据
  -- 也可能算出不同的版本号, 缓存就白做了
  select md5(coalesce(string_agg(s.x, '|' order by s.x), '')) into ver
  from (
    select 'd:' || d.weekday::text || ':' || d.title || ':' || d.updated_at::text as x
      from public.plan_days d
      join public.workout_plans p on p.id = d.plan_id
     where d.user_id = uid and p.is_active
    union all
    select 'e:' || e.id::text || ':' || e.updated_at::text
      from public.plan_exercises e
      join public.plan_days d on d.id = e.day_id
      join public.workout_plans p on p.id = d.plan_id
     where e.user_id = uid and p.is_active
    union all
    -- 只算计划里出现过的动作, 别的动作破了 PR 不该让整周缓存失效
    select 'pr:' || pr.exercise || ':' || coalesce(pr.max_weight_kg::text, '')
      from public.v_exercise_pr pr
     where pr.user_id = uid
       and exists (
             select 1
               from public.plan_exercises e2
               join public.plan_days d2 on d2.id = e2.day_id
               join public.workout_plans p2 on p2.id = d2.plan_id
              where e2.user_id = uid and p2.is_active and e2.exercise = pr.exercise
           )
  ) s;

  -- ---- 今天已记录的动作 -------------------------------------------------
  -- 不限于今天这个训练日的动作: 手表可以手动切训练日, 切过去也要能看到打勾
  select coalesce(
           jsonb_object_agg(
             w.exercise,
             jsonb_build_object(
               'weight_kg', w.weight_kg,
               'sets',      w.sets,
               'reps',      w.reps,
               'rir',       w.rir
             )
           ),
           '{}'::jsonb
         )
    into done
  from (
    select distinct on (exercise) exercise, weight_kg, sets, reps, rir
      from public.workout_logs
     where user_id = uid and date = today
     order by exercise, created_at desc
  ) w;

  -- ---- 版本没变: 只回动态部分 -------------------------------------------
  if p_version is not null and p_version = ver then
    return jsonb_build_object(
      'version', ver,
      'unchanged', true,
      'date', today,
      'weekday', wd,
      'today_done', done
    );
  end if;

  -- ---- 版本变了(或手表第一次要): 回整周 ---------------------------------
  select coalesce(jsonb_object_agg(t.weekday::text, t.day), '{}'::jsonb) into days
  from (
    select
      d.weekday,
      jsonb_build_object(
        'title', d.title,
        'exercises', coalesce(
          (
            select jsonb_agg(
                     jsonb_build_object(
                       'exercise',      e.exercise,
                       'target_sets',   e.target_sets,
                       'rep_min',       e.rep_min,
                       'rep_max',       e.rep_max,
                       'rir_min',       e.rir_min,
                       'rir_max',       e.rir_max,
                       'max_weight_kg', pr.max_weight_kg
                     )
                     order by e.sort_order
                   )
              from public.plan_exercises e
              left join public.v_exercise_pr pr
                on pr.user_id = uid and pr.exercise = e.exercise
             where e.day_id = d.id and e.user_id = uid
          ),
          '[]'::jsonb
        )
      ) as day
    from public.plan_days d
    join public.workout_plans p on p.id = d.plan_id
   where d.user_id = uid and p.is_active
  ) t;

  return jsonb_build_object(
    'version', ver,
    'unchanged', false,
    'date', today,
    'weekday', wd,
    'days', days,
    'today_done', done
  );
end;
$$;

grant execute on function public.watch_get_week(text, text) to anon, authenticated;

-- ============================================================================
-- 完成
-- ============================================================================
