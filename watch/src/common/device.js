/**
 * 系统能力薄封装 —— 路由 / 提示 / 振动
 *
 * 蓝河的 feature 名在不同文档页与固件版本间出现过多种写法, 这里逐个尝试,
 * 全部拿不到时降级为空实现: 少一个震动反馈没关系, 但绝不能因此白屏。
 */

function pick(label, names) {
  for (let i = 0; i < names.length; i++) {
    try {
      const m = require(names[i])
      if (m) {
        console.log('[device] ' + label + ' 使用 ' + names[i])
        return m
      }
    } catch (e) {
      // 继续试下一个
    }
  }
  console.log('[device] ' + label + ' 全部候选都不可用: ' + names.join(', '))
  return null
}

// 注意: 蓝河应用里路由是 @blueos.app.appmanager.router
// (@blueos.app.router 那个是表盘用的)。所有 feature 都必须先在
// manifest.json 的 features 里声明, 否则 require 直接拿不到。
const _router = pick('router', [
  '@blueos.app.appmanager.router',
  '@blueos.app.router',
  '@system.router',
])
const _prompt = pick('prompt', ['@blueos.app.prompt', '@system.prompt'])
const _vibrator = pick('vibrator', ['@blueos.hardware.vibrator', '@system.vibrator'])

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
