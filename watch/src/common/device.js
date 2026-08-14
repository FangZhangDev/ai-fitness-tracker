/**
 * 系统能力薄封装 —— 路由 / 提示 / 振动
 *
 * 蓝河的 feature 名在不同文档页与固件版本间出现过多种写法, 这里逐个尝试,
 * 全部拿不到时降级为空实现: 少一个震动反馈没关系, 但绝不能因此白屏。
 */

function pick(names) {
  for (let i = 0; i < names.length; i++) {
    try {
      const m = require(names[i])
      if (m) return m
    } catch (e) {
      // 继续试下一个
    }
  }
  return null
}

const _router = pick(['@blueos.app.router', '@system.router'])
const _prompt = pick(['@blueos.app.prompt', '@system.prompt'])
const _vibrator = pick(['@blueos.hardware.vibrator', '@system.vibrator'])

/** 跳转页面 */
export function push(uri, params) {
  if (!_router) return
  _router.push({ uri: uri, params: params || {} })
}

/** 返回上一页 */
export function back() {
  if (!_router) return
  _router.back()
}

/** 替换当前页 (配对成功后用, 避免返回键回到配对页) */
export function replace(uri, params) {
  if (!_router) return
  if (_router.replace) _router.replace({ uri: uri, params: params || {} })
  else _router.push({ uri: uri, params: params || {} })
}

/** 轻提示 */
export function toast(message) {
  if (!_prompt || !_prompt.showToast) return
  _prompt.showToast({ message: message, duration: 0 })
}

/**
 * 振动反馈。
 * 转表冠时组件自带振动 (vibration-effectEnabled 默认开), 这里只用于
 * 「记录成功」这种需要明确确认感的时刻。
 */
export function vibrate() {
  if (!_vibrator) return
  try {
    if (_vibrator.vibrate) _vibrator.vibrate({ mode: 'short' })
    else if (_vibrator.start) _vibrator.start({ interval: 20, count: 1 })
  } catch (e) {
    // 振动失败无所谓
  }
}
