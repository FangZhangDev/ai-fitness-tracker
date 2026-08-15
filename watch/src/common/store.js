/**
 * 本地存储 + 离线队列
 *
 * 健身房里手机不一定在身边, 蓝牙一断手表就没网。所以:
 *   1. 今日计划整份缓存在表上, 没网也能照常看
 *   2. 打勾记录先落本地队列, 联网后自动补传
 *
 * 服务端 watch_submit_logs 对「同一天同一动作」是覆盖语义, 所以补传
 * 重复提交不会产生脏数据, 队列里同一动作只保留最后一次即可。
 */

// 理由同 api.js: 绝不用静态 import 引 feature
let storageA = null, storageB = null
try { storageA = require('@blueos.storage.storage') } catch (e) {}
try { storageB = require('@system.storage') } catch (e) {}

function resolveStorage(m) {
  if (!m) return null
  if (typeof m.get === 'function' && typeof m.set === 'function') return m
  if (m.default && typeof m.default.get === 'function') return m.default
  return null
}

const STORAGE_CANDIDATES = [
  { name: '@blueos.storage.storage', mod: storageA },
  { name: '@system.storage', mod: storageB },
]

let storage = null
let _storageName = ''
for (let i = 0; i < STORAGE_CANDIDATES.length; i++) {
  const s = resolveStorage(STORAGE_CANDIDATES[i].mod)
  if (s) {
    storage = s
    _storageName = STORAGE_CANDIDATES[i].name
    break
  }
}

// 正常启动不出声; 一个候选都解析不出来才报警, 那是致命的(token 存不下,
// 配对完重启又要重配), 逐个候选的形状交给下面的 storageDiag() 按需取
if (!storage) console.log('[store] 没有可用的 storage: ' + storageDiag())

/** 供界面显示的诊断文本 */
export function storageDiag() {
  if (_storageName) return 'storage ok: ' + _storageName
  const parts = []
  for (let i = 0; i < STORAGE_CANDIDATES.length; i++) {
    const m = STORAGE_CANDIDATES[i].mod
    parts.push(
      STORAGE_CANDIDATES[i].name.replace('@blueos.', '').replace('@', '') +
        ':' + (m ? 'get=' + typeof m.get : 'null')
    )
  }
  return parts.join(' / ')
}

/**
 * 整周缓存的结构版本。
 * v1.3 把 today.done 从 {动作: {weight,sets,reps,rir}} 改成了
 * {动作: {done_sets, sets:[每组]}} —— 版本号对不上时直接当作没有缓存重新拉,
 * 否则新代码读到旧结构会把「已完成」算成 0, 界面看着像记录全丢了。
 */
const CACHE_VER = 2

const KEY = {
  TOKEN: 'device_token',
  WEEK: 'week_cache',
  PENDING: 'pending_logs',
  // v1.1.4 及以前的单日缓存。已废弃, 启动时清掉 ——
  // 手表上的存储不该留没人读的旧键, 越攒越乱
  LEGACY_TODAY: 'today_cache',
}

// storage 的 value 类型在不同固件上表现不一致, 统一按 JSON 字符串存取, 保证确定性
function read(key) {
  return new Promise(function (resolve) {
    // storage 拿不到时直接当作「没有数据」, 不要让 Promise 以异常收场
    if (!storage) {
      resolve(null)
      return
    }
    storage.get({
      key: key,
      default: '',
      success: function (data) {
        if (!data) {
          resolve(null)
          return
        }
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          resolve(null)
        }
      },
      fail: function () {
        resolve(null)
      },
    })
  })
}

function write(key, value) {
  return new Promise(function (resolve) {
    if (!storage) {
      resolve(false)
      return
    }
    storage.set({
      key: key,
      value: JSON.stringify(value),
      success: function () {
        resolve(true)
      },
      fail: function () {
        resolve(false)
      },
    })
  })
}

function remove(key) {
  return new Promise(function (resolve) {
    if (!storage) {
      resolve(false)
      return
    }
    storage.delete({
      key: key,
      success: function () {
        resolve(true)
      },
      fail: function () {
        resolve(false)
      },
    })
  })
}

// ---------------------------------------------------------------- token

export function getToken() {
  return read(KEY.TOKEN)
}

export function setToken(token) {
  return write(KEY.TOKEN, token)
}

export function clearToken() {
  return remove(KEY.TOKEN)
}

// ---------------------------------------------------------------- 整周缓存

/**
 * 整周计划缓存, 形如:
 *   {
 *     version: 'md5',                       // 后端算的, 用来判断计划变没变
 *     days: { '1': { title, exercises } },  // 没安排的周几直接不出现
 *     today: { date: '2026-08-14', done: { '卧推': {...} } },
 *     savedAt: 1723600000000
 *   }
 *
 * 固定一个键、整份覆盖 —— 不按天分键, 否则一年下来会攒出一堆没人读的旧键。
 */
export function getWeek() {
  return read(KEY.WEEK).then(function (c) {
    if (!c) return null
    if (c.cacheVer !== CACHE_VER) {
      console.log('[store] 缓存结构是 v' + (c.cacheVer || 1) + ', 当前要 v' + CACHE_VER + ', 丢弃重拉')
      return null
    }
    return c
  })
}

export function setWeek(cache) {
  if (cache) cache.cacheVer = CACHE_VER
  return write(KEY.WEEK, cache)
}

export function clearWeek() {
  return remove(KEY.WEEK)
}

/** 清掉早期版本留下的单日缓存键; 没有也不报错 */
export function dropLegacyCache() {
  return remove(KEY.LEGACY_TODAY)
}

// ---------------------------------------------------------------- 离线队列

export function getPending() {
  return read(KEY.PENDING).then(function (v) {
    return v && v.length ? v : []
  })
}

/**
 * 入队; 同一天同一动作的同一组只保留最后一次。
 *
 * 去重键带上 set_index 是 v1.3 的关键改动 —— 不带的话第 2 组会把第 1 组顶掉,
 * 一趟离线训练传上去只剩最后一组。
 * 同一组重复入队是正常的: 记完先传一次, 休息结束再带着 rest_sec 传一次,
 * 后者覆盖前者, 服务端只收到一条完整的。
 */
export function enqueue(log) {
  return getPending().then(function (list) {
    const next = []
    for (let i = 0; i < list.length; i++) {
      const it = list[i]
      const same =
        it.exercise === log.exercise &&
        it.date === log.date &&
        it.set_index === log.set_index
      if (!same) next.push(it)
    }
    next.push(log)
    return write(KEY.PENDING, next).then(function () {
      return next
    })
  })
}

export function setPending(list) {
  return write(KEY.PENDING, list || [])
}

export function clearPending() {
  return write(KEY.PENDING, [])
}
