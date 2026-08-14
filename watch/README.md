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

Supabase → SQL Editor 依次执行（均可重复执行）：

1. `supabase/migrations/0004_watch_pairing.sql` — 配对与三个数据接口
2. `supabase/migrations/0005_watch_max_weight.sql` — 预填改用历史最大重量

## 交互说明

| 操作 | 效果 |
|------|------|
| 点击动作 | 进入记录页 |
| 转表冠 | 调当前选中字段的值（重量 ±0.5kg / 次数 ±1 / RIR ±1） |
| 点击 重量/组数/次数/RIR | 切换当前调节的字段 |
| 长按顶部标题 | 切换训练日（实际健身常会调训练日） |

预填逻辑：已记录过的用今天的实际值，否则用**历史最大重量**（来自 `v_exercise_pr`
视图的 `max_weight_kg`），从没练过则为 0——打开就是自己的最好成绩，通常只需微调。

### 表冠灵敏度（唯一的调节点：`src/common/rotary.js`）

真机上手腕轻轻一带数字就窜飞，原因有两条，都已修掉：

1. 官方文档写着「**低速**时 delta 绝对值恒为 1」，反过来说转快一点 delta 就 > 1。
   原来把 delta 原样累加，于是一个事件顶好几格。现在**只取符号不取大小**，
   一个事件最多算一格。
2. 原来还有一档「velocity > 15 就步进 ×4」的加速，和上面叠在一起就是 2kg 起跳。
   已删除——记录页预填的就是历史最大重量，本来只需微调。

现在两道闸门：攒够 `step` 个事件才动一格，且两次变化至少隔 `cooldown` 毫秒
（封顶速度 = 1000/cooldown 格每秒，**和转多快无关**）。
记录页 `{ step: 4, cooldown: 180 }`，配对页 `{ step: 4, cooldown: 200 }`。
嫌迟钝就把这两个数往下调，别再去动页面里的旋转回调。

另外组件上要写 `rotation-sensitivity="1"`（1=低 / 2=正常 / 3=高）——
那是系统层的采样档位，节流器只能过滤已经发出来的事件，管不到系统发多少。

## 性能注意事项

按官方《手表性能优化》专章写的，改动时留意：

- **不要往 `data` 里塞用不到的字段**，响应式数据越多，diff 越慢（注意只能用 `data`，见下文）
- 列表项的派生文案（如 `subtitle`）在 JS 里一次算好，**不要在模板里写复杂表达式**
- 页面退出时记得释放监听（本应用没有常驻监听，新增时注意）
- 图片资源要压缩；本应用只有一个 114×114 图标，没有其它图片
- 避免频繁 `setInterval`；表冠事件本身触发频率就高，回调里只做算术不做 IO

## ⚠️ 模拟器能跑 ≠ 真机能跑

**这是本项目最大的教训。** 以下四条在 BlueOS Studio 模拟器上一切正常，
到真机上直接白屏，且没有任何报错——排查时几乎无从下手。

写新页面前务必先看这一节；拿不准的语法，直接对照真实开源项目（见文末）。

### 1. 只能用 `data`，不能用 `private` / `protected` / `public`

```js
export default {
  data: { foo: 1 },        // ✅ 唯一可用
  private: { foo: 1 },     // ❌ 真机上所有字段都是 undefined
}
```

三个开源蓝河应用中 `data:` 出现 24 次，`private`/`protected`/`public` **各 0 次**。

真机上 `private` 里的字段全部为 `undefined` → 所有 `if` 条件都是 falsy →
带条件的元素一个都不渲染 → **屏幕上只剩没有条件的那几个元素**。

路由参数也通过 `data` 接收：官方文档写明「使用 data 声明的属性会被外部数据覆盖」。

### 2. 没有 `elif` / `else` 指令

```html
<div if="{{ isA }}">   <!-- ✅ -->
<div elif="{{ isB }}"> <!-- ❌ 真机上从不渲染 -->
<div else>             <!-- ❌ 同上 -->
```

只能写成一组**互斥的独立 `if`**，每个「否则」分支都要有自己的布尔量。
条件里写表达式是允许的（`if="{{ list.length === 0 }}"` 参考项目在用），
但仍建议在 JS 里算好——官方性能文档也这么要求。

另有 `show="{{ }}"` 可用，区别是 `show` 只隐藏、不销毁节点。

### 3. 不要凭空写 `minPlatformVersion`

三个参考项目**都不声明**这个字段。填一个高于真机平台的版本号，行为不可预期。
不确定就别写。

### 4. feature 名必须逐字核对

同一能力在不同文档页给的名字都不一样，只能以能跑的项目为准：

| 能力 | 正确 | 错误/不可用 |
|------|------|------------|
| 路由 | `@blueos.app.appmanager.router` | `@blueos.app.router`（表盘用的） |
| 网络 | `@blueos.network.fetch` | `@blueos.communication.network.fetch`（空壳） |
| 存储 | `@blueos.storage.storage` | — |
| 振动 | `@blueos.hardware.vibrator.**vibrator**` | `@blueos.hardware.vibrator`（少一层） |
| 弹窗 | 未找到可用命名，`showToast` 恒为 undefined | — |

且**必须在 `manifest.json` 的 `features` 里声明**，否则 require 不到。

### 真机排查手段

真机没有 DevTools，只能靠界面自述。本项目在首页顶部保留了一行探针：

```html
<text class="ver">v1.0.4 {{ bootInfo }}</text>
```

- 静态版本号能显示、`{{ bootInfo }}` 却是 `undefined` → **数据声明有问题**（第 1 条）
- 版本号都不显示 → 装的还是旧包（记得每次 `versionCode` + 1）
- 探针正常变化但界面空白 → **条件渲染有问题**（第 2 条）

这一行是当时唯一有效的判据，建议长期保留。

## 参考项目

拿不准的语法，直接对照这些能跑的开源蓝河应用：

- [Sein925/blueos-calculator](https://github.com/Sein925/blueos-calculator) — 手表端科学计算器，结构完整
- [muyanan316/calender_blueos](https://github.com/muyanan316/calender_blueos) — 日历，条件渲染用得多
- [chorblack/BlueOSQuickApp](https://github.com/chorblack/BlueOSQuickApp) — 多个小应用合集

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

两种写法都可用（参考项目用静态 `import`，本项目用 `try + 字面量 require`）。
区别在于：静态 `import` 一个**不存在**的 feature 会让整个模块加载失败，进而拖垮
引用它的页面；`require` 包在 try 里则只是拿不到那一个模块。要写多候选就用后者。

### 4. feature 必须在 manifest 声明，且名字有多个版本

「在使用接口时，需要先在 manifest 中声明接口」——没声明就 `require` 不到。
而同一能力在不同文档页给的名字还不一样，实测结果：

| 能力 | 可用的名字 | 不可用 |
|------|-----------|--------|
| 网络 | `@blueos.network.fetch`、`@system.fetch` | `@blueos.communication.network.fetch` |
| 路由 | `@blueos.app.appmanager.router` | `@blueos.app.router`（那是表盘用的） |
| 存储 | `@blueos.storage.storage`、`@system.storage` | — |
| 振动 | `@blueos.hardware.vibrator.vibrator`（双 vibrator） | `@blueos.hardware.vibrator` |
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

注意：`display` 里也**没有** `titleBar` / `fullScreen` 字段（官方 Display 表只有
`backgroundColor` 一项），别照搬快应用的写法。

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
