/**
 * 屏幕常亮
 *
 * 健身时看着计划做动作, 手一直在忙, 屏幕自动熄灭很打断节奏。
 * 应用在前台时保持常亮, 退到后台立刻恢复系统默认, 避免白白耗电。
 *
 * feature: blueos.hardware.display.brightness
 * 方法: setKeepScreenOn({ keepScreenOn: Boolean })
 */

let _brightness = null
try {
  _brightness = require('@blueos.hardware.display.brightness')
} catch (e) {}

console.log('[screen] brightness=' + (_brightness ? 'ok' : '不可用'))

/**
 * @param {boolean} on true=保持常亮; false=交还系统默认息屏
 * @returns {boolean} 是否调用成功
 */
export function keepOn(on) {
  const m = _brightness
  if (!m) return false
  const target = typeof m.setKeepScreenOn === 'function' ? m : m.default
  if (!target || typeof target.setKeepScreenOn !== 'function') return false
  try {
    target.setKeepScreenOn({
      keepScreenOn: !!on,
      fail: function (data, code) {
        console.log('[screen] setKeepScreenOn 失败 code=' + code)
      },
    })
    return true
  } catch (e) {
    console.log('[screen] setKeepScreenOn 异常: ' + e)
    return false
  }
}
