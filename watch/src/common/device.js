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

let _prompt = null
try {
  _prompt = require('@blueos.app.prompt')
} catch (e) {}
if (!_prompt) {
  try {
    _prompt = require('@system.prompt')
  } catch (e) {}
}

let _vibrator = null
try {
  _vibrator = require('@blueos.hardware.vibrator')
} catch (e) {}
if (!_vibrator) {
  try {
    _vibrator = require('@system.vibrator')
  } catch (e) {}
}

console.log(
  '[device] router=' + (_routerName || '不可用') +
    ' prompt=' + (_prompt ? 'ok' : '不可用') +
    ' vibrator=' + (_vibrator ? 'ok' : '不可用')
)

/**
 * 安全调用: 方法不存在或抛错都不该让整个页面崩掉。
 * 这些 feature 的方法名未在官方文档逐一列明, 真机上缺哪个都可能是 not a function。
 */
function call(mod, method, arg) {
  if (!mod || typeof mod[method] !== 'function') return false
  try {
    mod[method](arg)
    return true
  } catch (e) {
    console.log('[device] ' + method + ' 调用失败: ' + e)
    return false
  }
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
