/**
 * 屏幕常亮 —— 「有交互就续 30 秒」
 *
 * 健身时手一直在忙, 屏幕说灭就灭很打断节奏; 但整个前台期间都强制常亮又太费电
 * (真机上一次训练能亮四十分钟)。折中: 每次交互把屏幕点亮并续期 HOLD_MS,
 * 到点自动交还系统默认息屏。
 *
 * 系统本身的息屏时间通常只有几秒, 所以这里的 30 秒是「看一眼计划、做完一组
 * 再抬手」够用、又不至于空烧的量。嫌短就改 HOLD_MS 一个数, 这是唯一的旋钮。
 *
 * feature: blueos.hardware.display.brightness
 * 方法: setKeepScreenOn({ keepScreenOn: Boolean })
 */

let _brightness = null
try {
  _brightness = require('@blueos.hardware.display.brightness')
} catch (e) {}

console.log('[screen] brightness=' + (_brightness ? 'ok' : '不可用'))

/** 无交互多久之后交还系统息屏 (ms) */
const HOLD_MS = 30000

let _timer = null
// 记住当前状态: 表冠事件每秒能来十几个, 不能每次都去调原生接口
let _on = false

/** 真正去调原生接口; 状态没变就不调 */
function apply(on) {
  if (on === _on) return true
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
    _on = !!on
    return true
  } catch (e) {
    console.log('[screen] setKeepScreenOn 异常: ' + e)
    return false
  }
}

/**
 * 有交互了: 点亮并续 30 秒。
 * 进页面、转表冠、点列表都该调它, 调多少次都不贵(状态没变就不碰原生接口)。
 */
export function awake() {
  const ok = apply(true)
  if (_timer) clearTimeout(_timer)
  _timer = setTimeout(function () {
    _timer = null
    apply(false)
  }, HOLD_MS)
  return ok
}

/** 退到后台: 立刻交还系统默认息屏, 不留计时器 */
export function release() {
  if (_timer) {
    clearTimeout(_timer)
    _timer = null
  }
  return apply(false)
}
