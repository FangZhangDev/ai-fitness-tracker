/**
 * 系统能力薄封装 —— 路由 / 提示 / 振动
 *
 * 蓝河的 feature 名在不同文档页与固件版本间出现过多种写法, 这里逐个尝试,
 * 全部拿不到时降级为空实现: 少一个震动反馈没关系, 但绝不能因此白屏。
 */

// ---------------------------------------------------------------------------
// 关键: require 的参数必须是「字面量字符串」
//
// 快应用/蓝河的编译器要靠静态分析 require('@xxx') 才能把对应 feature 打进包里。
// 写成 require(变量) 时编译器识别不了, 运行期一律拿不到模块 —— 曾因此导致
// 路由模块全部为 null, 表现为按钮点了没反应。所以下面只能一条条平铺展开,
// 不能再抽成 pick(names) 那种循环。
//
// 蓝河应用的路由是 @blueos.app.appmanager.router;
// @blueos.app.router 是表盘用的, 留作兜底。
// ---------------------------------------------------------------------------

let _router = null
let _routerName = ''
try {
  _router = require('@blueos.app.appmanager.router')
  _routerName = '@blueos.app.appmanager.router'
} catch (e) {}
if (!_router) {
  try {
    _router = require('@blueos.app.router')
    _routerName = '@blueos.app.router'
  } catch (e) {}
}
if (!_router) {
  try {
    _router = require('@system.router')
    _routerName = '@system.router'
  } catch (e) {}
}

// 实测 @blueos.app.prompt 与 @system.prompt 的 showToast 都是 undefined,
// 官方文档「通知能力 > 弹窗」未给出确切 feature 名, 这里再多试一个命名。
// 拿不到也不影响使用: 记录成功有振动反馈, 返回列表还能看到 ✓ 与进度变化。
let _prompt = null
try {
  _prompt = require('@blueos.notification.prompt')
} catch (e) {}
if (!_prompt) {
  try {
    _prompt = require('@blueos.app.prompt')
  } catch (e) {}
}
if (!_prompt) {
  try {
    _prompt = require('@system.prompt')
  } catch (e) {}
}

// 注意是双 vibrator: @blueos.hardware.vibrator.vibrator
// (开源蓝河应用 blueos-calculator 用的就是这个, 单 vibrator 是我此前写错的)
let _vibrator = null
try {
  _vibrator = require('@blueos.hardware.vibrator.vibrator')
} catch (e) {}
if (!_vibrator) {
  try {
    _vibrator = require('@blueos.hardware.vibrator')
  } catch (e) {}
}

console.log(
  '[device] router=' + (_routerName || '不可用') +
    ' ' + shape(_router, ['push', 'back', 'replace'])
)
console.log(
  '[device] prompt ' + shape(_prompt, ['showToast']) +
    ' | vibrator ' + shape(_vibrator, ['vibrate', 'start'])
)

/**
 * 安全调用: 方法不存在或抛错都不该让整个页面崩掉。
 * 这些 feature 的方法名未在官方文档逐一列明, 真机上缺哪个都可能是 not a function。
 */
function call(mod, method, arg) {
  if (!mod) return false
  // require 拿到的可能是整个模块对象, 真正的 API 包在 default 里, 两处都试
  const targets = [mod, mod.default]
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]
    if (t && typeof t[method] === 'function') {
      try {
        t[method](arg)
        return true
      } catch (e) {
        console.log('[device] ' + method + ' 调用失败: ' + e)
        return false
      }
    }
  }
  console.log('[device] ' + method + ' 不存在')
  return false
}

/**
 * 探测模块上指定方法是否存在。
 * 注意: 蓝河原生模块的方法不可枚举, Object.keys() 一律为空 —— router 明明能用
 * 却打印出空 keys, 曾因此误判。所以只按方法名逐个 typeof, 不看 keys。
 */
function shape(m, methods) {
  if (!m) return 'null'
  const parts = []
  for (let i = 0; i < methods.length; i++) {
    parts.push(methods[i] + '=' + typeof m[methods[i]])
  }
  if (m.default) parts.push('hasDefault')
  return parts.join(',')
}

/** 路由是否可用 —— 页面可据此给出提示, 而不是让用户对着没反应的按钮发呆 */
export function routerReady() {
  return !!_router
}

/** 跳转页面; 返回是否成功发起 */
export function push(uri, params) {
  return call(_router, 'push', { uri: uri, params: params || {} })
}

/** 返回上一页 */
export function back() {
  return call(_router, 'back')
}

/** 替换当前页 (配对成功后用, 避免返回键回到配对页) */
export function replace(uri, params) {
  const arg = { uri: uri, params: params || {} }
  if (!call(_router, 'replace', arg)) call(_router, 'push', arg)
}

/** 轻提示 */
export function toast(message) {
  call(_prompt, 'showToast', { message: message, duration: 0 })
}

/**
 * 振动反馈。
 * 转表冠时组件自带振动 (vibration-effectEnabled 默认开), 这里只用于
 * 「记录成功」这种需要明确确认感的时刻。
 */
export function vibrate() {
  if (!call(_vibrator, 'vibrate', { mode: 'short' })) {
    call(_vibrator, 'start', { interval: 20, count: 1 })
  }
}
