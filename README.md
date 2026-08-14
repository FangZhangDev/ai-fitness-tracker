<div align="center">

# 💪 AI Fitness Tracker

**长期增肌数据追踪 + AI 分析，网页与 vivo 手表双端。**

记录身体指标、饮食、训练；AI 自动估算营养并生成增肌进度分析；
训练计划同步到手表，健身房里抬手就能看今天练什么、转表冠记录实际做的重量。

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E)
![BlueOS](https://img.shields.io/badge/BlueOS%203-vivo%20Watch-00E5A0)

</div>

---

## 为什么做这个

市面上的健身 App 要么记录维度不够（只有重量没有 RIR），要么数据锁在别人手里、
导不出来也接不上 AI。这个项目的取向很简单：**数据是自己的，分析交给 AI，
手表上只做健身房里真正需要的那三件事。**

## 功能

### 网页端

| 模块 | 说明 |
|---|---|
| 身体记录 | 每日体重 / 体脂 / 腰围 / 睡眠，自动趋势图 |
| 饮食记录 | 自然语言输入（「三个鸡蛋，一个肉包，一碗豆浆」），AI 估算卡路里与三大营养素；可把常吃组合存成**「常吃套餐」**一点即填 |
| 训练记录 | 动作 / 重量 / 组数 / 次数 / RIR，自动追踪 PR 与力量曲线（Epley 1RM）；手表上记的会标 ⌚，便于集中复核 |
| 训练计划 | 按周几编排的计划模板，支持 AI 生成、多计划切换、按日快速记录 |
| AI 综合分析 | 一键分析近 N 天，评估增肌速度、热量与训练调整、恢复建议，输出结构化报告 |
| 数据导出 | CSV / Excel / JSON，另有「一键全量导出包」自带数据字典与 AI 提示词 |

界面是 PC 侧边栏 + 移动端底部 Tab，深色模式自适应。

### 手表端（vivo BlueOS 3 全系手表）

```
        今日计划                    记录
   ┌──────────────┐         ┌──────────────┐
   │  推日    2/5  │         │    卧推       │
   │ ▔▔▔▔▔▔▔━━━━━ │         │      ▲        │
   │ ✓ 卧推        │         │   62.5 kg     │ ← 转表冠
   │   60kg 4×8    │         │      ▼        │
   │ ✓ 上斜哑铃     │         │ 重量 组 次 RIR │ ← 点击切换
   │   22kg 3×10   │         │ 62.5  4  8  2 │
   │ ○ 器械飞鸟     │         │   [ 完成 ]     │
   └──────────────┘         └──────────────┘
```

- 手表上**不做账号登录**——网页生成 6 位配对码，手表输一次换长期 token
- **整周计划离线缓存**，靠版本号增量校验；没网照常看，还能切到别的训练日
- 打勾记录先落本地队列，联网自动补传；同一天同一动作是覆盖语义，不会产生脏数据
- 预填的是**历史最大重量**，打开就是自己的最好成绩，通常只需微调
- 屏幕每次交互续 30 秒，到点交还系统息屏——常亮太费电，系统默认那几秒又不够看完一组

**支持机型**：面向 **BlueOS 3 全系** vivo 手表（Watch 3 / Watch 5 / Watch GT / Watch GT2）。
`manifest.json` 声明了 `watch` / `watch-round` / `watch-square` 三种形态，
`designWidth` 466 按圆屏设计，方屏可用但未逐一调过版式。
开发与真机验证在 **Watch 3** 上完成，其余机型欢迎实测反馈。

> 想支持非 vivo 手表（Wear OS、HarmonyOS 等）？那是另一套框架，本仓库不打算维护；
> 欢迎 fork 自行实现——后端的三个 RPC 接口是通用的，照着 `watch/src/common/api.js` 接即可。

细节见 [`watch/README.md`](watch/README.md)。

## 技术栈

**Next.js 16** (App Router) · **TypeScript** · **Tailwind CSS v4** ·
**Supabase** (PostgreSQL + Auth + RLS) · OpenAI 兼容 AI（DeepSeek / OpenAI）· **Vercel**

手表端是原生 **BlueOS 快应用**（`.ux`），零框架依赖。

## 架构

```
              ┌──────────────┐
   浏览器 ───▶ │  Next.js 16   │ ──▶ AI (OpenAI 兼容)
              │  Server       │
              │  Actions      │
              └──────┬───────┘
                     │
                     ▼
              ┌──────────────┐
              │   Supabase    │  PostgreSQL + Auth + 行级安全(RLS)
              └──────▲───────┘
                     │ https
              ┌──────┴───────┐
   手表 ─http─▶│  转发服务      │  蓝河 fetch 发不出 HTTPS, 必须有这一跳
              │ (proxy/)      │  见 watch/proxy/README.md
              └──────────────┘
```

手表**不经过 Vercel**，直连 Supabase 的三个 `security definer` RPC——少一跳、延迟更低，
也绕开了 `vercel.app` 域名在国内不稳定的问题。

## 快速开始

### 1. 创建 Supabase 项目

1. 去 [supabase.com](https://supabase.com) 新建项目
2. **SQL Editor** → 按编号依次执行 `supabase/migrations/` 下的所有 `.sql`
   （都写成可重复执行，重跑无副作用）
3. **Settings → API** → 记下 `Project URL` 与 `anon public key`
   （新版界面叫 Publishable key，`sb_publishable_...` 开头）
4. **Authentication → Providers → Email** → 本地测试可关掉「Confirm email」

### 2. 配置环境变量

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

> AI 走 OpenAI 兼容协议，DeepSeek / OpenAI / 各家兼容服务都可以。

### 3. 跑起来

```bash
npm install
npm run dev
```

打开 <http://localhost:3000>，注册账号即可开始（profile 由触发器自动创建）。

### 4. （可选）手表端

见 [`watch/README.md`](watch/README.md)，简要三步：

```bash
cp watch/src/config.example.js watch/src/config.js   # 填转发服务地址与 Supabase 信息
python3 watch/proxy/server.py                         # 起转发服务 (Node 版同目录)
# 用 BlueOS Studio 打包 watch/src 成 rpk, 推到手表
```

## 文档

| 文档 | 内容 |
|---|---|
| [`DEPLOY.md`](DEPLOY.md) | 部署到 Vercel / 自托管，环境变量、超时、密钥暴露面 |
| [`watch/README.md`](watch/README.md) | 手表应用：架构、打包、交互、**蓝河真机开发的十来个坑** |
| [`watch/proxy/README.md`](watch/proxy/README.md) | 转发服务：为什么需要它、幂等与连接复用设计、部署方式 |
| [`supabase/migrations/`](supabase/migrations/) | 数据库 schema，每个文件顶部都写清了「为什么这么改」 |

## 目录结构

```
ai-fitness-tracker/
├── app/
│   ├── (dashboard)/         # 受保护的主应用 (带导航布局)
│   │   ├── page.tsx         # 概览
│   │   ├── profile/ body/ meals/ workouts/
│   │   ├── plan/            # 训练计划模板
│   │   ├── analysis/        # AI 分析
│   │   ├── watch/           # 手表配对与设备管理
│   │   ├── data/            # 数据管理
│   │   └── export/          # 数据导出
│   ├── login/ auth/callback/
│   └── api/export/
├── components/              # UI 原语、导航、表单管理器、图表
├── lib/
│   ├── supabase/            # 浏览器端 + 服务端客户端
│   ├── types/database.ts    # 数据库类型
│   ├── ai/                  # AI 客户端 / 营养分析 / 综合分析
│   ├── actions/             # Server Actions
│   ├── constants/           # 共享常量
│   └── utils/               # 日期 / PR / 导出
├── supabase/migrations/     # SQL 迁移
├── watch/                   # ⌚ 蓝河(BlueOS)手表应用
│   ├── src/                 # 页面 (.ux) 与公共模块
│   └── proxy/               # HTTP 转发服务 (Node 版 / Python 版)
├── proxy.ts                 # 路由保护 + 会话刷新 (Next 16 的 proxy, 原 middleware)
└── .env.example
```

## 设计说明

- **PR / 1RM**：不单独建表，用视图 `v_exercise_pr` 实时聚合；1RM 用 Epley 公式 `weight × (1 + reps/30)`
- **每日营养**：视图 `v_daily_nutrition` 按日期聚合，并标记未分析条数
- **AI 营养分析**：提交饮食时同步调用 AI 回填，失败不阻断（可点「重分析」补算）
- **数据安全**：全表 RLS，用户仅能访问 `user_id = auth.uid()` 的行
- **手表凭据**：token 只在兑换配对码时明文返回一次，库里只存 sha256 摘要

## 后续想做

- [ ] 数据管理页：多选、跨天批量删除、按周/月/年筛选
- [ ] 手表端配对码改成数字键盘输入（现在还得转表冠选 6 位）
- [ ] 手表端组间休息计时
- [ ] 运动库 `exercises` 表（动作分类 / 肌群）
- [ ] 周期化分析、训练容量趋势
- [ ] PWA 离线支持

## License

[MIT](LICENSE) © 2026 zhangfang
