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
 * 把刚补传成功的记录并进整周缓存的今日完成情况。
 *
 * 不做这一步的话会有个很显眼的毛病: 记完一组返回列表, 那个勾会先消失一下 ——
 * 队列已经清空, 而缓存里的 today.done 还是上次联网时的旧值, 于是靠缓存拼出来的
 * 首屏把这个动作画成未完成, 要等网络回来才补上。走蓝牙转发时这个空窗有一两秒。
 *
 * today.done 不参与 version 计算(它天天在变), 所以这里只动 today 字段,
 * version / savedAt 都保持原样, 不会影响下次的增量校验, 也不会让
 * 「几天前的计划」那条提示错乱。
 */
function mergeDoneIntoCache(logs) {
  return store.getWeek().then(function (cache) {
    // 没缓存就没什么可并的 —— 下一次联网本来就会整份取回
    if (!cache) return
    const today = todayStr()
    // 缓存里的完成情况跨天就作废, 与 buildDayPayload 的口径保持一致
    const done =
      cache.today && cache.today.date === today && cache.today.done
        ? cache.today.done
        : {}
    let n = 0
    for (let i = 0; i < logs.length; i++) {
      const g = logs[i]
      // 补传的可能是昨天攒下的, 那些不该算进今天
      if (!g || g.date !== today) continue
      const entry = done[g.exercise] || { done_sets: 0, sets: [] }
      const sets = entry.sets || []
      // 同一组号覆盖, 不是追加 —— 记完一组之后还会补一次 rest_sec
      let hit = -1
      for (let k = 0; k < sets.length; k++) {
        if (sets[k].set_index === g.set_index) { hit = k; break }
      }
      const one = {
        set_index: g.set_index,
        weight_kg: g.weight_kg,
        reps: g.reps,
        rir: g.rir,
        is_warmup: !!g.is_warmup,
      }
      if (hit >= 0) sets[hit] = one
      else sets.push(one)
      entry.sets = sets
      entry.done_sets = countWorkSets(sets)
      done[g.exercise] = entry
      n++
    }
    if (!n) return
    cache.today = { date: today, done: done }
    return store.setWeek(cache)
  })
}

/** 工作组数 (热身不算) */
function countWorkSets(sets) {
  let n = 0
  for (let i = 0; i < (sets || []).length; i++) if (!sets[i].is_warmup) n++
  return n
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
        // 先并进缓存再清队列: 万一中间断电, 队列还在, 大不了重传一次 ——
        // 服务端对「同一天同一动作」是覆盖语义, 重传不会脏数据
        return mergeDoneIntoCache(list).then(function () {
          return store.clearPending().then(function () {
            return list.length
          })
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
 *
 * 完成状态按「今天记了哪些组」算, 与服务端口径一致 —— 手动切到别的训练日时,
 * 看的仍是今天做没做过这个动作。
 *
 * done_count / total_count 从「几个动作」改成了「几组」: 一个动作四组只做完两组,
 * 进度条该走一半, 而不是零或整。
 */
export function buildDayPayload(cache, weekday, pending) {
  const key = String(weekday)
  const day = cache && cache.days ? cache.days[key] : null
  const today = todayStr()

  // 服务端已知的今日完成情况 (跨天了就作废)
  const done = cache && cache.today && cache.today.date === today && cache.today.done
    ? cache.today.done
    : {}

  // 本地队列里今天的记录也算完成 —— 没网时记的组要立刻显示出来,
  // 否则用户会以为没记上, 又记一遍
  const local = {}
  const list = pending || []
  for (let i = 0; i < list.length; i++) {
    const g = list[i]
    if (!g || g.date !== today) continue
    const arr = local[g.exercise] || (local[g.exercise] = [])
    arr.push({
      set_index: g.set_index,
      weight_kg: g.weight_kg,
      reps: g.reps,
      rir: g.rir,
      is_warmup: !!g.is_warmup,
    })
  }

  const src = day && day.exercises ? day.exercises : []
  const out = []
  let doneSets = 0
  let planSets = 0
  for (let i = 0; i < src.length; i++) {
    const e = src[i]
    const sets = mergeSets(done[e.exercise], local[e.exercise])
    const nDone = countWorkSets(sets)
    // 目标组数缺失时按 1 算, 免得进度条分母为 0
    const nPlan = e.target_sets || 1
    doneSets += nDone > nPlan ? nPlan : nDone
    planSets += nPlan
    const lastSet = sets.length ? sets[sets.length - 1] : null
    out.push({
      exercise: e.exercise,
      target_sets: e.target_sets,
      rep_min: e.rep_min,
      rep_max: e.rep_max,
      rir_min: e.rir_min,
      rir_max: e.rir_max,
      rest_sec: e.rest_sec,
      max_weight_kg: e.max_weight_kg,
      // 已记的组: 记录页拿它决定下一组是第几组、预填什么
      sets: sets,
      done_sets: nDone,
      done: nDone > 0,
      // 最后一组的数值, 下一组照着它预填 —— 多数时候两组是一样的
      last_weight_kg: lastSet ? lastSet.weight_kg : null,
      last_reps: lastSet ? lastSet.reps : null,
      last_rir: lastSet ? lastSet.rir : null,
    })
  }

  return {
    date: today,
    weekday: weekday,
    title: day ? day.title : null,
    exercises: out,
    done_count: doneSets,
    total_count: planSets,
  }
}

/**
 * 服务端已知的组 + 本地队列里的组, 合成一份按组号排好的清单。
 * 同一组号以本地为准 —— 本地是刚记的, 服务端那份还是上次同步时的。
 */
function mergeSets(serverEntry, localSets) {
  const byIdx = {}
  const server = serverEntry && serverEntry.sets ? serverEntry.sets : []
  for (let i = 0; i < server.length; i++) byIdx[server[i].set_index] = server[i]
  const local = localSets || []
  for (let i = 0; i < local.length; i++) byIdx[local[i].set_index] = local[i]

  const out = []
  for (const k in byIdx) {
    if (Object.prototype.hasOwnProperty.call(byIdx, k)) out.push(byIdx[k])
  }
  out.sort(function (a, b) {
    return a.set_index - b.set_index
  })
  return out
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
