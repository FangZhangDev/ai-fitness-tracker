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

## 已知的坑（实机踩过，都有对应 commit）

这些在官方文档里基本查不到，改代码前先看一眼能省很多事。

### 1. `render` 是框架保留名

页面对象里**不能定义叫 `render` 的方法**——蓝河是 MVVM 框架，`render` 属于渲染
引擎内部方法，同名会被覆盖成非函数，调用时报 `not a function`，且方法内的
try/catch 根本进不去（因为压根没进入函数）。本项目改叫 `applyPlan`。
文档只提过「不要用 for/if/show/tid 等保留字」，没列 `render`。

### 2. 原生模块的方法**不可枚举**

`Object.keys(mod)` 对所有 feature 模块一律返回**空数组**，哪怕模块完全可用。
排查时千万别拿 keys 判断有没有方法——只能：

```js
if (typeof mod.fetch === 'function') { /* 可用 */ }
```

（曾据此误判模块是空壳，绕了好几轮。）

### 3. `require` 的参数必须是字面量

编译器靠静态分析 `require('@字面量')` 把 feature 打进包，写成 `require(变量)`
运行期一定拿不到模块。所以候选模块只能一条条平铺展开，不能抽成循环。
更稳的是直接用静态 `import`。

### 4. feature 必须在 manifest 声明，且名字有多个版本

「在使用接口时，需要先在 manifest 中声明接口」——没声明就 `require` 不到。
而同一能力在不同文档页给的名字还不一样，实测结果：

| 能力 | 可用的名字 | 不可用 |
|------|-----------|--------|
| 网络 | `@blueos.network.fetch`、`@system.fetch` | `@blueos.communication.network.fetch` |
| 路由 | `@blueos.app.appmanager.router` | `@blueos.app.router`（那是表盘用的） |
| 存储 | `@blueos.storage.storage`、`@system.storage` | — |
| 振动 | `@blueos.hardware.vibrator` | — |
| 弹窗 | 均未找到，`showToast` 恒为 undefined | `@blueos.app.prompt`、`@system.prompt` |

代码里对每个能力都留了多候选，启动时打印实际命中的名字。

### 5. 路由 uri 认页面名，不认 `path`

`router.push` 的 uri 匹配 `router.pages` 的 **key**（相对 `src` 的目录路径），
自定义 `path` 字段匹配不上。本项目干脆不写 `path`，让它回落到默认
`/<页面名称>`，key 与 uri 天然一致：

```
key "pages/Pair"  →  uri "/pages/Pair"  →  src/pages/Pair/index.ux
```

key 写错会在编译期报 `resolve entries error, error: 4006`。

### 6. `$page.setTitleBar()` 不存在

那是标准快应用（华为/小米系）的 API，蓝河没有，调用会导致启动即崩。
标题栏用 `manifest.json` 的 `display.titleBar` 控制。

### 7. 标量返回值别用 `responseType: 'json'`

后端返回 `text` 时 PostgREST 输出 `"abc123"` 这种带引号的标量 JSON，
`json` 模式下框架的处理不可控，拿到的不是字符串。统一用
`responseType: 'text'` 再自己 `JSON.parse`：`"abc"` → 字符串、`{...}` → 对象、
纯文本 → 原样。

### 8. 表冠必须获焦

一页只能有一个焦点组件，用 `requestFocus(true)` 抢。表冠没反应先确认
`onReady` 里拿到了 `$element('root')`。

### 9. DevTools 的 `DevtoolsElement not found parentId:xx` 可以无视

列表整体替换时 DevTools 的元素树镜像跟不上节点重建，只在连着调试器时出现，
不影响应用，打包到真机上没有。注意它的标签是 `DevtoolsElement` 而非 `CustomLog`
（后者才是应用自己打的日志）。

## 调试

应用启动时会打印各模块的探测结果，出问题先看这几行：

```
[store] storage可用=@blueos.storage.storage
[api] fetch可调用=@blueos.network.fetch
[device] router=@blueos.app.appmanager.router push=function,back=function,replace=function
```

运行期关键节点：

```
[sync] loadToday 开始 wd=null
[sync] 缓存阶段 hit=false
[api] -> watch_get_today
[api] <- watch_get_today http200 type=object raw={...}
[today] applyPlan 完成 1/8
[sync] flushPending 开始 / 待补传 N 条
```

首页出错时 banner 会直接显示错误原文与 stack 首行，点它可重试。
