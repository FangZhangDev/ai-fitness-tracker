# AI Fitness Tracker

增肌训练与饮食记录，带 AI 分析。网页端（Next.js + Supabase）与 vivo 手表端（BlueOS）。

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E)
![BlueOS](https://img.shields.io/badge/BlueOS%203-vivo%20Watch-00E5A0)

## 功能

网页端：

- 身体记录：每日体重 / 体脂 / 腰围 / 睡眠，趋势图
- 饮食记录：自然语言输入，AI 估算热量与三大营养素；常吃组合可存为模板一键填入
- 训练记录：动作 / 重量 / 组数 / 次数 / RIR，自动计算 PR 与力量曲线（Epley 1RM）
- 训练计划：按周几编排模板，支持 AI 生成、多套计划切换
- AI 私教：聊天界面，AI 可读取全部数据，授权后可直接修改当前计划，改动按轮次可撤销，删除需确认
- AI 综合分析：按区间评估增肌速度、热量与训练量
- 设置：保存多套 AI 供应商配置（含密钥），随时切换，生效优先于环境变量
- 数据管理与导出：按区间筛选、批量删除；CSV / Excel / JSON / 全量导出包

手表端（vivo BlueOS 3：Watch 3 / Watch 5 / Watch GT / Watch GT2，开发与验证在 Watch 3）：

- 网页生成 6 位配对码配对，手表端无账号登录
- 整周计划离线缓存，断网可用
- 转表冠记录重量 / 组数 / 次数 / RIR，预填历史最大重量
- 记录先落本地队列，联网自动补传；同天同动作覆盖语义，不产生重复

## 技术栈

Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · Supabase (PostgreSQL + Auth + RLS) · OpenAI 兼容 AI（DeepSeek / OpenAI 等）· Vercel

手表端为原生 BlueOS 快应用，经自建转发服务（`watch/proxy/`）直连 Supabase 的三个 RPC，不经过 Vercel。

## 快速开始

1. [supabase.com](https://supabase.com) 新建项目，SQL Editor 中按编号执行 `supabase/migrations/` 下全部 `.sql`（可重复执行）
2. 记下 Settings → API 的 `Project URL` 与 anon key；Authentication → Providers → Email 开启（本地测试可关掉 Confirm email）
3. 配置环境变量：

   ```bash
   cp .env.example .env.local
   ```

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-publishable-key
   AI_BASE_URL=https://api.deepseek.com      # 或 https://api.openai.com/v1
   AI_API_KEY=your-ai-api-key
   AI_MODEL=deepseek-chat                     # 或 gpt-4o-mini
   ```

4. `npm install && npm run dev`，打开 <http://localhost:3000> 注册即用

手表端见 [`watch/README.md`](watch/README.md)。

## 目录结构

```
├── app/                     # Next.js App Router
│   ├── (dashboard)/         # 主应用: 概览/身体/饮食/训练/计划/分析/手表/数据/导出/设置
│   └── api/                 # chat (SSE), export
├── components/              # UI 原语、表单管理器、图表
├── lib/
│   ├── ai/                  # AI 客户端 / 营养分析 / 综合分析 / 私教工具
│   ├── actions/             # Server Actions
│   └── types/               # 数据库类型
├── supabase/migrations/     # SQL 迁移, 每个文件头部写明改动原因
├── watch/                   # BlueOS 手表应用 + HTTP 转发服务
└── proxy.ts                 # 路由保护与会话刷新
```

## 设计要点

- PR / 1RM 不单独建表，视图 `v_exercise_pr` 实时聚合；1RM 用 Epley 公式
- 每日营养由视图 `v_daily_nutrition` 聚合，并标记未分析条数
- AI 改动全部记录在 `agent_mutations`（行级快照），支持按轮次撤销
- 全表 RLS；手表 token 只存 sha256 摘要

## 文档

- [`DEPLOY.md`](DEPLOY.md)：部署与环境变量
- [`watch/README.md`](watch/README.md)：手表应用
- [`watch/proxy/README.md`](watch/proxy/README.md)：转发服务
- [`docs/screenshots/`](docs/screenshots/)：真机截图

## License

[MIT](LICENSE) © 2026 zhangfang
