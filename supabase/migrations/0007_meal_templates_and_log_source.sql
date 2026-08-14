-- ============================================================================
-- 0007 两件事 (可重复执行)
--
--   1. meal_templates      「常吃套餐」—— 存几个固定组合, 一点即填
--   2. workout_logs.source  记录来源 (web / watch), 在网页上一眼认出表上记的
--
-- 两者互不相干, 放在一次迁移里只是省得跑两遍。
--
-- 注意第 2 条: 手表端一行代码都不用改, 也不用重新打包 —— 来源是服务端在
-- watch_submit_logs 里盖的章, 手表照旧调同一个 RPC。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 常吃套餐
--
-- 现有的「一键套用最近某天」解决的是「昨天吃了啥」, 但日常饮食其实是几个
-- 固定组合轮着来(工作日常规 / 练后加餐 / 出差将就)。存成模板比每次翻历史准。
--
-- 只存描述文本, 不存营养值 —— 营养由 AI 在提交时按当天实际描述重新估算,
-- 模板只是省掉打字。
-- ----------------------------------------------------------------------------
create table if not exists public.meal_templates (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,                       -- 如 "工作日常规"
  description text not null,                       -- 自然语言, 与 meal_logs.description 同格式
  meal_type   text not null default 'all_day'
              check (meal_type in ('all_day','breakfast','lunch','dinner','snack')),
  sort_order  integer not null default 0,
  use_count   integer not null default 0,          -- 用过几次, 用来把常用的排前面
  last_used_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 排序口径: 手动 sort_order 优先, 其次按最近用过、用得多
create index if not exists idx_meal_templates_user
  on public.meal_templates (user_id, sort_order, last_used_at desc nulls last);

alter table public.meal_templates enable row level security;

drop policy if exists "mt_all_own" on public.meal_templates;
create policy "mt_all_own" on public.meal_templates
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists trg_meal_templates_updated_at on public.meal_templates;
create trigger trg_meal_templates_updated_at
  before update on public.meal_templates
  for each row execute function public.set_updated_at();

-- 用一次: 计数 +1 并记时间, 供排序用。放进函数里省一次往返, 也保证原子。
create or replace function public.touch_meal_template(p_id uuid)
returns void
language plpgsql
security invoker
as $$
begin
  update public.meal_templates
     set use_count = use_count + 1,
         last_used_at = now()
   where id = p_id and user_id = auth.uid();
end;
$$;

grant execute on function public.touch_meal_template(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. 训练记录来源
--
-- 手表和网页写的是同一张表, 原先分不出来。实际痛点: 表上转表冠难免记错一位
-- (62.5 记成 6.25), 回家想核对却不知道该看哪几条。有了来源就能只复核手表那批。
--
-- 默认 'web': 历史数据与网页写入都归到 web; 手表侧由 watch_submit_logs 写 'watch'。
-- ----------------------------------------------------------------------------
alter table public.workout_logs
  add column if not exists source text not null default 'web';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workout_logs_source_check'
  ) then
    alter table public.workout_logs
      add constraint workout_logs_source_check check (source in ('web','watch'));
  end if;
end $$;

create index if not exists idx_workout_logs_user_source
  on public.workout_logs (user_id, source, date desc);

-- 手表提交时打上来源标记。
-- 覆盖语义不变: 同一天同一动作重复提交仍是更新而非新增, 但更新时也会把
-- source 改成 watch —— 以「最后一次是谁写的」为准, 与其它字段口径一致。
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
  existing_id uuid;
  n int := 0;
begin
  if jsonb_typeof(p_logs) <> 'array' then
    raise exception 'p_logs must be a json array';
  end if;

  for rec in select * from jsonb_array_elements(p_logs)
  loop
    d := coalesce((rec->>'date')::date, today);

    select id into existing_id
    from public.workout_logs
    where user_id = uid and date = d and exercise = (rec->>'exercise')
    order by created_at desc
    limit 1;

    if existing_id is not null then
      update public.workout_logs
         set weight_kg   = nullif(rec->>'weight_kg','')::numeric,
             sets        = nullif(rec->>'sets','')::int,
             reps        = nullif(rec->>'reps','')::int,
             rir         = nullif(rec->>'rir','')::int,
             workout_day = coalesce(nullif(rec->>'workout_day',''), workout_day),
             source      = 'watch'
       where id = existing_id;
    else
      insert into public.workout_logs
        (user_id, date, workout_day, exercise, weight_kg, sets, reps, rir, notes, source)
      values (
        uid, d,
        nullif(rec->>'workout_day',''),
        rec->>'exercise',
        nullif(rec->>'weight_kg','')::numeric,
        nullif(rec->>'sets','')::int,
        nullif(rec->>'reps','')::int,
        nullif(rec->>'rir','')::int,
        nullif(rec->>'notes',''),
        'watch'
      );
    end if;

    n := n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'written', n);
end;
$$;

grant execute on function public.watch_submit_logs(text, jsonb) to anon, authenticated;

-- ============================================================================
-- 完成
-- ============================================================================
