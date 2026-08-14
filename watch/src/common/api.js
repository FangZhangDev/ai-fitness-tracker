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

// feature 名在官方文档不同页面出现过两种写法:
//   @blueos.communication.network.fetch  「文件组织」「javascript 代码」两页用的是这个
//   @blueos.network.fetch                「卡片配置」页用的是这个
// 以前者优先。
//
// 两个坑:
//  1. require 的参数必须是字面量字符串, 否则编译器静态分析不到, 运行期拿不到模块
//  2. require 拿到的是整个模块对象, 真正的 API 可能包在 default 里
//     (store.js 用 `import storage from` 取的是 default, 所以一直正常;
//      这里用 require 就拿到了外层对象, 直接 .fetch() 会报 not a function)
let _mod = null
let _fetchName = ''
try {
  _mod = require('@blueos.communication.network.fetch')
  _fetchName = '@blueos.communication.network.fetch'
} catch (e) {}
if (!_mod) {
  try {
    _mod = require('@blueos.network.fetch')
    _fetchName = '@blueos.network.fetch'
  } catch (e) {}
}

// 解包: 模块本身 / default / 再深一层, 逐个找出能调用的那个 fetch
let _fetchFn = null
function resolveFetchFn(m) {
  if (!m) return null
  if (typeof m === 'function') return m
  if (typeof m.fetch === 'function') return function (o) { return m.fetch(o) }
  if (m.default) {
    const d = m.default
    if (typeof d === 'function') return d
    if (typeof d.fetch === 'function') return function (o) { return d.fetch(o) }
  }
  // 少数固件把方法叫 request
  if (typeof m.request === 'function') return function (o) { return m.request(o) }
  return null
}
_fetchFn = resolveFetchFn(_mod)

console.log(
  '[api] fetch模块=' + (_fetchName || '不可用') +
    ' 可调用=' + (_fetchFn ? 'yes' : 'NO') +
    ' 结构=' + (_mod ? typeof _mod + ':' + Object.keys(_mod).join('|') : '-') +
    (_mod && _mod.default
      ? ' default:' + typeof _mod.default + ':' + Object.keys(_mod.default).join('|')
      : '')
)

function getFetch() {
  return _fetchFn
}

/** 网络是否可用 (feature 拿不到就是环境不支持) */
export function networkAvailable() {
  return !!getFetch()
}

function once(fn, params) {
  return new Promise(function (resolve, reject) {
    const f = getFetch()
    if (!f) {
      reject({ code: -1, message: 'fetch模块不可用' })
      return
    }
    console.log('[api] -> ' + fn)
    f({
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
          console.log('[api] <- ' + fn + ' ok')
          resolve(body)
        } else {
          const msg = (body && (body.message || body.hint)) || '请求失败'
          console.log('[api] <- ' + fn + ' http' + res.code + ' ' + msg)
          reject({ code: res.code, message: msg })
        }
      },
      fail: function (data, code) {
        // 不要把原始错误吞掉 —— 手表上没别的手段可查, 全靠这里回传
        const detail = typeof data === 'string' ? data : JSON.stringify(data)
        console.log('[api] fail ' + fn + ' code=' + code + ' data=' + detail)
        reject({ code: code === undefined ? -1 : code, message: 'net' + code + ' ' + detail })
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
