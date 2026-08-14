# 部署指南

三条路：**Vercel**（推荐）、**自托管**、**手表转发服务**。
数据库都在 Supabase，跑在哪里只影响页面渲染那一层。

---

## 一、先把 Supabase 弄好（必须）

### 1. 建表

控制台 → **SQL Editor** → 按编号依次粘贴执行 `supabase/migrations/` 下的所有 `.sql`。
每个文件都写成可重复执行，重跑无副作用。

| 迁移 | 作用 |
|---|---|
| `0001_init_schema.sql` | 建表 + RLS + 触发器 + 视图 |
| `0002_workout_plans.sql` | 训练计划模板 |
| `0003_meal_all_day.sql` | 饮食支持「全天」餐次 |
| `0004_watch_pairing.sql` | 手表配对与数据接口 |
| `0005_watch_max_weight.sql` | 手表预填改用历史最大重量 |
| `0006_watch_week_cache.sql` | 手表整周计划 + 版本号增量校验（手表 v1.2.0 起需要）|
| `0007_meal_templates_and_log_source.sql` | 常吃套餐 + 训练记录来源标记（手表端无需改动）|

只用网页端的话，`0004`~`0006` 可以不执行。

### 2. 取 key

**Settings → API** → `Project URL` + `anon public`
（新版界面叫 Publishable key，`sb_publishable_...` 开头），填进 `.env.local`。

### 3. Auth 设置

- **Authentication → Providers → Email**：自用建议**关掉 Confirm email**。
  开着的话注册要点邮件里的确认链接，而链接会指向部署地址，内网地址在手机邮箱里多半打不开。
- **Authentication → URL Configuration → Site URL**：填最终访问地址；
  Redirect URLs 加上 `<你的地址>/auth/callback`。否则邮箱确认 / 密码重置会跳到错误地址。

### 4. ⚠️ 注册完自己的账号后立刻关掉公开注册

**Authentication → Sign In / Providers → 关闭 "Allow new users to sign up"**

应用本身没有额外鉴权，任何人扫到你的地址都能注册账号，然后用饮食记录功能
**烧你的 AI key**。RLS 只保证「别人看不到你的数据」，挡不住「别人注册自己的账号花你的钱」。

---

## 二、部署到 Vercel（推荐）

项目本来就是奔着 Vercel 设计的。

### 走 GitHub

1. 推到 GitHub
2. 在 [Vercel](https://vercel.com) 导入该仓库
3. **Settings → Environment Variables** 填入与 `.env.local` 相同的 5 个变量
4. Deploy

### 或者 CLI 直传（GitHub 不通时）

```bash
npm i -g vercel
vercel                # 首次: 交互式创建项目, 一路默认
vercel --prod         # 正式部署
```

`.env.local` 被 `.gitignore` 覆盖不会上传，环境变量要单独设：

```bash
for e in production preview development; do
  vercel env add NEXT_PUBLIC_SUPABASE_URL      $e
  vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY $e
  vercel env add AI_BASE_URL                   $e
  vercel env add AI_API_KEY                    $e
  vercel env add AI_MODEL                      $e
done
```

### 两个容易踩的点

- **Deployment Protection 默认是开的**，开着的话所有 `.vercel.app` 地址都会 302 跳
  Vercel 登录页，手机上直接用不了。自用记得关掉。
- **函数区域**：默认 `iad1`（美东）。国内访问建议在 `vercel.json` 里改成 `hnd1`（东京），
  往返能省一大截。

### 超时配置（已按 Next 官方文档设好）

AI 调用比普通请求慢得多，Server Action 的超时设在它所在的 page 上：

| 位置 | maxDuration | 原因 |
|---|---|---|
| `app/(dashboard)/analysis/page.tsx` | 60s | AI 综合分析，Hobby 计划上限 |
| `app/(dashboard)/meals/page.tsx` | 30s | 提交饮食时同步估算营养 |
| `app/api/export/route.ts` | 30s | exceljs 在内存里生成工作簿 |

> 实测 DeepSeek 分析 7 天数据约 5~7 秒（prompt ~1900 tok）。允许区间到 90 天时耗时会明显上升。

---

## 三、自托管（自己的服务器 / NAS）

```bash
npm ci
npm run build
npm run start          # 默认 -H 0.0.0.0 -p 3000
```

后台常驻：

```bash
nohup npm run start > /tmp/fitness.log 2>&1 &
# 停止
pkill -f "next start"
```

### 老发行版要注意 glibc

Next.js 16 的原生 SWC 二进制需要 `GLIBC_2.29`。CentOS/RHEL 8 只有 2.28，
**Turbopack 跑不起来**，必须走 webpack。本仓库的 `package.json` 已经固定成 webpack：

```json
"dev":   "next dev --webpack -H 0.0.0.0 -p 3000",
"build": "next build --webpack",
"start": "next start -H 0.0.0.0 -p 3000"
```

启动时会打印两行 `Attempted to load @next/swc-linux-x64-gnu ... GLIBC_2.29 not found`
——**这是预期的**，Next 会自动回退到 WASM 版 SWC，功能不受影响，只是构建慢一些。
glibc 够新的机器可以把 `--webpack` 去掉换回 Turbopack。

### 用 nvm 装的 Node 要显式给 PATH

`npm` 的 shebang 是 `#!/usr/bin/env node`，所以即使写 npm 的绝对路径，
PATH 里没有 node 一样会报 `env: 'node': No such file or directory`。
nvm 靠 `~/.bashrc` 注入 PATH，**cron / systemd / 非登录 shell 里都没有**，自启脚本里要写死：

```bash
export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"
```

### 本机自测

shell 里设了 `http_proxy` 的话，curl 访问 localhost 会被代理拦成 502，加 `--noproxy '*'`：

```bash
curl -s --noproxy '*' -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/login
```

---

## 四、手表转发服务

只在用手表端时才需要。蓝河快应用的 fetch 通道**发不出 HTTPS**，而 Supabase 强制 https，
所以中间必须有一跳明文 HTTP 的转发。完整说明（含幂等与连接复用的设计理由）见
[`watch/proxy/README.md`](watch/proxy/README.md)。

```bash
cp watch/src/config.example.js watch/src/config.js   # 填 SUPABASE_URL / ANON_KEY
python3 watch/proxy/server.py                         # 或 node watch/proxy/server.js
curl http://<本机IP>:8080/health                       # {"ok":true,...}
```

上游地址取自 `watch/src/config.js`，也可以用环境变量覆盖：
`SUPABASE_URL=https://xxx.supabase.co python3 server.py`。

手表走蓝牙经手机上网，**只有当手机与转发服务在同一网络时才连得上**。
连不上也不影响用：整周计划有离线缓存，记录进本地队列，回到网络内自动补传。

---

## 密钥暴露面

| 变量 | 会不会进浏览器 | 说明 |
|---|---|---|
| `AI_API_KEY` | ❌ 不会 | 只在 Server Actions 里用 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ 会 | 设计上就是公开的，靠 RLS 保护 |
| 手表里的 ANON_KEY | ✅ 打进 rpk | 同上；手表的真正凭据是配对后拿到的 device token |
| `.env.local` | — | 被 `.gitignore` 的 `.env*` 覆盖，不会进 git |

五张表全开了 RLS，策略是 `user_id = auth.uid()`；手表侧接口全部走
`security definer` 函数，不直连表，不需要把 `service_role` key 发到手表上。

## 数据实际存在哪

**不在你的服务器上。** 表和用户数据都在 Supabase 云，AI 推理在模型服务商那边。
自托管的那台机器只负责渲染页面和转发 API 调用——「部署在自己服务器」
不等于「数据留在本地」。介意的话可以自建 Supabase（官方支持 self-host）。
