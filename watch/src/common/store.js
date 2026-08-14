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

import storage from '@blueos.storage.storage'

const KEY = {
  TOKEN: 'device_token',
  CACHE: 'today_cache',
  PENDING: 'pending_logs',
}

// storage 的 value 类型在不同固件上表现不一致, 统一按 JSON 字符串存取, 保证确定性
function read(key) {
  return new Promise(function (resolve) {
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

// ---------------------------------------------------------------- 计划缓存

export function getCache() {
  return read(KEY.CACHE)
}

export function setCache(weekday, payload) {
  return write(KEY.CACHE, {
    weekday: weekday === undefined || weekday === null ? 0 : weekday,
    payload: payload,
    cachedAt: Date.now(),
  })
}

// ---------------------------------------------------------------- 离线队列

export function getPending() {
  return read(KEY.PENDING).then(function (v) {
    return v && v.length ? v : []
  })
}

/** 入队; 同一天同一动作只保留最后一次 */
export function enqueue(log) {
  return getPending().then(function (list) {
    const next = []
    for (let i = 0; i < list.length; i++) {
      const it = list[i]
      if (!(it.exercise === log.exercise && it.date === log.date)) {
        next.push(it)
      }
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
