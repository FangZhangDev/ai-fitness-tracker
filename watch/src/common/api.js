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
// 蓝河原生模块的方法「不可枚举」: Object.keys(mod) 恒为空数组, 但方法确实存在。
// 判断可用性唯一可靠的方式是 typeof mod.xxx === 'function', 绝不能看 keys。
// ---------------------------------------------------------------------------
// 一律用 try+字面量 require, 不用静态 import ——
// 静态 import 一个真机上不存在的 feature 会让整个模块加载失败,
// 进而拖垮引用它的页面(表现为页面 JS 完全不执行, 只剩静态元素渲染)。
// require 失败只是拿不到该模块, 不影响其余代码。
// 网络状态: getType() 直接回答「手表现在有没有网」, 比打请求更直接。
// 返回值可能为 2g/3g/4g/5g/wifi/bluetooth/none/others —— 手表经手机联网时为 bluetooth。
let _netMgr = null
try { _netMgr = require('@blueos.network.networkManager') } catch (e) {}

let fetchA = null, fetchB = null, fetchC = null
try { fetchA = require('@blueos.network.fetch') } catch (e) {}
try { fetchB = require('@system.fetch') } catch (e) {}
try { fetchC = require('@blueos.communication.network.fetch') } catch (e) {}

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
  { name: '@system.fetch', mod: fetchB },
  { name: '@blueos.communication.network.fetch', mod: fetchC },
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
    // fetch 本身也可能同步抛异常(参数不合法、模块内部错误), 不接住的话
    // Promise 会以一个非预期的 Error 结束, 上层拿不到有用信息
    try {
      f({
      url: CONFIG.API_BASE + '/rest/v1/rpc/' + fn,
      method: 'POST',
      // 一律按 text 收, 再自己 JSON.parse。
      // 用 'json' 时框架对「标量返回值」的处理不可控 —— 后端
      // watch_redeem_pairing_code 返回的是 text, PostgREST 输出为 "abc123"
      // 这种带引号的 JSON 字符串, 曾因此拿到非字符串值而误报「配对码无效」。
      responseType: 'text',
      timeout: CONFIG.TIMEOUT,
      header: {
        'Content-Type': 'application/json',
        apikey: CONFIG.ANON_KEY,
        Authorization: 'Bearer ' + CONFIG.ANON_KEY,
      },
      data: JSON.stringify(params || {}),
      success: function (res) {
        const raw = res.data
        // JSON.parse 能把 "abc" 还原成字符串 abc, 把 {...} 还原成对象;
        // 解析失败(纯文本)就用原值
        let body = raw
        if (typeof raw === 'string') {
          const t = raw.trim()
          try {
            body = JSON.parse(t)
          } catch (e) {
            body = t
          }
        }
        console.log(
          '[api] <- ' + fn + ' http' + res.code + ' type=' + typeof body +
            ' raw=' + String(raw).substring(0, 50)
        )
        if (res.code >= 200 && res.code < 300) {
          resolve(body)
        } else {
          const msg =
            (body && (body.message || body.hint)) || String(body) || '请求失败'
          reject({ code: res.code, message: msg })
        }
      },
      fail: function (data, code) {
        // 不要把原始错误吞掉 —— 手表上没别的手段可查, 全靠这里回传。
        // 实测 HTTP 4xx 也走这个回调, 且 data 里通常没有响应体, 所以
        // code 才是唯一可靠的信息, 上层要按它判断(见 Pair 页对 400 的处理)。
        const detail = typeof data === 'string' ? data : JSON.stringify(data)
        console.log('[api] fail ' + fn + ' code=' + code + ' data=' + detail)
        // 万一固件把响应体给了过来, 优先用后端的 message
        let msg = ''
        if (typeof data === 'string' && data.indexOf('message') >= 0) {
          try {
            const o = JSON.parse(data)
            if (o && o.message) msg = o.message
          } catch (e) {}
        }
        reject({
          code: code === undefined ? -1 : code,
          message: msg || 'net' + code + ' ' + detail,
        })
      },
      })
    } catch (e) {
      console.log('[api] fetch 同步抛异常 ' + fn + ': ' + e)
      reject({ code: -2, message: 'fetch异常:' + e })
    }
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

/**
 * 配对码 -> device token
 * 后端返回的是 text, 这里统一归一成纯字符串 token, 顺带剥掉可能残留的引号。
 */
export function redeemCode(code) {
  return rpc('watch_redeem_pairing_code', { p_code: code }).then(function (v) {
    // 转发服务已把标量 token 包成 {"token": "..."} —— 蓝河 fetch 对标量 JSON
    // 的解析不可控(实测手表侧拿到的是对象, String() 后成了 "[object Object]"),
    // 包一层对象后无论框架怎么解析都能稳定取到。
    let s = ''
    if (v && typeof v === 'object' && typeof v.token === 'string') {
      s = v.token
    } else if (typeof v === 'string') {
      s = v
    } else if (v !== null && v !== undefined) {
      s = String(v)
    }
    s = s.trim()
    if (s.length >= 2 && s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') {
      s = s.substring(1, s.length - 1)
    }
    console.log('[api] token 长度=' + s.length + ' 原始类型=' + typeof v)
    return s
  })
}

/**
 * token 体检 —— 不合格就本地拦下, 不要发出去。
 *
 * JSON.stringify 会把值为 undefined 的字段整个丢掉, 于是 { p_token: undefined }
 * 发出去就成了 {"p_weekday":null}, PostgREST 找不到匹配签名, 回的是 404
 * (实测日志里就有这么一条), 排查时极具误导性 —— 看着像接口没部署。
 * 这里统一转成 'invalid token', isUnpaired() 认得它, 上层会清 token 回配对页。
 */
function requireToken(token) {
  if (typeof token !== 'string' || token.length < 32) {
    console.log('[api] token 不合格, 本地拦截 type=' + typeof token)
    return Promise.reject({ code: 401, message: 'invalid token' })
  }
  return null
}

/**
 * 取训练计划
 * @param {string} token
 * @param {number|null} weekday 1=周一..7=周日; null = 服务端按今天判断
 */
export function getToday(token, weekday) {
  const bad = requireToken(token)
  if (bad) return bad
  return rpc('watch_get_today', {
    p_token: token,
    p_weekday: weekday === undefined ? null : weekday,
  })
}

/** 批量提交训练记录 (离线补传时一次发多条) */
export function submitLogs(token, logs) {
  const bad = requireToken(token)
  if (bad) return bad
  return rpc('watch_submit_logs', { p_token: token, p_logs: logs })
}

/**
 * 后端有两种「这个 token 不能用」的表达:
 *   unpaired       token 查不到对应设备(被解绑或库里没有)
 *   invalid token  token 为空或长度不足 32(本地存坏了)
 * 两种都该让手表清掉本地 token 回到配对页。
 */
export function isUnpaired(err) {
  if (!err || !err.message) return false
  const m = String(err.message)
  return m.indexOf('unpaired') >= 0 || m.indexOf('invalid token') >= 0
}

/**
 * 网络自检 —— 真机上没有别的手段判断「到底哪一层不通」。
 * 依次打三个地址, 结果拼成一行返回:
 *   http:200   基础网络与明文 HTTP 通
 *   https:200  TLS 也通
 *   db:401     目标域名可达(未带 apikey 返回 401 属正常)
 * 出现 E<code> 即该项失败, 对照可判断是完全没网 / TLS 不通 / 仅目标域名不通。
 */
/** 查询当前网络类型; 拿不到返回 '?' */
function netType() {
  return new Promise(function (resolve) {
    const m = _netMgr && (typeof _netMgr.getType === 'function' ? _netMgr : _netMgr.default)
    if (!m || typeof m.getType !== 'function') {
      resolve('模块无')
      return
    }
    let done = false
    setTimeout(function () {
      if (!done) { done = true; resolve('超时') }
    }, 4000)
    try {
      m.getType({
        success: function (d) {
          if (done) return
          done = true
          resolve((d && d.type) || '空')
        },
        fail: function (d, c) {
          if (done) return
          done = true
          resolve('E' + c)
        },
      })
    } catch (e) {
      if (!done) { done = true; resolve('异常') }
    }
  })
}

export function selfTest() {
  const f = getFetch()
  if (!f) return Promise.resolve('fetch模块不可用')

  // 每个目标测两次取较好结果 —— 手表经蓝牙转发的网络抖动很大, 单次失败说明不了问题。
  // 同时覆盖 http 与多个国内 https 站点, 用来区分「TLS 完全不可用」与「只是网络不稳」。
  const targets = [
    ['http', 'http://www.baidu.com'],
    ['sBaidu', 'https://www.baidu.com'],
    ['sQQ', 'https://www.qq.com'],
    ['proxy', CONFIG.API_BASE + '/health'],
    ['db', CONFIG.SUPABASE_URL + '/rest/v1/'],
  ]
  const out = []

  /** 打一次, 返回 '200' 或 'E<code>' 或 'T'(超时) */
  function hit(url) {
    return new Promise(function (resolve) {
      let done = false
      const guard = setTimeout(function () {
        if (!done) { done = true; resolve('T') }
      }, 10000)
      try {
        f({
          url: url,
          method: 'GET',
          responseType: 'text',
          timeout: 9000,
          success: function (res) {
            if (done) return
            done = true; clearTimeout(guard); resolve(String(res.code))
          },
          fail: function (d, c) {
            if (done) return
            done = true; clearTimeout(guard); resolve('E' + c)
          },
        })
      } catch (e) {
        if (!done) { done = true; clearTimeout(guard); resolve('X') }
      }
    })
  }

  /** 两次里挑「成功」的那次: 纯数字即 HTTP 状态码, 视为连通 */
  function best(a, b) {
    const okA = /^[0-9]+$/.test(a)
    const okB = /^[0-9]+$/.test(b)
    if (okA) return a
    if (okB) return b
    return a === b ? a : a + '/' + b
  }

  /**
   * 手表当前时间 —— TLS 握手要校验证书有效期, 系统时间偏差过大会让所有
   * https 握手失败, 而 http 完全不受影响。这正好对应「http 通、https 全挂」。
   * 年份不对(如 1970/2000)或日期明显偏离即为病因。
   */
  function timeStr() {
    const d = new Date()
    const p2 = function (n) { return n < 10 ? '0' + n : '' + n }
    return (
      d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +
      ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes())
    )
  }

  function step(i) {
    if (i >= targets.length) {
      return netType().then(function (nt) {
        return 'time:' + timeStr() + '  net:' + nt + '  ' + out.join('  ')
      })
    }
    return hit(targets[i][1])
      .then(function (r1) {
        return hit(targets[i][1]).then(function (r2) {
          out.push(targets[i][0] + ':' + best(r1, r2))
        })
      })
      .then(function () {
        return step(i + 1)
      })
  }

  return step(0)
}
