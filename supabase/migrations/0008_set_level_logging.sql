-- ============================================================================
-- 0008 按组记录 (可重复执行)
--
-- 背景: 原来 workout_logs 一行 = 某天某动作, 只有一组 weight/sets/reps/rir。
--       真实训练是一组一组来的 —— 第三组掉重量、最后一组冲 PR、热身组不该算
--       进容量 —— 这些信息在旧结构里全部丢失。手表 RPC 还按
--       (user_id, date, exercise) 覆盖写, 同一动作重复提交只会互相覆盖。
--
-- 方案: 保留表名, 把粒度降到「一行 = 一组」:
--         set_index     同一天同一动作内的组号, 1 起
--         is_warmup     热身组, 不进容量/PR/平均 RIR
--         rest_sec      这一组做完之后休息了多久 (手表计时器给, 可空)
--         performed_at  这一组做完的时刻 (可空)
--       unique(user_id, date, exercise, set_index) 让手表补传可以直接 upsert,
--       不用再「先 select 最新再 update」。
--
-- 表名不改成 workout_sets: 它出现在导出包的 CSV 文件名、网页的数据种类、
-- AI 提示词与私有文档里, 改名收益是命名精确, 代价是导出格式断代且改动面更大。
--
-- 历史数据: sets=4 的一行展开成 4 行相同数据。逐日 sum(weight_kg*reps) 与迁移
--           前完全一致, 反向 group by 就能还原。展开前自动备份到
--           workout_logs_backup_0008, 回滚有据。
--
-- 兼容: watch_submit_logs 同时认新旧两种 payload —— 手表升级要人工打包 rpk,
--       这份迁移执行后旧版应用还会在跑一段时间, 不能把它写挂。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 备份 (只在第一次执行时建, 重复执行不覆盖已有备份)
-- ----------------------------------------------------------------------------
create table if not exists public.workout_logs_backup_0008 as
  select * from public.workout_logs;

-- ----------------------------------------------------------------------------
-- 2. 新列
-- ----------------------------------------------------------------------------
alter table public.workout_logs
  add column if not exists set_index    integer,
  add column if not exists is_warmup    boolean not null default false,
  add column if not exists rest_sec     integer,
  add column if not exists performed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workout_logs_rest_sec_check'
  ) then
    alter table public.workout_logs
      add constraint workout_logs_rest_sec_check
      check (rest_sec is null or rest_sec between 0 and 3600);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'workout_logs_set_index_check'
  ) then
    alter table public.workout_logs
      add constraint workout_logs_set_index_check
      check (set_index between 1 and 50);
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3. 展开历史: 一行 sets=N -> N 行
--
--    同一 (user_id, date, exercise) 下原本可能有多行 (网页重复录入过),
--    所以组号要按 created_at 顺序累加偏移, 否则 unique 会撞。
--    只处理 set_index is null 的行 => 重复执行不会二次展开。
-- ----------------------------------------------------------------------------
do $$
begin
  -- sets 列已经删掉 = 展开做过了, 直接跳过
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'workout_logs'
       and column_name  = 'sets'
  ) then
    raise notice '[0008] sets 列已不存在, 跳过历史展开';
    return;
  end if;

  if not exists (select 1 from public.workout_logs where set_index is null) then
    raise notice '[0008] 没有待展开的行, 跳过';
    return;
  end if;

  -- 一条语句里同时做两件事, 用的是同一个快照, 所以偏移量算一次就够:
  --   upd  把原行改成它那一段的第 1 组
  --   主体 补出第 2..n 组 (复制原行)
  --
  -- 走 EXECUTE 是必须的: sets 列在下面第 5 节会被删掉, 静态 SQL 在第二次执行
  -- 这份迁移时连解析都过不去。动态 SQL 每次重新规划, 也顺带避开了
  -- 「临时表 + plpgsql 缓存计划」那类坑。
  --
  -- notes 只留在第 1 组上 —— 同一句话抄四遍纯属噪音。
  -- created_at 沿用原行, 排序稳定; performed_at 留空, 历史确实不知道。
  execute $sql$
    with src as (
      select
        id,
        greatest(coalesce(sets, 1), 1) as n,
        coalesce(
          sum(greatest(coalesce(sets, 1), 1)) over (
            partition by user_id, date, exercise
            order by created_at, id
            rows between unbounded preceding and 1 preceding
          ),
          0
        ) as offset_before
      from public.workout_logs
      where set_index is null
    ),
    upd as (
      update public.workout_logs w
         set set_index = s.offset_before + 1
        from src s
       where w.id = s.id
      returning w.id
    )
    insert into public.workout_logs
      (user_id, date, workout_day, exercise, weight_kg, reps, rir, notes,
       source, set_index, is_warmup, created_at, updated_at)
    select
      w.user_id, w.date, w.workout_day, w.exercise, w.weight_kg, w.reps, w.rir,
      null, w.source, s.offset_before + g.k, false, w.created_at, w.updated_at
    from src s
    join public.workout_logs w on w.id = s.id
    cross join lateral generate_series(2, s.n) as g(k)
  $sql$;

  raise notice '[0008] 历史展开完成';
end $$;

-- ----------------------------------------------------------------------------
-- 4. 收紧约束
-- ----------------------------------------------------------------------------
update public.workout_logs set set_index = 1 where set_index is null;

alter table public.workout_logs
  alter column set_index set default 1,
  alter column set_index set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workout_logs_set_uniq'
  ) then
    alter table public.workout_logs
      add constraint workout_logs_set_uniq
      unique (user_id, date, exercise, set_index);
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 5. 丢掉 sets 列
--    v_exercise_last 引用了它, 得先拆掉视图; 下面第 6 节按新语义重建。
--    三个手表函数里也提到 sets, 它们是 plpgsql, 不构成依赖, 但会在运行时报错
--    —— 本迁移第 7 节把三个全部替换掉了。
-- ----------------------------------------------------------------------------
drop view if exists public.v_exercise_last;
alter table public.workout_logs drop column if exists sets;

comment on table public.workout_logs is
  '训练记录, 一行 = 某天某动作的第 set_index 组 (0008 起从「一行一个动作」降到「一行一组」)';

-- ----------------------------------------------------------------------------
-- 6. 视图
-- ----------------------------------------------------------------------------

-- 6.1 PR: 逐组算反而更准 (原来 4×8 只贡献一个点)。热身组排除在外。
create or replace view public.v_exercise_pr as
select
  user_id,
  exercise,
  max(weight_kg) as max_weight_kg,
  max(weight_kg * (1 + reps::numeric / 30)) as estimated_1rm_kg,
  max(date) as last_achieved_date
from public.workout_logs
where weight_kg is not null and reps is not null and reps > 0
  and not is_warmup
group by user_id, exercise;

-- 6.2 上一次做这个动作的汇总。
--     注意列名与旧版逐一对齐 (last_date/last_weight_kg/last_sets/last_reps/last_rir),
--     网页的 today-plan-logger 与 watch_get_today 因此完全不用改。
--     语义从「最后一条记录」变成「最近一天的汇总」—— 降到按组之后,
--     distinct on 只会拿到最后一组, 那不是「上次练了多少」。
create view public.v_exercise_last
with (security_invoker = true) as
with day_agg as (
  select
    user_id, exercise, date,
    count(*) filter (where not is_warmup)       as work_sets,
    max(weight_kg) filter (where not is_warmup) as top_weight_kg
  from public.workout_logs
  group by user_id, exercise, date
),
last_day as (
  select distinct on (user_id, exercise)
         user_id, exercise, date, work_sets, top_weight_kg
    from day_agg
   order by user_id, exercise, date desc
)
select
  l.user_id,
  l.exercise,
  l.date                as last_date,
  l.top_weight_kg       as last_weight_kg,
  l.work_sets::integer  as last_sets,
  t.reps                as last_reps,
  t.rir                 as last_rir
from last_day l
left join lateral (
  -- 最重的那一组 (并列时取靠后的), 它的次数与 RIR 最能代表这次的强度
  select w.reps, w.rir
    from public.workout_logs w
   where w.user_id = l.user_id
     and w.exercise = l.exercise
     and w.date = l.date
     and not w.is_warmup
   order by w.weight_kg desc nulls last, w.set_index desc
   limit 1
) t on true;

-- 6.3 一次训练里某个动作的汇总。
--     网页列表、力量曲线、AI 分析都读它 —— 按组存下来之后, 直接画原始行会把
--     一天的 4 组画成 4 个重叠的点, 且喂给 AI 的行数翻好几倍。
-- 先 drop 再 create: create or replace view 不允许在中间插列, 这个视图以后大概率
-- 还会加字段, 留着 replace 早晚会让「可重复执行」这条断掉
drop view if exists public.v_exercise_sessions;
create view public.v_exercise_sessions
with (security_invoker = true) as
select
  w.user_id,
  w.date,
  w.exercise,
  min(w.workout_day)                                            as workout_day,
  count(*) filter (where not w.is_warmup)::integer              as sets,
  count(*) filter (where w.is_warmup)::integer                  as warmup_sets,
  max(w.weight_kg) filter (where not w.is_warmup)               as top_weight_kg,
  -- 这次训练里最好的一组折算成 1RM (Epley)。力量曲线画的是它 ——
  -- 只看最大重量的话, 同样 60kg 做 5 次和做 10 次看不出区别
  max(w.weight_kg * (1 + w.reps::numeric / 30))
    filter (where not w.is_warmup and w.reps > 0)               as best_1rm_kg,
  sum(w.reps) filter (where not w.is_warmup)::integer           as total_reps,
  sum(w.weight_kg * w.reps) filter (where not w.is_warmup)      as volume_kg,
  round(avg(w.rir) filter (where not w.is_warmup), 1)           as avg_rir,
  sum(w.rest_sec) filter (where not w.is_warmup)::integer       as rest_total_sec,
  -- 掉重量 = 最后一个工作组比当天最重的那组轻。力竭减重与线性递增在这里分得开。
  coalesce(
    max(w.weight_kg) filter (where not w.is_warmup)
      > (array_agg(w.weight_kg order by w.set_index desc)
           filter (where not w.is_warmup))[1],
    false
  ) as dropped
from public.workout_logs w
group by w.user_id, w.date, w.exercise;

-- ----------------------------------------------------------------------------
-- 7. plan_exercises.rest_sec — 组间休息时长, 给手表计时器用
--
--    原来的 rest 是自由文本 ("2-3分钟" / "60-90秒"), 人能看懂, 手表用不了。
--    保留 rest 原样, 另加一个数字列, 并从旧文本尽力回填:
--      "90秒" -> 90   "60-90秒" -> 60   "2-3分钟" -> 120   解析不出 -> null
--    区间一律取下界, 宁短勿长 —— 休息不够可以接着等, 多等一分钟很难受。
--    手表侧对 null 用 90 秒兜底。
-- ----------------------------------------------------------------------------
alter table public.plan_exercises
  add column if not exists rest_sec integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'plan_exercises_rest_sec_check'
  ) then
    alter table public.plan_exercises
      add constraint plan_exercises_rest_sec_check
      check (rest_sec is null or rest_sec between 0 and 3600);
  end if;
end $$;

-- 只填还没值的行 => 重复执行不会覆盖用户后来手动改过的数字
update public.plan_exercises
   set rest_sec = least(
         case
           when rest ~ '分' then (substring(rest from '(\d+)'))::integer * 60
           else                  (substring(rest from '(\d+)'))::integer
         end,
         3600)
 where rest_sec is null
   and rest is not null
   and rest ~ '\d';

-- ----------------------------------------------------------------------------
-- 8. 手表: 提交训练记录
--
--    新格式 (v1.3 起) 一条 = 一组:
--      {"exercise":"卧推","set_index":3,"weight_kg":55,"reps":7,"rir":0,
--       "is_warmup":false,"rest_sec":95,"performed_at":"2026-08-15T10:21:00Z",
--       "workout_day":"推日","date":"2026-08-15"}
--
--    旧格式 (v1.2 及以前) 一条 = 整个动作, 没有 set_index:
--      {"exercise":"卧推","weight_kg":60,"sets":4,"reps":8,"rir":2,...}
--    仍然要认 —— 手表升级得人工打包 rpk, 这份迁移上线后旧应用还会跑一阵。
--    旧格式沿用原来的覆盖语义: 先删掉这个动作当天所有组, 再按 sets 展开重写。
-- ----------------------------------------------------------------------------
create or replace function public.watch_submit_logs(p_token text, p_logs jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid := public.watch_uid_from_token(p_token);
  today date := (now() at time zone 'Asia/Shanghai')::date;
  rec jsonb;
  d date;
  n int := 0;        -- 写进去的组数
  legacy int := 0;   -- 其中走旧格式的条目数
  total_sets int;
begin
  if jsonb_typeof(p_logs) <> 'array' then
    raise exception 'p_logs must be a json array';
  end if;

  for rec in select * from jsonb_array_elements(p_logs)
  loop
    d := coalesce(nullif(rec->>'date','')::date, today);

    if nullif(rec->>'set_index','') is not null then
      -- ---- 新格式: 一条 = 一组 ----------------------------------------
      insert into public.workout_logs
        (user_id, date, workout_day, exercise, set_index,
         weight_kg, reps, rir, is_warmup, rest_sec, performed_at, notes, source)
      values (
        uid, d,
        nullif(rec->>'workout_day',''),
        rec->>'exercise',
        (rec->>'set_index')::int,
        nullif(rec->>'weight_kg','')::numeric,
        nullif(rec->>'reps','')::int,
        nullif(rec->>'rir','')::int,
        coalesce(nullif(rec->>'is_warmup','')::boolean, false),
        nullif(rec->>'rest_sec','')::int,
        nullif(rec->>'performed_at','')::timestamptz,
        nullif(rec->>'notes',''),
        'watch'
      )
      on conflict (user_id, date, exercise, set_index) do update
        set weight_kg    = excluded.weight_kg,
            reps         = excluded.reps,
            rir          = excluded.rir,
            is_warmup    = excluded.is_warmup,
            -- rest_sec / performed_at 常常是下一次提交才补上来的,
            -- 传 null 时不要把已经写好的值抹掉
            rest_sec     = coalesce(excluded.rest_sec, workout_logs.rest_sec),
            performed_at = coalesce(excluded.performed_at, workout_logs.performed_at),
            workout_day  = coalesce(excluded.workout_day, workout_logs.workout_day),
            notes        = coalesce(excluded.notes, workout_logs.notes),
            source       = 'watch',
            updated_at   = now();
      n := n + 1;

    else
      -- ---- 旧格式: 一条 = 整个动作, 覆盖语义 ---------------------------
      total_sets := greatest(coalesce(nullif(rec->>'sets','')::int, 1), 1);

      delete from public.workout_logs
       where user_id = uid and date = d and exercise = (rec->>'exercise');

      insert into public.workout_logs
        (user_id, date, workout_day, exercise, set_index,
         weight_kg, reps, rir, notes, source)
      select
        uid, d,
        nullif(rec->>'workout_day',''),
        rec->>'exercise',
        g.k,
        nullif(rec->>'weight_kg','')::numeric,
        nullif(rec->>'reps','')::int,
        nullif(rec->>'rir','')::int,
        case when g.k = 1 then nullif(rec->>'notes','') end,
        'watch'
      from generate_series(1, total_sets) as g(k);

      n := n + total_sets;
      legacy := legacy + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'written', n, 'legacy', legacy);
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. 手表: 整周计划 + 增量校验 (0006 的按组版)
--
--    变的只有两处:
--      today_done  从 {动作: {weight_kg,sets,reps,rir}}
--                  改成 {动作: {done_sets: n, sets: [每组明细]}}
--      exercises[] 增加 rest_sec, 手表拿它当倒计时长度
--
--    版本号公式不用动: rest_sec 改动会通过触发器带动 plan_exercises.updated_at,
--    而 updated_at 本来就在哈希里。
-- ----------------------------------------------------------------------------
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
  -- ---- 版本号 (与 0006 相同) --------------------------------------------
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

  -- ---- 今天已经记了哪些组 -----------------------------------------------
  -- 不限于今天这个训练日的动作: 手表可以手动切训练日, 切过去也要能看到进度
  select coalesce(jsonb_object_agg(t.exercise, t.info), '{}'::jsonb) into done
  from (
    select
      w.exercise,
      jsonb_build_object(
        'done_sets', count(*) filter (where not w.is_warmup),
        'sets', jsonb_agg(
                  jsonb_build_object(
                    'set_index', w.set_index,
                    'weight_kg', w.weight_kg,
                    'reps',      w.reps,
                    'rir',       w.rir,
                    'is_warmup', w.is_warmup
                  ) order by w.set_index
                )
      ) as info
    from public.workout_logs w
    where w.user_id = uid and w.date = today
    group by w.exercise
  ) t;

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

  -- ---- 版本变了(或第一次要): 回整周 -------------------------------------
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
                       'rest_sec',      e.rest_sec,
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

-- ----------------------------------------------------------------------------
-- 10. 手表: 单日接口 (只有装着旧版应用、且后端没有 watch_get_week 时才会走到)
--     不扩展成按组, 只把 done_* 改成当天的汇总口径, 保证旧应用不报错。
-- ----------------------------------------------------------------------------
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
      coalesce(l.done_sets, 0) > 0 as done,
      jsonb_build_object(
        'id',          e.id,
        'exercise',    e.exercise,
        'target_sets', e.target_sets,
        'rep_min',     e.rep_min,
        'rep_max',     e.rep_max,
        'rir_min',     e.rir_min,
        'rir_max',     e.rir_max,
        'rest',        e.rest,
        'rest_sec',    e.rest_sec,
        'cues',        e.cues,
        'equipment',   e.equipment,
        'max_weight_kg',  pr.max_weight_kg,
        'best_1rm_kg',    pr.estimated_1rm_kg,
        'last_weight_kg', v.last_weight_kg,
        'last_sets',      v.last_sets,
        'last_reps',      v.last_reps,
        'last_rir',       v.last_rir,
        -- 今天的完成情况: 按组汇总后再回填成旧字段名, 旧应用照常能解析
        'done',           coalesce(l.done_sets, 0) > 0,
        'done_weight_kg', l.top_weight_kg,
        'done_sets',      l.done_sets,
        'done_reps',      l.top_reps,
        'done_rir',       l.top_rir
      ) as item
    from public.plan_exercises e
    left join public.v_exercise_last v
      on v.user_id = uid and v.exercise = e.exercise
    left join public.v_exercise_pr pr
      on pr.user_id = uid and pr.exercise = e.exercise
    left join lateral (
      select
        count(*) filter (where not s.is_warmup)::int        as done_sets,
        max(s.weight_kg) filter (where not s.is_warmup)     as top_weight_kg,
        (array_agg(s.reps order by s.weight_kg desc nulls last, s.set_index desc)
           filter (where not s.is_warmup))[1]               as top_reps,
        (array_agg(s.rir  order by s.weight_kg desc nulls last, s.set_index desc)
           filter (where not s.is_warmup))[1]               as top_rir
      from public.workout_logs s
      where s.user_id = uid and s.date = today and s.exercise = e.exercise
    ) l on true
    where e.day_id = day_row.id and e.user_id = uid
  ) x;

  return result;
end;
$$;

-- ----------------------------------------------------------------------------
-- 11. 授权 (与 0004 一致, replace 之后重新授一次更保险)
-- ----------------------------------------------------------------------------
grant execute on function public.watch_get_today(text, int)     to anon, authenticated;
grant execute on function public.watch_get_week(text, text)     to anon, authenticated;
grant execute on function public.watch_submit_logs(text, jsonb) to anon, authenticated;

-- ============================================================================
-- 完成
--
-- 确认迁移成功 (应当全部为 t):
--   select count(*) = 0 from public.workout_logs where set_index is null;
--   select bool_and(v.ok) from (
--     select b.date, sum(b.weight_kg * b.reps * greatest(coalesce(b.sets,1),1))
--            = (select sum(w.weight_kg * w.reps) from public.workout_logs w
--                where w.date = b.date and w.user_id = b.user_id) as ok
--       from public.workout_logs_backup_0008 b
--      group by b.user_id, b.date
--   ) v;
--
-- 备份表确认无误后可以删掉:
--   drop table public.workout_logs_backup_0008;
-- ============================================================================
