-- ============================================================================
-- 0010 AI 教练的改动日志 (可重复执行)
--
-- 私教 chatbox 允许 AI 直接改数据库。为了让每一次改动都能原样退回,
-- 每写一行就在这里留一条「行级快照」: 改之前长什么样(before)、改之后长什么样(after)。
--
-- 为什么是行级快照而不是「逆操作」:
--   逆操作要给每个工具单独写一份撤销逻辑, 加一个工具就要记得配一份, 迟早会漏。
--   行级快照只有三种情况, 撤销是纯机械的, 与工具数量无关:
--     before 为空 -> 这行是新增的      -> 撤销 = 删掉它
--     after  为空 -> 这行是被删掉的    -> 撤销 = 按原样插回去 (含原 id)
--     两者都有    -> 这行是被改过的    -> 撤销 = 写回 before
--
--   插回去时连 id 一起还原, 是因为 plan_exercises.id 被手表端引用
--   (watch_get_today 返回的就是它)。换个新 id 等于把手表上的引用悄悄弄断。
--   uuid 主键允许显式指定, 所以这件事做得到。
--
-- turn_id 是一次对话轮次。撤销以轮次为单位, 按 seq 逆序重放 ——
-- 顺序很重要: 同一轮里先建了训练日再往里加动作, 撤销必须先删动作再删训练日,
-- 否则会撞外键。
--
-- ⚠️ 级联删除的坑: plan_days 删掉时, 它下面的 plan_exercises 由外键
--    on delete cascade 一起删掉。级联发生在数据库内部, 不经过工具, 也就不会
--    在这里留下记录 —— 撤销后训练日回来了, 动作却没了。
--    所以删训练日的工具必须先把子行逐条记进来再删。见 lib/ai/coach-tools.ts。
-- ============================================================================

create table if not exists public.agent_mutations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- 一次对话轮次; 同一轮的所有改动共享, 撤销以此为单位
  turn_id     uuid not null,
  -- 轮次内序号, 从 0 起; 撤销时按它倒着重放
  seq         integer not null,
  -- 只允许 AI 碰得到的表。写入方是服务端代码, 但撤销时要用它拼表名,
  -- 白名单挡在数据库这一层, 免得哪天上游改坏了就能写到任意表去
  table_name  text not null check (
    table_name in ('plan_days', 'plan_exercises', 'workout_plans')
  ),
  row_id      uuid not null,
  before      jsonb,          -- null = 这行是新增的
  after       jsonb,          -- null = 这行被删了
  -- 撤销后打上时间戳而不是删掉记录: 出了问题还能回溯 AI 到底做过什么
  undone_at   timestamptz,
  created_at  timestamptz not null default now(),
  unique (turn_id, seq)
);

-- 撤销时按 (turn_id, seq desc) 取整轮; 列表页按 user_id + 时间倒序
create index if not exists idx_agent_mutations_turn
  on public.agent_mutations (turn_id, seq);
create index if not exists idx_agent_mutations_user
  on public.agent_mutations (user_id, created_at desc);

-- ============================================================================
-- RLS —— 与其它表一致, 只能读写自己的行
-- ============================================================================
alter table public.agent_mutations enable row level security;

drop policy if exists "am_all_own" on public.agent_mutations;
create policy "am_all_own" on public.agent_mutations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table public.agent_mutations is
  'AI 教练每次改库留下的行级快照, 供按对话轮次一键撤销';

-- ============================================================================
-- 完成
-- ============================================================================
