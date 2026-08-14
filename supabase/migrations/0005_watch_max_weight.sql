-- ============================================================================
-- 0005 手表取计划时带上「历史最大重量」(可重复执行)
--
-- 手表记录页原先用「上次做这个动作的重量」预填。实际用起来, 上次那条可能是
-- 减量周、状态差或热身组, 每次都得往上调。改用历史最大重量做默认值更贴近
-- 实际意图: 打开就是自己的最好成绩, 通常只需微调。
--
-- max_weight_kg 直接取自 0001 已有的 v_exercise_pr 视图, 不新增表也不改结构,
-- 只是 CREATE OR REPLACE 覆盖 watch_get_today 的返回内容。
-- last_weight_kg 一并保留, 以后想在手表上并排显示「上次 / 最好」不必再改后端。
-- ============================================================================

create or replace function public.watch_get_today(p_token text, p_weekday int default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid := public.watch_uid_from_token(p_token);
  today date := (now() at time zone 'Asia/Shanghai')::date;
  wd int := coalesce(p_weekday, extract(isodow from (now() at time zone 'Asia/Shanghai'))::int);
  day_row record;
  result jsonb;
begin
  select d.id, d.title, d.weekday into day_row
  from public.plan_days d
  join public.workout_plans p on p.id = d.plan_id
  where d.user_id = uid and p.is_active and d.weekday = wd
  limit 1;

  if day_row.id is null then
    return jsonb_build_object(
      'date', today, 'weekday', wd, 'title', null,
      'exercises', '[]'::jsonb, 'done_count', 0, 'total_count', 0
    );
  end if;

  select jsonb_build_object(
    'date', today,
    'weekday', wd,
    'title', day_row.title,
    'exercises', coalesce(jsonb_agg(x.item order by x.sort_order), '[]'::jsonb),
    'done_count', count(*) filter (where x.done),
    'total_count', count(*)
  ) into result
  from (
    select
      e.sort_order,
      (l.id is not null) as done,
      jsonb_build_object(
        'id',          e.id,
        'exercise',    e.exercise,
        'target_sets', e.target_sets,
        'rep_min',     e.rep_min,
        'rep_max',     e.rep_max,
        'rir_min',     e.rir_min,
        'rir_max',     e.rir_max,
        'rest',        e.rest,
        'cues',        e.cues,
        'equipment',   e.equipment,
        -- 历史最大重量: 手表上作为默认值, 没练过则为 null(手表侧回落到 0)
        'max_weight_kg',  pr.max_weight_kg,
        'best_1rm_kg',    pr.estimated_1rm_kg,
        -- 上次那次的数据, 暂未在手表显示, 保留备用
        'last_weight_kg', v.last_weight_kg,
        'last_sets',      v.last_sets,
        'last_reps',      v.last_reps,
        'last_rir',       v.last_rir,
        -- 今天是否已记录 (完成状态由 workout_logs 推导, 不额外存表)
        'done',           (l.id is not null),
        'done_weight_kg', l.weight_kg,
        'done_sets',      l.sets,
        'done_reps',      l.reps,
        'done_rir',       l.rir
      ) as item
    from public.plan_exercises e
    left join public.v_exercise_last v
      on v.user_id = uid and v.exercise = e.exercise
    left join public.v_exercise_pr pr
      on pr.user_id = uid and pr.exercise = e.exercise
    left join lateral (
      select w.id, w.weight_kg, w.sets, w.reps, w.rir
      from public.workout_logs w
      where w.user_id = uid and w.date = today and w.exercise = e.exercise
      order by w.created_at desc
      limit 1
    ) l on true
    where e.day_id = day_row.id and e.user_id = uid
  ) x;

  return result;
end;
$$;

grant execute on function public.watch_get_today(text, int) to anon, authenticated;

-- ============================================================================
-- 完成
-- ============================================================================
