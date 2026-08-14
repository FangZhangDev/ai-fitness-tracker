/**
 * Supabase RPC 调用封装
 *
 * 只暴露三个后端函数 (见 0004 迁移):
 *   watch_redeem_pairing_code  配对码 -> device token
 *   watch_get_today            取某天的训练计划
 *   watch_submit_logs          批量提交训练记录
 *
 * 手表网络走手机蓝牙代理, 抖动比手机直连大得多, 所以统一带超时 + 指数退避重试。
 */

import { CONFIG } from '../config.js'

// feature 名在官方文档不同页面出现过两种写法, 做兼容避免真机上直接崩
let _fetch = null
function getFetch() {
  if (_fetch) return _fetch
  try {
    _fetch = require('@blueos.network.fetch')
  } catch (e) {
    try {
      _fetch = require('@blueos.communication.network.fetch')
    } catch (e2) {
      _fetch = null
    }
  }
  return _fetch
}

/** 网络是否可用 (feature 拿不到就是环境不支持) */
export function networkAvailable() {
  return !!getFetch()
}

function once(fn, params) {
  return new Promise(function (resolve, reject) {
    const f = getFetch()
    if (!f) {
      reject({ code: -1, message: '当前环境不支持网络请求' })
      return
    }
    f.fetch({
      url: CONFIG.SUPABASE_URL + '/rest/v1/rpc/' + fn,
      method: 'POST',
      responseType: 'json',
      timeout: CONFIG.TIMEOUT,
      header: {
        'Content-Type': 'application/json',
        apikey: CONFIG.ANON_KEY,
        Authorization: 'Bearer ' + CONFIG.ANON_KEY,
      },
      data: JSON.stringify(params || {}),
      success: function (res) {
        // responseType=json 时多数情况已是对象, 但不同固件可能仍给字符串
        let body = res.data
        if (typeof body === 'string') {
          try {
            body = JSON.parse(body)
          } catch (e) {
            // 保持原样, 交给下面的状态码判断
          }
        }
        if (res.code >= 200 && res.code < 300) {
          resolve(body)
        } else {
          const msg = (body && (body.message || body.hint)) || '请求失败'
          reject({ code: res.code, message: msg })
        }
      },
      fail: function (data, code) {
        reject({ code: code, message: '网络不可用' })
      },
    })
  })
}

/** 带指数退避的重试 */
function rpc(fn, params) {
  let attempt = 0
  function run() {
    return once(fn, params).catch(function (err) {
      // 业务错误 (4xx) 重试没意义, 直接抛
      if (err.code >= 400 && err.code < 500) throw err
      if (attempt >= CONFIG.RETRY) throw err
      attempt++
      return new Promise(function (r) {
        setTimeout(r, CONFIG.RETRY_DELAY * attempt)
      }).then(run)
    })
  }
  return run()
}

/** 配对码 -> device token */
export function redeemCode(code) {
  return rpc('watch_redeem_pairing_code', { p_code: code })
}

/**
 * 取训练计划
 * @param {string} token
 * @param {number|null} weekday 1=周一..7=周日; null = 服务端按今天判断
 */
export function getToday(token, weekday) {
  return rpc('watch_get_today', {
    p_token: token,
    p_weekday: weekday === undefined ? null : weekday,
  })
}

/** 批量提交训练记录 (离线补传时一次发多条) */
export function submitLogs(token, logs) {
  return rpc('watch_submit_logs', { p_token: token, p_logs: logs })
}

/** 后端把「token 失效」表达为 unpaired, 手表据此回到配对页 */
export function isUnpaired(err) {
  return !!(err && err.message && err.message.indexOf('unpaired') >= 0)
}
