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
 * 安全设计:
 *   - 只转发写死的 Supabase 域名，且路径必须匹配白名单里的三个 RPC 函数，
 *     不会沦为任何人都能用的开放代理
 *   - 不持有任何密钥: apikey 由手表带上来原样透传，本服务不存储、不打印
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
const { URL } = require('url')

const PORT = parseInt(process.env.PORT || '8080', 10)
const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://brizffqttkhuktpqlcie.supabase.co'

/** 只允许这三个 RPC —— 与手表端用到的完全一致 */
const ALLOWED_RPC = [
  'watch_redeem_pairing_code',
  'watch_get_today',
  'watch_submit_logs',
]

const MAX_BODY = 256 * 1024 // 256KB, 训练记录远小于此
const UPSTREAM_TIMEOUT = 20000

function log(level, message, kv) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19)
  let tail = ''
  if (kv) {
    tail = ' ' + Object.keys(kv).map((k) => k + '=' + kv[k]).join(' ')
  }
  console.log(`${ts} ${level}: ${message}${tail}`)
}

const upstream = new URL(SUPABASE_URL)

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
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

    const upReq = https.request(
      {
        hostname: upstream.hostname,
        port: 443,
        path: '/rest/v1/rpc/' + fn,
        method: 'POST',
        headers: headers,
        timeout: UPSTREAM_TIMEOUT,
      },
      (upRes) => {
        const outChunks = []
        upRes.on('data', (c) => outChunks.push(c))
        upRes.on('end', () => {
          let out = Buffer.concat(outChunks)
          // 标量返回值包装, 理由同 server.py: 蓝河 fetch 对标量 JSON 的解析
          // 不可控(手表侧会拿到对象), 统一包成 {"token": "..."} 最稳
          const st = upRes.statusCode || 0
          if (fn === 'watch_redeem_pairing_code' && st >= 200 && st < 300) {
            try {
              const tok = JSON.parse(out.toString('utf8'))
              if (typeof tok === 'string') {
                out = Buffer.from(JSON.stringify({ token: tok }))
              }
            } catch (e) {}
          }
          log('INFO', '转发完成', {
            fn: fn,
            status: upRes.statusCode,
            bytes: out.length,
            ms: Date.now() - started,
          })
          res.writeHead(upRes.statusCode || 502, {
            'Content-Type':
              upRes.headers['content-type'] || 'application/json; charset=utf-8',
            'Content-Length': out.length,
          })
          res.end(out)
        })
      }
    )

    upReq.on('timeout', () => {
      log('ERROR', '上游超时', { fn: fn })
      upReq.destroy()
      if (!res.headersSent) send(res, 504, JSON.stringify({ message: 'upstream timeout' }))
    })

    upReq.on('error', (e) => {
      log('ERROR', '上游错误', { fn: fn, err: e.message })
      if (!res.headersSent) send(res, 502, JSON.stringify({ message: 'upstream error' }))
    })

    upReq.write(body)
    upReq.end()
  })
})

server.listen(PORT, '0.0.0.0', () => {
  log('INFO', '转发服务已启动', {
    port: PORT,
    upstream: upstream.host,
    rpc: ALLOWED_RPC.length,
  })
})
