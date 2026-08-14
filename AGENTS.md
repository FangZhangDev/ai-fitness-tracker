<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 这个仓库有四条**互相独立**的发布链路

改完代码「怎么让它生效」取决于你动了哪个目录。**没有任何一条是自动的**——
`git push` 只是把代码推到 GitHub，**不部署任何东西**。

| 你动了 | 要做什么才生效 | AI 能不能自己做 |
|---|---|---|
| `app/` `components/` `lib/` `proxy.ts` `public/` | **`vercel --prod`**（见下） | ✅ 能 |
| `watch/src/**` | BlueOS Studio 重新打包 rpk → 推到手表，且 `versionCode` 必须 +1 | ❌ 只能人工 |
| `watch/proxy/**` | 重启转发服务进程 | ✅ 能 |
| `supabase/migrations/**` | Supabase 控制台 → SQL Editor 粘贴执行 | ❌ 只能人工（AI 没有库凭据）|
| `*.md` `docs/` | 什么都不用做 | — |

> ⚠️ **最容易犯的错**：把手表端的改动（`watch/`）算进「等待部署上线」里。
> 手表应用**根本不经过 Vercel**，Vercel 上跑的只有 Next.js 那套；
> 反过来网页改了也不需要重新打包手表。报告发布状态前先按上表核对路径。

## 一、网页 → Vercel

### 现状（2026-08-14 用 Vercel API 核实）

- 项目 `ai-fitness-tracker`，scope `fzg002s-projects`，`.vercel/project.json` 已 link
- **没有连接 GitHub**：`GET /v9/projects/{id}` 的 `link` 字段为 `null`。
  项目是 2026-08-13 用 CLI 直传创建的，GitHub 仓库 2026-08-14 才建，两者从未关联
- 因此 **`git push` 不触发部署**，必须显式跑一次 CLI

### 部署命令

```bash
export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"   # 非登录 shell 里没有 nvm 的 PATH
cd <repo>
vercel --prod --yes          # 直传源码, 由 Vercel 构建, 约 40s
```

验证（**别只用本机 curl 打 vercel.app 判定成败**——国内直连经常超时，
那是网络问题不是部署失败）：

```bash
vercel ls ai-fitness-tracker | head -5   # 最新一条应为 ● Ready / Production
curl -s -o /dev/null -w '%{http_code}\n' https://ai-fitness-tracker-murex.vercel.app/login   # 200
```

### 手动直传 vs 连 GitHub 自动部署

| | CLI 直传（现状） | 连 GitHub |
|---|---|---|
| 触发 | 手动跑命令 | push 到 main 即部署 |
| 漏发布 | **容易**——推了代码忘了部署，线上悄悄落后 | 不会 |
| 预览环境 | 无 | 每个分支/PR 一个预览地址 |
| 依赖的网络 | 本机 → Vercel | Vercel → GitHub（与本机无关）|
| 只改文档 | 不会部署 | 也会部署（无害，占点构建额度）|

**建议连 GitHub**，一条命令，连上后 `vercel --prod` 仍可用作临时发布：

```bash
vercel git connect https://github.com/FangZhangDev/ai-fitness-tracker
```

### 环境变量

不在仓库里，也不随部署上传（`.env.local` 被 `.gitignore` 的 `.env*` 覆盖）。
Vercel 项目里已配好 5 个：`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` /
`AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`。

换 AI 提供商只改后 3 个，代码零改动——全项目的 AI 调用只穿过 `lib/ai/client.ts`
一个文件。唯一要留意的是那里写死了 `response_format: {type:"json_object"}` 与
`temperature: 0.2`：DeepSeek 与 OpenAI 都支持，但部分本地/国产模型不支持前者，
推理类模型（o 系列、deepseek-reasoner）会拒绝后者。

## 二、手表应用 → rpk（AI 做不了，只能提醒人做）

1. `watch/src/manifest.json` 的 `versionCode` **必须 +1** —— 版本号不变时系统可能
   判定为同一版本而不真正覆盖，改了等于白改（踩过，见 git log）
2. `watch/src/pages/Today/index.ux` 顶部那行版本号一并改，装完在表上一眼确认是不是新包
3. 人工：BlueOS Studio 打开工程 → 用本仓库 `watch/src/` 覆盖 → 编译 → 打包 release → 推到表

`watch/src/config.js` **不在版本控制里**（`config.example.js` 只是模板），
别把示例文件当配置改。

## 三、转发服务 → 重启进程

```bash
ps -eo pid,cmd | grep 'server\.py' | grep -v grep      # 找 pid (别用 pkill -f 'proxy/server.py',
kill <pid>                                             #  那个模式会匹配到你自己这条命令)
cd watch/proxy && nohup python3 server.py >> /tmp/watch-proxy.log 2>&1 &
curl -s --noproxy '*' http://127.0.0.1:8080/health     # {"ok":true,...}
```

上游地址取自 `watch/src/config.js`，该文件不存在时用环境变量 `SUPABASE_URL`。
注意配对码的幂等缓存只在内存里，**正在配对时别重启**。

## 四、数据库 → Supabase SQL Editor（AI 做不了）

新增迁移后**必须明确提醒用户去执行**，AI 手上只有 anon key，建不了表。
迁移一律写成可重复执行。

贴进生产前可以在本地验证：本机 `/data/software/miniconda3/envs/scr2/bin/` 有 PostgreSQL 17，
`initdb` + `pg_ctl` 起个临时实例，造 `auth.users` 表与 `auth.uid()` 替身函数即可跑通全部迁移
（0004 / 0006 / 0007 都是这么先验证再上线的，抓出过真问题）。

# 其它约定

- **GitHub 走直连，不要加代理**：本机 `https_proxy` 的 10809 端口打 `api.github.com` 返 403，
  直连反而 200。`gh` 已登录（账号 `fzg001`），仓库 `FangZhangDev/ai-fitness-tracker`
- 本机 curl 打 localhost 要加 `--noproxy '*'`，否则被代理拦成 502
- 提交信息用**英文 Conventional Commits**（历史已统一）
- 私人信息（真实 Supabase 地址、内网 IP、机器路径）一律不进仓库，
  脱敏对照表在不入库的 `private/README.md`
