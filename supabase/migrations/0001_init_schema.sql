-- ============================================================================
-- AI Fitness Tracker — 初始化 Schema
-- 个人长期增肌追踪系统数据库
--
-- 设计原则:
--   1. 所有业务表带 user_id, 启用 RLS, 用户只能访问自己的数据
--   2. 数值字段加 CHECK 范围约束, 防止脏数据
--   3. UNIQUE(user_id, date) 防止每日身体记录重复
--   4. updated_at 由触发器统一维护
--   5. PR / 1RM / 每日营养汇总用 SQL View 实时聚合, 不额外存表
--   6. AI 分析报告留档到 ai_analyses, 便于历史对比
--   7. 新用户注册自动创建 profile
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. 通用: updated_at 自动维护函数
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1. profiles — 用户档案 (1:1 对应 auth.users)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  height_cm         numeric(5,2),                       -- 身高 (cm)
  current_weight_kg numeric(5,2),                       -- 当前体重 (kg)
  target_weight_kg  numeric(5,2),                       -- 目标体重 (kg)
  goal              text,                               -- 健身目标: 增肌/减脂/维持/力量
  activity_level    text check (activity_level in       -- 活动水平 (用于热量估算)
                    ('sedentary','light','moderate','active','very_active')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- 新用户注册时自动创建空 profile
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 2. daily_metrics — 每日身体记录
-- ----------------------------------------------------------------------------
create table if not exists public.daily_metrics (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  date          date not null,
  weight_kg     numeric(5,2)  check (weight_kg between 20 and 400),
  body_fat_pct  numeric(4,1)  check (body_fat_pct between 1 and 70),   -- 体脂率 %
  waist_cm      numeric(5,2)  check (waist_cm between 30 and 200),     -- 腰围
  sleep_hours   numeric(4,1)  check (sleep_hours between 0 and 24),    -- 睡眠时长
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, date)                                                -- 每天仅一条
);

create index if not exists idx_daily_metrics_user_date
  on public.daily_metrics (user_id, date desc);

create trigger trg_daily_metrics_updated_at
  before update on public.daily_metrics
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. meal_logs — 饮食记录 (自然语言输入 + AI 营养分析回填)
-- ----------------------------------------------------------------------------
create table if not exists public.meal_logs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  date         date not null,
  meal_type    text not null check (meal_type in ('breakfast','lunch','dinner','snack')),
  description  text not null,                       -- 自然语言描述, 如 "三个鸡蛋,一个肉包,一碗豆浆"
  -- ↓ AI 分析结果 (可空, 调用 AI 后回填)
  calories     integer check (calories between 0 and 10000),   -- 千卡
  protein_g    numeric(6,1) check (protein_g between 0 and 1000),  -- 蛋白质 g
  carbs_g      numeric(6,1) check (carbs_g between 0 and 1000),    -- 碳水 g
  fat_g        numeric(6,1) check (fat_g between 0 and 1000),      -- 脂肪 g
  ai_raw       jsonb,                              -- AI 原始返回 (留档, 便于复算)
  analyzed_at  timestamptz,                        -- 分析时间 (null=尚未分析)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_meal_logs_user_date
  on public.meal_logs (user_id, date desc);

create trigger trg_meal_logs_updated_at
  before update on public.meal_logs
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. workout_logs — 训练记录
--    每行 = 某天某动作的一次记录 (sets 组 × reps 次 × weight kg, RIR 留余量)
-- ----------------------------------------------------------------------------
create table if not exists public.workout_logs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  date         date not null,
  workout_day  text,                               -- 训练日, 如 "推日/拉日/腿日/胸背"
  exercise     text not null,                      -- 动作名称, 如 "卧推"
  weight_kg    numeric(6,2) check (weight_kg between 0 and 500),
  sets         integer check (sets between 0 and 20),
  reps         integer check (reps between 0 and 100),   -- 每组次数
  rir          integer check (rir between 0 and 10),     -- Reps In Reserve 留余量
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_workout_logs_user_date
  on public.workout_logs (user_id, date desc);
create index if not exists idx_workout_logs_user_exercise_date
  on public.workout_logs (user_id, exercise, date desc);

create trigger trg_workout_logs_updated_at
  before update on public.workout_logs
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 5. ai_analyses — AI 综合分析报告留档 (每次"分析最近N天"存一条)
-- ----------------------------------------------------------------------------
create table if not exists public.ai_analyses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  period_start date not null,
  period_end   date not null,
  report       jsonb not null,                     -- 结构化 JSON 报告
  created_at   timestamptz not null default now()
);

create index if not exists idx_ai_analyses_user_created
  on public.ai_analyses (user_id, created_at desc);

-- ============================================================================
-- 视图: 实时聚合, 供仪表盘与 AI 分析读取
-- ============================================================================

-- 每个动作的历史 PR (最大重量 + Epley 估算 1RM)
-- Epley 公式: 1RM = weight * (1 + reps / 30)
create or replace view public.v_exercise_pr as
select
  user_id,
  exercise,
  max(weight_kg) as max_weight_kg,
  max(weight_kg * (1 + reps::numeric / 30)) as estimated_1rm_kg,
  max(date) as last_achieved_date
from public.workout_logs
where weight_kg is not null and reps is not null and reps > 0
group by user_id, exercise;

-- 每日营养汇总 (只统计已分析的记录)
create or replace view public.v_daily_nutrition as
select
  user_id,
  date,
  coalesce(sum(calories), 0) as total_calories,
  coalesce(sum(protein_g), 0) as total_protein_g,
  coalesce(sum(carbs_g), 0) as total_carbs_g,
  coalesce(sum(fat_g), 0) as total_fat_g,
  count(*) filter (where analyzed_at is null) as unanalyzed_count
from public.meal_logs
group by user_id, date;

-- ============================================================================
-- RLS: 行级安全 — 用户只能访问自己的数据
-- ============================================================================
alter table public.profiles        enable row level security;
alter table public.daily_metrics   enable row level security;
alter table public.meal_logs       enable row level security;
alter table public.workout_logs    enable row level security;
alter table public.ai_analyses     enable row level security;

-- profiles (id 即 user_id)
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_upsert_own" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- daily_metrics
create policy "dm_all_own" on public.daily_metrics
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- meal_logs
create policy "ml_all_own" on public.meal_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- workout_logs
create policy "wl_all_own" on public.workout_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ai_analyses
create policy "aa_all_own" on public.ai_analyses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================================
-- 完成
-- ============================================================================
