/**
 * 表冠节流器 —— 所有用表冠调数值的页面都走这里, 只有一处旋钮可调
 *
 * 为什么需要它:
 *   官方文档说「正常低速情况下 delta 的绝对值恒为 1」, 反过来就是:
 *   稍微转快一点 delta 就会大于 1。之前的实现是把 delta 原样累加,
 *   于是手腕轻轻一带, 一个事件就顶好几格, 数字"嗖"地窜过去 ——
 *   这正是用户反馈的「轻微移动增加就很快」。
 *
 * 两道闸门, 缺一不可:
 *   1. 方向归一化: 每个事件不论 delta 多大都只记 1 格,
 *      彻底切断「转快 = 跳更多」这条路径
 *   2. 计数阈值 + 冷却时间: 攒够 step 个事件才动一格, 且两次变化之间
 *      至少间隔 cooldown 毫秒。上限速度 = 1000/cooldown 格每秒, 与转多快无关
 *
 * 调节方式(唯一的两个旋钮):
 *   step     越大越迟钝, 手感"要转一段才动"
 *   cooldown 越大封顶速度越低, 手感"再快也快不起来"
 *
 * 另外组件上的 rotation-sensitivity 也要设成 1(低灵敏度),
 * 那是系统层的采样, 节流器只能过滤已经发出来的事件。
 */

export function createRotary(options) {
  const opt = options || {}
  // 攒够几个旋转事件才走一格
  const step = opt.step || 4
  // 两次变化之间的最小间隔 (ms)
  const cooldown = opt.cooldown === undefined ? 160 : opt.cooldown

  let acc = 0
  let lastAt = 0

  return {
    /**
     * 喂一个 rotation 事件, 返回本次应该走的方向:
     *   1 = 增, -1 = 减, 0 = 还不到动的时候
     */
    feed(e) {
      if (!e) return 0
      // state 3 = 旋转结束; 松手就清账, 免得残留累积影响下一次
      if (e.state === 3) {
        acc = 0
        return 0
      }

      const d = e.delta
      // delta 只取符号, 不取大小 —— 这是本模块的核心
      // 个别固件只给 direction 不给 delta: 逆时针(正转)为 true
      const dir = d > 0 ? 1 : d < 0 ? -1 : e.direction ? -1 : 1

      // 反向时立即清零, 免得残留的反向累积让第一下没反应
      if ((dir > 0) !== (acc > 0)) acc = 0
      acc += dir
      if (Math.abs(acc) < step) return 0

      // 冷却期内先攒着不消耗, 冷却一过立刻走一格 —— 快转时表现为匀速前进
      const now = Date.now()
      if (now - lastAt < cooldown) return 0

      acc = 0
      lastAt = now
      return dir
    },

    /** 切换字段、进出页面时清账 */
    reset() {
      acc = 0
      lastAt = 0
    },
  }
}
