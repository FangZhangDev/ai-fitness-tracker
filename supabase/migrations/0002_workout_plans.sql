-- ============================================================================
-- 0002 训练计划模板
--   workout_plans  一套计划 (用户可存多套, is_active 标记当前在用的那套)
--   plan_days      计划中的某个训练日 (按周几, 1=周一 ... 7=周日)
--   plan_exercises 训练日下的动作清单 (组数/次数区间/RIR/休息/要点/器材)
--
-- 与 workout_logs 的关系: 计划只是模板, 实际训练仍写入 workout_logs。
-- 从计划快速记录时, 用 plan_days.title 回填 workout_logs.workout_day。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. workout_plans
-- ----------------------------------------------------------------------------
create table if not exists public.workout_plans (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_workout_plans_user
  on public.workout_plans (user_id, is_active desc, created_at desc);

create trigger trg_workout_plans_updated_at
  before update on public.workout_plans
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. plan_days — 一个计划里同一个周几只允许一条
-- ----------------------------------------------------------------------------
create table if not exists public.plan_days (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references public.workout_plans(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  weekday      smallint not null check (weekday between 1 and 7),  -- 1=周一 ... 7=周日
  title        text not null,                    -- 如 "上肢 A，上胸 + 背厚 + 肩"
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (plan_id, weekday)
);

create index if not exists idx_plan_days_plan
  on public.plan_days (plan_id, weekday);

create trigger trg_plan_days_updated_at
  before update on public.plan_days
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. plan_exercises
--    次数与 RIR 都存区间 (如 8-10 次, RIR 1-2); 单值时 min = max
-- ----------------------------------------------------------------------------
create table if not exists public.plan_exercises (
  id           uuid primary key default gen_random_uuid(),
  day_id       uuid not null references public.plan_days(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  exercise     text not null,
  target_sets  integer check (target_sets between 0 and 20),
  rep_min      integer check (rep_min between 0 and 100),
  rep_max      integer check (rep_max between 0 and 100),
  rir_min      integer check (rir_min between 0 and 10),
  rir_max      integer check (rir_max between 0 and 10),
  rest         text,                             -- 如 "2-3分钟" / "60-90秒"
  cues         text,                             -- 动作要点
  equipment    text,                             -- 器材
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_plan_exercises_day
  on public.plan_exercises (day_id, sort_order);

create trigger trg_plan_exercises_updated_at
  before update on public.plan_exercises
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 视图: 每个动作最近一次的记录, 用于快速记录时预填上次重量
-- ============================================================================
create or replace view public.v_exercise_last
with (security_invoker = true) as
select distinct on (user_id, exercise)
  user_id,
  exercise,
  date        as last_date,
  weight_kg   as last_weight_kg,
  sets        as last_sets,
  reps        as last_reps,
  rir         as last_rir
from public.workout_logs
order by user_id, exercise, date desc, created_at desc;

-- ============================================================================
-- 切换启用中的计划
--   同一用户同时只应有一套 is_active 计划。拆成两条 UPDATE 用两次 HTTP 调用
--   会有中间态, 这里放进函数里保证原子性。
--   security invoker: 按调用者身份执行, RLS 照常生效。
-- ============================================================================
create or replace function public.activate_plan(p_plan_id uuid)
returns void
language plpgsql
security invoker
as $$
begin
  update public.workout_plans
     set is_active = false
   where user_id = auth.uid() and is_active;

  update public.workout_plans
     set is_active = true
   where id = p_plan_id and user_id = auth.uid();
end;
$$;

-- ============================================================================
-- 安全修复: 0001 建的两个视图会绕过 RLS
--
-- Postgres 的视图默认按【视图所有者】的权限执行 (security definer 语义)。
-- 0001 的视图在 SQL Editor 里以 postgres 身份创建, 所以查询视图时底层表的
-- RLS 是以 postgres 求值的, 等于没有过滤。
--
-- 实测: 用户 B 查 v_exercise_pr 能读到用户 A 的动作名与最大重量, 查
-- v_daily_nutrition 能读到 A 的每日热量; 而直接查基表正确返回空。
-- 加上 security_invoker 后, 视图改用【查询者】的权限求值, RLS 恢复生效。
-- ============================================================================
alter view public.v_exercise_pr     set (security_invoker = on);
alter view public.v_daily_nutrition set (security_invoker = on);

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.workout_plans   enable row level security;
alter table public.plan_days       enable row level security;
alter table public.plan_exercises  enable row level security;

create policy "wp_all_own" on public.workout_plans
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "pd_all_own" on public.plan_days
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "pe_all_own" on public.plan_exercises
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================================
-- 完成
-- ============================================================================
