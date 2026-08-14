# 健身计划 — vivo Watch 3 蓝河应用

在手表上查看今天该练什么、转表冠微调实际做的重量/次数/RIR、点一下记录。
数据与网页端 `ai-fitness-tracker` 完全打通。

## 它长什么样

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

纯黑底（AMOLED 省电，圆屏边缘自然消隐）+ 单一强调色 `#00E5A0`。

## 架构

```
手表 (蓝河应用)
   │  HTTPS, 蓝牙连手机时自动走手机代理
   ▼
Supabase RPC  ← 直连, 不经过 Vercel
   │  watch_redeem_pairing_code / watch_get_today / watch_submit_logs
   ▼
PostgreSQL (workout_plans / plan_days / plan_exercises / workout_logs)
```

**为什么直连 Supabase 而不走 Vercel**：少一跳，延迟更低；而且绕开了
`vercel.app` 域名在国内访问不稳定的问题（见根目录 `DEPLOY.md`）。

**认证**：手表上不做账号登录（输密码是灾难）。网页生成 6 位配对码，
手表输入一次换取长期 token，之后再不用登录。token 只在兑换时明文返回一次，
数据库只存 sha256 摘要。手表持有的是 Supabase 的 **anon key**（本来就是公开的，
所有表都有 RLS，光靠它查不到任何数据）+ device token。

**离线**：今日计划整份缓存在表上，没网照常看；打勾记录先落本地队列，
联网后自动补传。服务端对「同一天同一动作」是覆盖语义，重复补传不会产生脏数据。

## 目录

```
watch/
├── src/
│   ├── manifest.json          应用配置 / 页面路由 / feature 声明
│   ├── app.ux                 入口
│   ├── config.js              API 地址、主题色、步进与取值范围
│   ├── common/
│   │   ├── api.js             Supabase RPC 封装 + 超时重试
│   │   ├── store.js           K-V 存储 + 离线队列
│   │   ├── sync.js            缓存优先加载 / 补传逻辑
│   │   └── device.js          路由 / 提示 / 振动 (feature 名多版本兼容)
│   ├── pages/
│   │   ├── Today/index.ux     今日计划 (首页)
│   │   ├── Record/index.ux    转表冠记录
│   │   └── Pair/index.ux      配对码输入
│   └── assets/images/icon.png
├── package.json
└── jsconfig.json
```

## 打包成 rpk（在 Windows 上）

> 依赖和构建配置由 BlueOS Studio 生成，所以**推荐先用 Studio 新建一个空工程，
> 再把本目录的 `src/` 覆盖进去**，这样不会因为 toolkit 版本对不上而编译失败。

1. 从服务器拉代码：`git pull`
2. 打开 **BlueOS Studio** → 新建工程
   - 应用名称：`健身计划`
   - 包名：`com.fzg.fitness`（要与 `manifest.json` 一致）
3. 用本目录的 `src/` 覆盖新工程的 `src/`
4. 点「安装依赖」→「重新启动编译」
5. 右侧模拟器实时预览，用 DevTools 面板看日志和网络
6. 菜单「打包」→ 选 release → 生成签名 → 输出 `dist/*.rpk`
7. 用 **OrbitV** 把 rpk 推到 WATCH 3

### 首次运行

1. 网页端打开 `/watch` → 生成配对码
2. 手表打开应用 → 「去配对」→ 转表冠输入 6 位数字 → 确认
3. 配对成功后自动进入今日计划

## 前置：数据库迁移

Supabase → SQL Editor 执行 `supabase/migrations/0004_watch_pairing.sql`（可重复执行）。

## 交互说明

| 操作 | 效果 |
|------|------|
| 点击动作 | 进入记录页 |
| 转表冠 | 调当前选中字段的值（重量 ±0.5kg / 次数 ±1 / RIR ±1） |
| 快速转表冠 | 步进自动 ×4，从 20kg 转到 80kg 不费劲 |
| 点击 重量/组数/次数/RIR | 切换当前调节的字段 |
| 长按顶部标题 | 切换训练日（实际健身常会调训练日） |

预填逻辑：已记录过的用实际值，否则用**上次做这个动作的重量**（来自
`v_exercise_last` 视图），再否则用计划目标——省得每次从 0 开始转。

## 性能注意事项

按官方《手表性能优化》专章写的，改动时留意：

- **不要往 `data`/`private` 里塞用不到的字段**，响应式数据越多，diff 越慢
- 列表项的派生文案（如 `subtitle`）在 JS 里一次算好，**不要在模板里写复杂表达式**
- 页面退出时记得释放监听（本应用没有常驻监听，新增时注意）
- 图片资源要压缩；本应用只有一个 114×114 图标，没有其它图片
- 避免频繁 `setInterval`；表冠事件本身触发频率就高，回调里只做算术不做 IO

## 已知的坑

- **feature 名有多个版本**：官方文档不同页面里 fetch 出现过
  `blueos.network.fetch` 和 `blueos.communication.network.fetch` 两种写法。
  `api.js` 和 `device.js` 都做了逐个 try 的兼容，`manifest.json` 里两个都声明了。
  真机上如果仍报 feature 不存在，看 DevTools 日志确认实际名字再改 `manifest.json`。
- **表冠必须获焦**：一页只能有一个焦点组件，页面里用 `requestFocus(true)` 抢焦点。
  如果表冠没反应，先确认 `onReady` 里拿到了 `$element('root')`。
