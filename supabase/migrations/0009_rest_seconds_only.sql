-- ============================================================================
-- 0009 休息时长只留秒数 (可重复执行)
--
-- 0008 加 rest_sec 时把原来的自由文本 rest 一并留着, 想着「一个给人看、一个给
-- 手表用」。实际用下来这是个错误: 同一件事两个字段, 填计划时要写两遍, 两边还
-- 可能对不上 —— 到底以哪个为准? 而且 "120秒" 本来就一眼能看懂, 没什么需要
-- 额外用文本表达的。
--
-- 所以砍掉 rest, 只留 rest_sec。
-- 删之前再兜底回填一次: 0008 之后新加的动作可能只填了文本没填秒数。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 兜底回填 (规则与 0008 一致: 区间取下界, 带"分"的乘 60)
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'plan_exercises'
       and column_name  = 'rest'
  ) then
    execute $sql$
      update public.plan_exercises
         set rest_sec = least(
               case
                 when rest ~ '分' then (substring(rest from '(\d+)'))::integer * 60
                 else                  (substring(rest from '(\d+)'))::integer
               end,
               3600)
       where rest_sec is null
         and rest is not null
         and rest ~ '\d'
    $sql$;
    raise notice '[0009] rest -> rest_sec 兜底回填完成';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. 丢掉 rest 列
--    watch_get_today 里引用了 e.rest, 下面第 3 节把它替换掉;
--    plpgsql 不构成依赖, 所以这里可以直接删。
-- ----------------------------------------------------------------------------
alter table public.plan_exercises drop column if exists rest;

comment on column public.plan_exercises.rest_sec is
  '组间休息秒数; 空则手表按 90 秒兜底 (0009 起这是唯一的休息时长字段)';

-- ----------------------------------------------------------------------------
-- 3. 手表单日接口: 去掉 rest 字段
--    只有装着旧版应用、且后端没有 watch_get_week 时才会走到这里。
--    watch_get_week 本来就只发 rest_sec, 不用动。
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

grant execute on function public.watch_get_today(text, int) to anon, authenticated;

-- ============================================================================
-- 完成
-- ============================================================================
