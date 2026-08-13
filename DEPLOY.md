# 部署与测试备忘（浙大实验室服务器 node01）

## 环境事实

| 项 | 值 |
|---|---|
| 主机 | node01，RHEL 8.5，glibc 2.28 |
| 内网 IP | `10.39.15.143`（ens13f0，DHCP 动态，可能变） |
| Node | v22.18.0（nvm） |
| 项目路径 | `/datb/home/zhangfang/Project/00_OLD_DOCS/fzg_proj/ai-fitness/ai-fitness-tracker` |
| 防火墙 | firewalld 未启用，端口默认可达 |
| 外网 | 直连可达 supabase.co / api.deepseek.com，**不需要代理** |

## 平台适配（已处理）

Next.js 16 的原生 SWC 二进制要求 `GLIBC_2.29`，本机只有 2.28，
所以 **Turbopack 跑不起来**，必须走 webpack。已固化进 `package.json`：

```json
"dev":   "next dev --webpack -H 0.0.0.0 -p 3000",
"build": "next build --webpack",
"start": "next start -H 0.0.0.0 -p 3000"
```

启动时会打印两行 `Attempted to load @next/swc-linux-x64-gnu ... GLIBC_2.29 not found`
警告——**这是预期的**，Next 会自动回退到 WASM 版 SWC，不影响功能，只是构建慢一些。

> 解压出来的 `node_modules` 已损坏（zip 把 npm 的符号链接压平成普通文件，
> 相对 `require` 全断），已删除并用 `npm ci` 重装。以后别从 zip 里带 node_modules。

## Node 来源（注册表未覆盖）

`registryctl resolve node/npm/npx` 全部返回「未在注册表中找到」——注册表只扫
`/data/software/miniconda3`、`/data/software/miniforge3_zf`、`/data/software/*`，
这三处都没有 node。全机唯一的 Node 是 nvm 装的：

```
/datb/home/zhangfang/.nvm/versions/node/v22.18.0/bin/{node,npm,npx}   # v22.18.0
```

**坑：`npm` 的 shebang 是 `#!/usr/bin/env node`**，所以即使写 npm 的绝对路径，
只要 PATH 里没有 node 一样会报 `env: 'node': No such file or directory`。
nvm 是靠 `~/.bashrc` 注入 PATH 的，**cron / systemd / 非登录 shell 里都没有**。
写自启脚本时必须显式加 PATH：

```bash
export PATH=/datb/home/zhangfang/.nvm/versions/node/v22.18.0/bin:$PATH
```

## 启动

```bash
cd /datb/home/zhangfang/Project/00_OLD_DOCS/fzg_proj/ai-fitness/ai-fitness-tracker
export PATH=/datb/home/zhangfang/.nvm/versions/node/v22.18.0/bin:$PATH
npm run build          # 首次 / 改代码后
nohup npm run start > /tmp/fitness.log 2>&1 &
```

停止：`pkill -f "next start"`

本机自测时注意：shell 里设了 `http_proxy`，curl 访问 localhost 会被代理拦成 502，
加 `--noproxy '*'`：

```bash
curl -s --noproxy '*' -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/login
```

## 仍需手动配置（阻塞项）

### 1. Supabase anon key（必须）

`.env.local` 里 `NEXT_PUBLIC_SUPABASE_ANON_KEY=待填-anon-key` 还是占位符，
REST 探测返回 401。去控制台取：

<https://supabase.com/dashboard/project/brizffqttkhuktpqlcie/settings/api>

复制 `anon public`（新版界面可能叫 Publishable key，`sb_publishable_...` 开头），
填回 `.env.local`，然后重新 `npm run build && npm run start`。

### 2. 建表（必须）

Supabase 控制台 → SQL Editor → 粘贴执行 `supabase/migrations/0001_init_schema.sql`
（建表 + RLS + 触发器 + 视图，一次完成）。

### 3. Auth 设置（必须）

- **Authentication → Providers → Email → 关闭 Confirm email**
  否则注册要点邮件里的确认链接，而链接会指向内网 IP，手机邮箱客户端多半打不开。
- **Authentication → URL Configuration → Site URL** 填 `http://10.39.15.143:3000`

### 4. 注册完自己的账号后立刻关闭公开注册（安全，重要）

**Authentication → Sign In / Providers → 关闭 "Allow new users to sign up"**

原因：服务跑在 3000 端口且无额外鉴权，浙大内网任何人扫到这台机器都能打开注册页、
建账号、然后用饮食记录功能消耗你的 DeepSeek 额度。RLS 只保证「别人看不到你的数据」，
挡不住「别人注册自己的账号烧你的 key」。

## 密钥暴露面

- `AI_API_KEY`（DeepSeek）：只在 server actions 里用，已确认不会进客户端 bundle。安全。
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`：设计上就是公开的，会出现在浏览器里，
  靠数据库 RLS 保护。迁移 SQL 里五张表全开了 RLS 且策略是 `user_id = auth.uid()`，正确。
- `.env.local` 被 `.gitignore` 覆盖（`.env*`），不会进 git。

## 数据实际存在哪

**不在这台服务器上。** 表和用户数据都在 Supabase 云（境外），
AI 推理在 DeepSeek 云。这台服务器只负责渲染页面和转发 API 调用。
所以「部署在实验室服务器」并不等于「数据留在内网」。

## 手机访问

手机 aTrust 连浙大 VPN → 浏览器打开 `http://10.39.15.143:3000`

注意 IP 是 DHCP 动态分配的，服务器重启后可能变，届时用 `ip -4 addr show ens13f0` 重新确认。
