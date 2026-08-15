-- ============================================================================
-- 0011 AI 供应商预设
--
-- 设置页允许保存多套 AI 配置(如 "DeepSeek 官方" / "本地 ollama" / "OpenAI"),
-- 一键切换当前生效的那套。之前配置只能走环境变量, 换供应商要改 Vercel 后重部署。
--
-- 密钥直接存在这张表里, 安全边界与其它表一致: RLS 保证只有本人能读写,
-- 且应用层永不把完整密钥回显给前端(见 lib/actions/settings.ts, 只回掩码)。
--
-- 生效优先级: 激活的预设 > 环境变量(见 lib/ai/client.ts 的 resolveAiConfig)。
--   预设删光或都没激活时自动回落环境变量, 不会出现"没配置可用"的空窗。
-- ============================================================================

create table if not exists public.ai_presets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,                   -- 如 "DeepSeek 官方"
  base_url     text not null,
  api_key      text not null default '',        -- 本地/内网服务可为空
  model        text not null,
  -- 三个能力开关与 client.ts 的 AiConfig 一一对应, 换不兼容模型时关掉即可:
  json_mode             boolean not null default true,  -- 支持 response_format json_object
  temperature_supported boolean not null default true,  -- 接受 temperature 参数
  tools_supported       boolean not null default true,  -- 支持 function calling(AI 私教需要)
  is_active    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists idx_ai_presets_user
  on public.ai_presets (user_id, is_active desc, created_at desc);

-- 一个用户最多一套激活: 两套同时"生效"时 resolveAiConfig 取哪套取决于排序,
-- 是典型的静默错误, 这里用部分唯一索引在数据库层直接堵死。
-- (workout_plans 的 is_active 没这个约束, 但那边取错顶多用错模板, 这里取错
--  意味着把请求发去错误的供应商。)
create unique index if not exists uq_ai_presets_one_active
  on public.ai_presets (user_id) where is_active;

drop trigger if exists trg_ai_presets_updated_at on public.ai_presets;
create trigger trg_ai_presets_updated_at
  before update on public.ai_presets
  for each row execute function public.set_updated_at();

-- ============================================================================
-- RLS -- 与其它表一致, 只能读写自己的行
-- ============================================================================
alter table public.ai_presets enable row level security;

drop policy if exists "ap_all_own" on public.ai_presets;
create policy "ap_all_own" on public.ai_presets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table public.ai_presets is
  'AI 供应商预设(含密钥), 每用户多套、至多一套激活, 生效优先于环境变量';

-- ============================================================================
-- 完成
-- ============================================================================
