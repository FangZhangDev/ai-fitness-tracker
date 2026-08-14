/**
 * 同步逻辑 —— 把 api 与本地缓存/队列缝合起来
 *
 * 设计原则: 网络永远是「锦上添花」, 不是必要条件。
 * 拉不到就用缓存, 发不出去就进队列, 任何一步失败都不能挡住用户继续练。
 *
 * 缓存策略 (v1.2.0 起):
 *   手表没有 Wi-Fi, 走蓝牙经手机上网, 而转发服务多半只在家/校园网可达 ——
 *   只缓存「今天」一天的话, 出门就等于没有。所以改成:
 *
 *     1. 一次取整周 (watch_get_week), 整份存进一个固定的键
 *     2. 每次联网把上次的 version 带上去; 版本没变就只回一个 178 字节的确认,
 *        缓存原样留用; 版本变了(改了计划、破了 PR)才回整周, 整份覆盖
 *     3. 「今天做了什么」不进版本号 —— 那是天天在变的动态数据, 每次单独回传,
 *        否则缓存天天失效, 增量校验就白做了
 *
 *   固定键 + 整份覆盖, 旧数据自然被顶掉, 不会越攒越多。
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
 * 用缓存 + 本地队列拼出某一天的界面数据。
 * 结构与旧的 watch_get_today 返回值保持一致, 页面那边不用改。
 *
 * 完成状态按「今天的记录」算, 与后端口径一致 —— 手动切到别的训练日时,
 * 打没打勾看的仍是今天做没做过这个动作。
 */
export function buildDayPayload(cache, weekday, pending) {
  const key = String(weekday)
  const day = cache && cache.days ? cache.days[key] : null
  const today = todayStr()

  // 服务端已知的今日完成情况 (跨天了就作废)
  const done = cache && cache.today && cache.today.date === today && cache.today.done
    ? cache.today.done
    : {}

  // 本地队列里今天的记录也算完成 —— 没网时打的勾要立刻显示出来,
  // 否则用户会以为没记上, 又记一遍
  const local = {}
  const list = pending || []
  for (let i = 0; i < list.length; i++) {
    if (list[i] && list[i].date === today) local[list[i].exercise] = list[i]
  }

  const src = day && day.exercises ? day.exercises : []
  const out = []
  let doneCount = 0
  for (let i = 0; i < src.length; i++) {
    const e = src[i]
    const d = local[e.exercise] || done[e.exercise] || null
    if (d) doneCount++
    out.push({
      exercise: e.exercise,
      target_sets: e.target_sets,
      rep_min: e.rep_min,
      rep_max: e.rep_max,
      rir_min: e.rir_min,
      rir_max: e.rir_max,
      max_weight_kg: e.max_weight_kg,
      done: !!d,
      done_weight_kg: d ? d.weight_kg : null,
      done_sets: d ? d.sets : null,
      done_reps: d ? d.reps : null,
      done_rir: d ? d.rir : null,
    })
  }

  return {
    date: today,
    weekday: weekday,
    title: day ? day.title : null,
    exercises: out,
    done_count: doneCount,
    total_count: out.length,
  }
}

/** 缓存存了多少天了; 没缓存返回 -1 */
export function cacheAgeDays(cache) {
  if (!cache || !cache.savedAt) return -1
  const ms = Date.now() - cache.savedAt
  if (ms < 0) return 0
  return Math.floor(ms / 86400000)
}

/**
 * 载入某天的计划。
 * 先用缓存回调一次让界面立刻有内容, 再联网校验版本 —— 手表上首屏速度
 * 比数据新鲜度重要, 何况多数时候根本连不上。
 *
 * @param {string} token
 * @param {number|null} weekday null = 跟随今天
 * @param {function} onData 可能被调用两次: 先缓存(fromCache=true), 后网络
 * @returns {Promise} resolve 表示联网校验成功; reject 表示只能用缓存
 */
export function loadWeek(token, weekday, onData) {
  // 没指定就跟随今天; 联网后改用服务端算的周几(它按 Asia/Shanghai), 更权威
  const auto = weekday === undefined || weekday === null
  const wd = auto ? todayWeekday() : weekday
  console.log('[sync] loadWeek 开始 wd=' + wd + ' auto=' + auto)

  let cached = null

  return store
    .getWeek()
    .then(function (cache) {
      cached = cache
      return store.getPending()
    })
    .catch(function (e) {
      // 缓存/队列读失败不该影响后面的网络请求
      console.log('[sync] 读缓存异常(忽略): ' + e)
      return []
    })
    .then(function (pending) {
      if (cached && cached.days) {
        console.log('[sync] 缓存命中 ver=' + cached.version + ' 天数=' + Object.keys(cached.days).length)
        // 第三个参数是缓存的天数, 界面据此提示「几天前的计划」
        onData(buildDayPayload(cached, wd, pending), true, cacheAgeDays(cached))
      }

      return api
        .getWeek(token, cached ? cached.version : null)
        .then(function (res) {
          return applyWeekResponse(token, cached, res, auto ? null : wd, onData)
        })
        .catch(function (err) {
          // 后端还没跑 0006 迁移: 回落到旧的单日接口, 至少今天能用
          if (api.isMissingWeekRpc(err)) {
            console.log('[sync] 后端无 watch_get_week, 回落单日接口(请执行 0006 迁移)')
            return api.getToday(token, weekday).then(function (payload) {
              onData(payload, false, 0)
              return payload
            })
          }
          throw err
        })
    })
}

/**
 * 处理 watch_get_week 的返回: 该覆盖就整份覆盖, 没变就只更新今日完成情况
 * @param {number|null} wd 指定的周几; null = 跟随服务端算的今天
 */
function applyWeekResponse(token, cached, res, wd, onData) {
  if (!res) throw { code: -1, message: '空响应' }

  // 理论上不会发生(有缓存才会带 version), 兜一下: 拿版本号却没有天数, 重取全量
  if (res.unchanged && !(cached && cached.days)) {
    console.log('[sync] unchanged 但本地没有天数, 重取全量')
    return api.getWeek(token, null).then(function (full) {
      return applyWeekResponse(token, null, full, wd, onData)
    })
  }

  const next = {
    version: res.version,
    days: res.unchanged ? cached.days : res.days || {},
    today: { date: res.date, done: res.today_done || {} },
    // 版本没变时保留原来的时间, 让「几天前同步的」显示的是计划的年龄
    savedAt: res.unchanged && cached ? cached.savedAt : Date.now(),
  }
  console.log(
    '[sync] 联网校验 ' + (res.unchanged ? '版本未变, 沿用缓存' : '版本已变, 整份覆盖') +
      ' ver=' + res.version
  )

  // 没指定就用服务端算的周几(Asia/Shanghai), 手表时区不对也不会错位
  const day = wd === null || wd === undefined ? res.weekday || todayWeekday() : wd

  return store.getPending().then(function (pending) {
    const payload = buildDayPayload(next, day, pending)
    onData(payload, false, 0)
    // 写缓存失败不影响本次显示, 下次再写
    return store.setWeek(next).then(function () {
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
