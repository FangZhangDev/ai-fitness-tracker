/**
 * 同步逻辑 —— 把 api 与本地缓存/队列缝合起来
 *
 * 设计原则: 网络永远是「锦上添花」, 不是必要条件。
 * 拉不到就用缓存, 发不出去就进队列, 任何一步失败都不能挡住用户继续练。
 */

import * as api from './api.js'
import * as store from './store.js'

/** 本地日期 yyyy-mm-dd (手表系统时区) */
export function todayStr() {
  const d = new Date()
  const m = d.getMonth() + 1
  const day = d.getDate()
  return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day)
}

/** 今天是周几: 1=周一 .. 7=周日 (与 plan_days.weekday 对齐) */
export function todayWeekday() {
  const w = new Date().getDay() // 0=周日
  return w === 0 ? 7 : w
}

/**
 * 把离线队列里的记录补传上去。
 * 队列为空或没网都算「无事发生」, 不抛错。
 * @returns {Promise<number>} 成功补传的条数
 */
export function flushPending(token) {
  if (!token) return Promise.resolve(0)
  console.log('[sync] flushPending 开始')
  return store.getPending().then(function (list) {
    console.log('[sync] 待补传 ' + (list ? list.length : 0) + ' 条')
    if (!list.length) return 0
    return api
      .submitLogs(token, list)
      .then(function () {
        return store.clearPending().then(function () {
          return list.length
        })
      })
      .catch(function (err) {
        // token 失效要让上层知道, 其它错误(没网)保留队列下次再试
        if (api.isUnpaired(err)) throw err
        return 0
      })
  })
}

/**
 * 载入某天的计划。
 * 先回调缓存让界面立刻有内容, 再请求网络刷新 —— 手表上首屏速度比数据新鲜度重要。
 *
 * @param {string} token
 * @param {number|null} weekday
 * @param {function} onData 可能被调用两次: 先缓存, 后网络
 * @returns {Promise} resolve 表示网络刷新成功; reject 表示只能用缓存
 */
export function loadToday(token, weekday, onData) {
  const wd = weekday === undefined ? null : weekday
  console.log('[sync] loadToday 开始 wd=' + wd)

  // 1) 缓存优先渲染 (仅当缓存的是同一个训练日)
  const cachePhase = store
    .getCache()
    .then(function (c) {
      console.log('[sync] 缓存阶段 hit=' + !!(c && c.payload))
      if (c && c.payload && (wd === null || c.weekday === wd)) {
        onData(c.payload, true)
        return true
      }
      return false
    })
    .catch(function (e) {
      // 缓存读失败不该影响后面的网络请求
      console.log('[sync] 缓存阶段异常(忽略): ' + e)
      return false
    })

  // 2) 网络刷新
  return cachePhase.then(function () {
    console.log('[sync] 请求 getToday')
    return api.getToday(token, wd).then(function (payload) {
      console.log('[sync] getToday 返回 total=' + (payload && payload.total_count))
      onData(payload, false)
      try {
        store.setCache(wd === null ? payload.weekday : wd, payload)
      } catch (e) {
        console.log('[sync] 写缓存失败(忽略): ' + e)
      }
      return payload
    })
  })
}

/**
 * 记录一个动作。
 * 无论有没有网, 都先入队 —— 保证「点了完成就一定不会丢」。
 * 有网时立刻尝试整队补传。
 *
 * @returns {Promise<boolean>} true = 已同步到服务器, false = 暂存本地
 */
export function recordExercise(token, log) {
  return store.enqueue(log).then(function () {
    return flushPending(token)
      .then(function (n) {
        return n > 0
      })
      .catch(function (err) {
        if (api.isUnpaired(err)) throw err
        return false
      })
  })
}
