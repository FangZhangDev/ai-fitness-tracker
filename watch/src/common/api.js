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

// ---------------------------------------------------------------------------
// 蓝河的原生模块方法是「不可枚举」的: Object.keys(mod) 一律返回空数组,
// 但方法确实存在且可调用 (router 就是最好的例子 —— keys 为空却能正常跳转)。
// 所以判断一个模块能不能用, 唯一可靠的方式是直接 typeof mod.xxx === 'function',
// 绝不能看 keys。
//
// feature 名官方文档给了两个, 实测 @blueos.communication.network.fetch
// import 进来 .fetch 不是函数, 即该 feature 未注入; API 参考页写的
// @blueos.network.fetch 才是正解。三个候选全部静态 import ——
// require 在本工程实测拿不到东西, 而 import 一个不存在的 feature 只会得到
// 空对象, 不会崩, 因此可以安全地都写上, 运行时挑能用的那个。
// ---------------------------------------------------------------------------
import fetchA from '@blueos.network.fetch'
import fetchB from '@blueos.communication.network.fetch'
import fetchC from '@system.fetch'

/** 从一个模块里解出可调用的 fetch 函数; 解不出返回 null */
function resolveFetchFn(m) {
  if (!m) return null
  if (typeof m === 'function') return m
  if (typeof m.fetch === 'function') return function (o) { return m.fetch(o) }
  if (typeof m.request === 'function') return function (o) { return m.request(o) }
  if (m.default) {
    const d = m.default
    if (typeof d === 'function') return d
    if (typeof d.fetch === 'function') return function (o) { return d.fetch(o) }
    if (typeof d.request === 'function') return function (o) { return d.request(o) }
  }
  return null
}

/** 探测单个模块, 只看方法类型, 不看 keys */
function probe(m) {
  if (!m) return 'null'
  if (typeof m === 'function') return 'isFn'
  return (
    'fetch=' + typeof m.fetch +
    ' request=' + typeof m.request +
    ' default=' + typeof m.default
  )
}

const CANDIDATES = [
  { name: '@blueos.network.fetch', mod: fetchA },
  { name: '@blueos.communication.network.fetch', mod: fetchB },
  { name: '@system.fetch', mod: fetchC },
]

let _fetchFn = null
let _fetchName = ''
for (let i = 0; i < CANDIDATES.length; i++) {
  const fn = resolveFetchFn(CANDIDATES[i].mod)
  if (fn) {
    _fetchFn = fn
    _fetchName = CANDIDATES[i].name
    break
  }
}

console.log('[api] fetch可调用=' + (_fetchFn ? _fetchName : 'NO'))
for (let i = 0; i < CANDIDATES.length; i++) {
  console.log('[api]   ' + CANDIDATES[i].name + ' -> ' + probe(CANDIDATES[i].mod))
}

function getFetch() {
  return _fetchFn
}

/**
 * 一行诊断文本, 直接显示到手表屏幕上。
 * 手表上翻 DevTools 不方便, 出问题时把模块的真实形状摆到界面上最省事。
 */
export function diagText() {
  if (_fetchFn) return 'fetch ok: ' + _fetchName
  // 三个候选逐个报告方法类型 (keys 不可枚举, 看它没意义)
  const parts = []
  for (let i = 0; i < CANDIDATES.length; i++) {
    const short = CANDIDATES[i].name.replace('@blueos.', '').replace('@', '')
    parts.push(short + ':' + probe(CANDIDATES[i].mod))
  }
  return parts.join('  /  ')
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
