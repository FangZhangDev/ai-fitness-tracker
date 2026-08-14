#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
手表 -> Supabase 的 HTTP 转发服务（Python 版）

与同目录的 server.js 功能完全一致，只是改用 Python 标准库实现，
方便在 macOS 上直接运行 —— 系统自带 python3，无需安装任何东西。

为什么需要它:
    vivo Watch 3 上，蓝河快应用的 fetch 通道发不出 HTTPS 请求。
    实测（手表时间正确、net:bluetooth）:
        http://www.baidu.com   -> 206   OK
        https://www.baidu.com  -> E-6   失败
        https://www.qq.com     -> E0    失败
        https://<supabase>     -> E-6   失败
    三个不同域名的 HTTPS 全挂而 HTTP 正常，排除了域名/时间/网络因素。
    而 Supabase 强制 https，所以中间需要这一跳。

安全设计:
    - 只转发写死的 Supabase 域名，且路径必须命中三个 RPC 白名单，
      不会沦为开放代理
    - 不持有任何密钥：apikey 由手表带上来原样透传，本服务不存储、不打印
    - 请求体大小上限

用法:
    python3 server.py                    # 默认 8080 端口
    PORT=9000 python3 server.py          # 自定义端口

日志格式: timestamp level: message key=value
"""

import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", "8080"))
SUPABASE_URL = os.environ.get(
    "SUPABASE_URL", "https://brizffqttkhuktpqlcie.supabase.co"
).rstrip("/")

# 只允许这三个 RPC —— 与手表端用到的完全一致
ALLOWED_RPC = {
    "watch_redeem_pairing_code",
    "watch_get_today",
    "watch_submit_logs",
}

MAX_BODY = 256 * 1024      # 256KB，训练记录远小于此
UPSTREAM_TIMEOUT = 20      # 秒


def log(level, message, **kv):
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    tail = " ".join(f"{k}={v}" for k, v in kv.items())
    print(f"{ts} {level}: {message}{(' ' + tail) if tail else ''}", flush=True)


class Handler(BaseHTTPRequestHandler):
    # 关掉默认的 access log，用我们自己的格式
    def log_message(self, fmt, *args):
        pass

    def _send(self, code, payload, ctype="application/json; charset=utf-8"):
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except BrokenPipeError:
            pass

    def do_GET(self):
        # 健康检查：手表自检也会打这个地址
        if self.path in ("/", "/health"):
            host = SUPABASE_URL.split("://", 1)[-1]
            self._send(200, {"ok": True, "upstream": host})
            return
        log("WARN", "拒绝: 路径或方法不合法", method="GET", url=self.path)
        self._send(404, {"message": "not found"})

    def do_POST(self):
        started = time.time()

        # 路径必须形如 /rest/v1/rpc/<fn>，与 Supabase 一致，
        # 这样手表端只需把 config.js 的域名换掉，其余代码不动
        prefix = "/rest/v1/rpc/"
        if not self.path.startswith(prefix):
            log("WARN", "拒绝: 路径不合法", url=self.path)
            self._send(404, {"message": "not found"})
            return

        fn = self.path[len(prefix):]
        if fn not in ALLOWED_RPC:
            log("WARN", "拒绝: 不在白名单的 RPC", fn=fn)
            self._send(403, {"message": "rpc not allowed"})
            return

        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            log("WARN", "拒绝: 请求体过大", size=length)
            self._send(413, {"message": "body too large"})
            return
        body = self.rfile.read(length) if length else b""

        # 只透传必要的头；apikey/Authorization 由手表带来，本服务不留存
        headers = {"Content-Type": "application/json"}
        for h in ("apikey", "Authorization"):
            v = self.headers.get(h)
            if v:
                headers[h] = v

        req = urllib.request.Request(
            SUPABASE_URL + prefix + fn, data=body, headers=headers, method="POST"
        )
        try:
            ctx = ssl.create_default_context()
            with urllib.request.urlopen(req, timeout=UPSTREAM_TIMEOUT, context=ctx) as r:
                out = r.read()
                status = r.status
        except urllib.error.HTTPError as e:
            # Supabase 的业务错误（如 unpaired）走这里，需原样回传给手表
            out = e.read()
            status = e.code
        except Exception as e:
            log("ERROR", "上游错误", fn=fn, err=str(e)[:120])
            self._send(502, {"message": "upstream error"})
            return

        # ── 标量返回值包装 ────────────────────────────────────────────────
        # watch_redeem_pairing_code 在 PostgREST 侧返回的是标量 JSON, 形如
        # "abc123"(带引号的字符串)。蓝河 fetch 对这类标量的解析不可控 ——
        # 实测手表拿到的是对象, String() 后变成 "[object Object]"(15 字符),
        # 于是被判为无效 token。
        # 这里统一包成 {"token": "..."} , 无论框架如何解析都能稳定取到 .token。
        if fn == "watch_redeem_pairing_code" and 200 <= status < 300:
            try:
                tok = json.loads(out.decode("utf-8"))
                if isinstance(tok, str):
                    out = json.dumps({"token": tok}).encode()
            except Exception:
                pass

        log(
            "INFO",
            "转发完成",
            fn=fn,
            status=status,
            bytes=len(out),
            ms=int((time.time() - started) * 1000),
        )
        self._send(status, out)


def main():
    host = SUPABASE_URL.split("://", 1)[-1]
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    log("INFO", "转发服务已启动", port=PORT, upstream=host, rpc=len(ALLOWED_RPC))
    log("INFO", "手表端把 config.js 的 API_BASE 改成 http://<本机IP>:%d" % PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("INFO", "已停止")
        server.server_close()


if __name__ == "__main__":
    main()
