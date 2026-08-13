# 💪 AI 健身追踪

个人长期增肌数据追踪与 AI 分析系统。记录身体指标、饮食、训练，由 AI 自动估算营养并生成增肌进度分析。

## 功能

- **身体记录**：每日体重 / 体脂 / 腰围 / 睡眠，自动趋势图
- **饮食记录**：自然语言输入（如「三个鸡蛋，一个肉包，一碗豆浆」），AI 自动估算卡路里与三大营养素
- **训练记录**：动作 / 重量 / 组数 / 次数 / RIR，自动追踪 PR 与力量增长曲线（Epley 1RM）
- **AI 综合分析**：一键分析近 7 天，评估增肌速度、热量/训练调整、恢复建议，输出结构化报告
- **数据导出**：CSV / Excel / JSON
- **响应式**：PC 侧边栏 + 移动端底部 Tab，深色模式自适应
- **安全**：Supabase Auth + 行级安全（RLS），数据仅自己可见

## 技术栈

Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · Supabase (PostgreSQL) · OpenAI 兼容 AI · Vercel

## 目录结构

```
ai-fitness-tracker/
├── app/
│   ├── (dashboard)/        # 受保护的主应用 (带导航布局)
│   │   ├── page.tsx        # 概览
│   │   ├── profile/        # 个人资料
│   │   ├── body/           # 身体记录
│   │   ├── meals/          # 饮食记录
│   │   ├── workouts/       # 训练记录
│   │   ├── analysis/       # AI 分析
│   │   └── export/         # 数据导出
│   ├── login/              # 登录/注册
│   ├── auth/callback/      # Supabase 邮箱链接回调
│   ├── api/export/         # 导出下载接口
│   ├── layout.tsx / globals.css / error.tsx / not-found.tsx
├── components/             # UI 原语、导航、表单管理器、图表
├── lib/
│   ├── supabase/           # 浏览器端 + 服务端客户端
│   ├── types/database.ts   # 数据库类型 (手写, 含 Supabase 泛型映射)
│   ├── ai/                 # AI 客户端 / 营养分析 / 综合分析
│   ├── actions/            # Server Actions (增删改)
│   └── utils/              # 日期 / PR / 服务端助手 / 导出
├── supabase/migrations/    # SQL 迁移 (schema 定义)
├── proxy.ts                # 路由保护 + 会话刷新 (Next 16 的 proxy, 原 middleware)
└── .env.example
```

## 本地启动

### 1. 创建 Supabase 项目

1. 前往 [supabase.com](https://supabase.com) 新建项目
2. 进入 **SQL Editor**，粘贴并执行 `supabase/migrations/0001_init_schema.sql`
   （建表、RLS、触发器、视图一次性完成；新用户注册会自动创建档案）
3. 进入 **Settings → API**，记录 `Project URL` 与 `anon public key`
4. （可选）**Authentication → Providers → Email**，关闭「Confirm email」便于本地测试

### 2. 配置环境变量

复制 `.env.example` 为 `.env.local`，填入真实值：

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
AI_BASE_URL=https://api.deepseek.com      # 或 https://api.openai.com/v1
AI_API_KEY=your-ai-api-key
AI_MODEL=deepseek-chat                     # 或 gpt-4o-mini
```

> AI 接口采用 OpenAI 兼容协议，DeepSeek / OpenAI / 国内兼容服务均可。

### 3. 安装与运行

```bash
npm install
npm run dev
```

打开 http://localhost:3000 ，首次访问会跳转登录页，注册账号即可开始使用。

### 4. 创建用户

在登录页点「注册」。注册后 profile 会被触发器自动创建；进入「个人资料」补充身高、目标等信息。

## 部署到 Vercel

1. 推送代码到 GitHub
2. 在 [Vercel](https://vercel.com) 导入该仓库
3. 在 Vercel 项目 **Settings → Environment Variables** 中添加与 `.env.local` 相同的变量
4. 部署完成

> Supabase 项目的 **Authentication → URL Configuration** 中，将站点域名加入 Redirect URLs。

## 设计说明

- **PR / 1RM**：不单独建表，用视图 `v_exercise_pr` 实时聚合；1RM 用 Epley 公式 `weight × (1 + reps/30)`
- **每日营养**：视图 `v_daily_nutrition` 按日期聚合，并标记未分析条数
- **AI 营养分析**：提交饮食时同步调用 AI 回填，失败不阻断（可点「重分析」补算）
- **数据安全**：全表 RLS，用户仅能访问 `user_id = 自己` 的行

## 后续可扩展

- 训练计划模板 vs 实际执行分离
- 运动库 `exercises` 表（动作分类 / 肌群）
- 周期化分析、训练容量趋势
- PWA 离线支持
