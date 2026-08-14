#!/usr/bin/env node
/**
 * 手表 -> Supabase 的 HTTP 转发服务
 *
 * 为什么需要它:
 *   vivo Watch 3 上，蓝河快应用的 fetch 通道**发不出 HTTPS 请求**。
 *   实测(v1.0.9 自检, 手表时间正确、net:bluetooth):
 *     http://www.baidu.com   -> 206   ✅ 明文 HTTP 正常
 *     https://www.baidu.com  -> E-6   ❌
 *     https://www.qq.com     -> E0    ❌
 *     https://<supabase>     -> E-6   ❌
 *   三个不同域名的 HTTPS 全部失败而 HTTP 正常，排除了域名、时间、网络等因素。
 *   另外两个开源蓝河应用(blueos-calculator、legado-watch-reader)也都只用
 *   http，其中一个同样自建了转发服务器 —— 这是该平台的共性限制。
 *
 * 于是: 手表用 http 打这台服务，由这台服务用 https 转发给 Supabase。
 *
 * 三个关键设计(都是被真机坑出来的，别随手删):
 *
 *   1. 复用上游连接 + 定时预热
 *      校园网到 Supabase 实测 total 1.2s / 2.5s / 9.8s，光 TLS 握手就要
 *      0.6~2.2s。每来一个请求新建一条 TLS 连接的话，手表侧(经手机蓝牙代理)
 *      大约 5 秒就会超时重发。keepAlive agent + 40s 保温，稳定态只剩一个 RTT。
 *
 *   2. 配对码兑换幂等
 *      手机蓝牙代理会自作主张重发超时的 POST(实测日志: 一次 200，9 秒后
 *      同一个码再来一次 400)。而 watch_redeem_pairing_code 是一次性的，
 *      重发必然 "code invalid or expired" —— 表现为「网页显示已绑定、手表却
 *      报 400」。这里按配对码合并并发、缓存成功结果 10 分钟，重发拿回同一 token。
 *
 * 安全设计:
 *   - 只转发写死的 Supabase 域名，且路径必须匹配白名单里的 RPC 函数，
 *     不会沦为任何人都能用的开放代理
 *   - 不持有任何密钥: apikey 由手表带上来原样透传，本服务不存储、不打印
 *   - 幂等缓存里短暂持有明文 token(<=10 分钟)，只在内存，重启即清空
 *   - 请求体大小上限，防止被灌垃圾
 *
 * 零第三方依赖，Node.js 14+ 直接跑。
 *
 * 用法:
 *   PORT=8080 SUPABASE_URL=https://xxx.supabase.co node server.js
 *
 * 日志格式: timestamp level: message key=value
 */

'use strict'

const http = require('http')
const https = require('https')
const fs = require('fs')
const path = require('path')
const { URL } = require('url')

const PORT = parseInt(process.env.PORT || '8080', 10)

/**
 * 上游地址: 环境变量优先; 没给就读隔壁手表源码的 config.js ——
 * 本服务通常就跑在仓库里, 让它和手表端共用同一个事实来源, 少一处要改的地方。
 */
function resolveSupabaseUrl() {
  if (process.env.SUPABASE_URL) return process.env.SUPABASE_URL.replace(/\/+$/, '')
  try {
    const cfg = fs.readFileSync(path.join(__dirname, '..', 'src', 'config.js'), 'utf8')
    const m = /SUPABASE_URL:\s*['"]([^'"]+)['"]/.exec(cfg)
    if (m) return m[1].replace(/\/+$/, '')
  } catch (e) {}
  return ''
}

const SUPABASE_URL = resolveSupabaseUrl()
if (!SUPABASE_URL) {
  console.error('没有上游地址, 无法启动。请二选一:')
  console.error('  1) 填好 watch/src/config.js 的 SUPABASE_URL (从 config.example.js 复制)')
  console.error('  2) 启动时给环境变量: SUPABASE_URL=https://<project-ref>.supabase.co node server.js')
  process.exit(1)
}

/** 只允许这几个 RPC —— 与手表端用到的完全一致 */
const ALLOWED_RPC = [
  'watch_redeem_pairing_code',
  'watch_get_today',
  'watch_get_week',
  'watch_submit_logs',
]

const MAX_BODY = 256 * 1024 // 256KB, 训练记录远小于此
const UPSTREAM_TIMEOUT = 15000
const WARM_INTERVAL = 40000 // 保温间隔
const REDEEM_TTL = 600000 // 配对结果幂等缓存时长, 与配对码有效期同量级

function log(level, message, kv) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19)
  let tail = ''
  if (kv) {
    tail = ' ' + Object.keys(kv).map((k) => k + '=' + kv[k]).join(' ')
  }
  console.log(`${ts} ${level}: ${message}${tail}`)
}

const upstream = new URL(SUPABASE_URL)

// keepAlive: 复用 TLS 连接，这是本服务延迟的大头
const agent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 20000,
  maxSockets: 4,
  maxFreeSockets: 4,
})

/** 打上游, resolve 成 { status, body:Buffer } */
function upstreamRequest(method, path, body, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: upstream.hostname,
        port: 443,
        path: path,
        method: method,
        headers: headers,
        agent: agent,
        timeout: UPSTREAM_TIMEOUT,
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () =>
          resolve({ status: res.statusCode || 502, body: Buffer.concat(chunks) })
        )
      }
    )
    req.on('timeout', () => {
      req.destroy(new Error('upstream timeout'))
    })
    req.on('error', reject)
    if (body && body.length) req.write(body)
    req.end()
  })
}

/** 后台保温: 让 agent 里始终留着一条握好手的连接 */
setInterval(() => {
  const started = Date.now()
  upstreamRequest('GET', '/rest/v1/', null, { Accept: 'application/json' })
    .then((r) => {
      const ms = Date.now() - started
      if (ms > 1500) log('WARN', '保温偏慢', { status: r.status, ms: ms })
    })
    .catch((e) => log('WARN', '保温失败', { err: e.message }))
}, WARM_INTERVAL).unref()

/**
 * 标量返回值包装。
 * watch_redeem_pairing_code 在 PostgREST 侧返回的是标量 JSON, 形如 "abc123"。
 * 蓝河 fetch 对这类标量的解析不可控(手表侧会拿到对象, String() 后变成
 * "[object Object]"), 统一包成 {"token": "..."} 最稳。
 */
function wrapToken(buf) {
  try {
    const tok = JSON.parse(buf.toString('utf8'))
    if (typeof tok === 'string') return Buffer.from(JSON.stringify({ token: tok }))
  } catch (e) {}
  return buf
}

/** 出错时用来定位: 只记参数名, 绝不记参数值(里面是 token) */
function paramNames(buf) {
  try {
    const obj = JSON.parse(buf.toString('utf8'))
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return Object.keys(obj).sort().join(',') || '空'
    }
    return typeof obj
  } catch (e) {
    return '非JSON'
  }
}

// -- 配对码兑换的幂等层 ------------------------------------------------------
const redeemCache = new Map() // code -> { until, status, body }
const redeemInflight = new Map() // code -> Promise

function redeemCacheGet(code) {
  const now = Date.now()
  for (const [k, v] of redeemCache) if (v.until <= now) redeemCache.delete(k)
  return redeemCache.get(code) || null
}

function doRedeem(code, body, headers) {
  const hit = redeemCacheGet(code)
  if (hit) return Promise.resolve({ status: hit.status, body: hit.body, cached: true })

  const running = redeemInflight.get(code)
  if (running) return running

  const p = upstreamRequest(
    'POST',
    '/rest/v1/rpc/watch_redeem_pairing_code',
    body,
    headers
  )
    .then((r) => {
      let out = r.body
      if (r.status >= 200 && r.status < 300) {
        out = wrapToken(out)
        // 只缓存成功结果: 码本来就错的话不该被缓存成永久错误
        redeemCache.set(code, { until: Date.now() + REDEEM_TTL, status: r.status, body: out })
      }
      return { status: r.status, body: out, cached: false }
    })
    .finally(() => redeemInflight.delete(code))

  redeemInflight.set(code, p)
  return p
}

function send(res, code, body, type) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body)
  res.writeHead(code, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Content-Length': buf.length,
  })
  res.end(buf)
}

const server = http.createServer((req, res) => {
  const started = Date.now()

  // 健康检查: 手表端自检也可以打这个地址确认服务活着
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
    send(res, 200, JSON.stringify({ ok: true, upstream: upstream.host }))
    return
  }

  // 路径必须形如 /rest/v1/rpc/<fn>，与 Supabase 保持一致，
  // 这样手表端只需把 config.js 里的域名换成本服务地址，其余代码不动
  const m = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(req.url || '')
  if (!m || req.method !== 'POST') {
    log('WARN', '拒绝: 路径或方法不合法', { method: req.method, url: req.url })
    send(res, 404, JSON.stringify({ message: 'not found' }))
    return
  }

  const fn = m[1]
  if (ALLOWED_RPC.indexOf(fn) < 0) {
    log('WARN', '拒绝: 不在白名单的 RPC', { fn: fn })
    send(res, 403, JSON.stringify({ message: 'rpc not allowed' }))
    return
  }

  // 收集请求体
  const chunks = []
  let size = 0
  let aborted = false
  req.on('data', (c) => {
    size += c.length
    if (size > MAX_BODY) {
      aborted = true
      log('WARN', '拒绝: 请求体过大', { size: size })
      send(res, 413, JSON.stringify({ message: 'body too large' }))
      req.destroy()
      return
    }
    chunks.push(c)
  })

  req.on('end', () => {
    if (aborted) return
    const body = Buffer.concat(chunks)

    // 只透传必要的头; apikey/Authorization 由手表带上来, 本服务不留存
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': body.length,
    }
    if (req.headers['apikey']) headers['apikey'] = req.headers['apikey']
    if (req.headers['authorization']) {
      headers['Authorization'] = req.headers['authorization']
    }

    // 兑换配对码走幂等层, 其余直通
    let code = null
    if (fn === 'watch_redeem_pairing_code') {
      try {
        const obj = JSON.parse(body.toString('utf8'))
        if (obj && typeof obj.p_code === 'string' && obj.p_code) code = obj.p_code
      } catch (e) {}
    }

    const task = code
      ? doRedeem(code, body, headers)
      : upstreamRequest('POST', '/rest/v1/rpc/' + fn, body, headers).then((r) => ({
          status: r.status,
          body: fn === 'watch_redeem_pairing_code' && r.status >= 200 && r.status < 300
            ? wrapToken(r.body)
            : r.body,
          cached: false,
        }))

    task
      .then((r) => {
        const kv = {
          fn: fn,
          status: r.status,
          bytes: r.body.length,
          ms: Date.now() - started,
        }
        if (r.status >= 400) {
          // 4xx/5xx 时补上参数名(不含值), 否则事后看不出是哪一步传错了 ——
          // 曾出现 watch_get_today 404, 就是 token 没带上导致函数签名对不上
          kv.params = paramNames(body)
        }
        log('INFO', r.cached ? '配对重发, 返回缓存结果' : '转发完成', kv)
        send(res, r.status, r.body)
      })
      .catch((e) => {
        log('ERROR', '上游错误', { fn: fn, err: e.message })
        if (!res.headersSent) send(res, 502, JSON.stringify({ message: 'upstream error' }))
      })
  })
})

server.listen(PORT, '0.0.0.0', () => {
  log('INFO', '转发服务已启动', {
    port: PORT,
    upstream: upstream.host,
    rpc: ALLOWED_RPC.length,
  })
})
