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

三个关键设计（都是被真机坑出来的，别随手删）:

  1. 复用上游连接 + 定时预热
     校园网到 Supabase 实测 total 1.2s / 2.5s / 9.8s，其中 TLS 握手就要
     0.6~2.2s，DNS 偶尔抖到 5s。每来一个请求就新建一条 TLS 连接的话，
     手表侧（经手机蓝牙代理）大约 5 秒就会超时重发。
     这里改成 keep-alive 连接池，并由后台线程每 40s 打一次上游保温，
     稳定态下一次转发只剩一个 RTT。

  2. 配对码兑换幂等
     手机蓝牙代理会自作主张重发超时的 POST（实测日志: 16:55:33 一次 200，
     9 秒后同一个码再来一次 400）。而 watch_redeem_pairing_code 是一次性的,
     重发必然拿到 "code invalid or expired" —— 表现为「网页显示已绑定、
     手表却报 400」。这里按配对码把成功结果缓存 10 分钟，并对同一个码串行化，
     重发直接拿回同一个 token。

  3. 对手表也开 keep-alive（protocol_version = HTTP/1.1）
     响应一律带 Content-Length，可以安全开 1.1，省掉手表侧每次重连的开销。

安全设计:
    - 只转发写死的 Supabase 域名，且路径必须命中 RPC 白名单，
      不会沦为开放代理
    - 不持有任何密钥：apikey 由手表带上来原样透传，本服务不存储、不打印
    - 幂等缓存里确实短暂持有明文 token（<=10 分钟），与它转发的内容同级，
      且只在内存里；服务重启即清空
    - 请求体大小上限

用法:
    python3 server.py                    # 默认 8080 端口
    PORT=9000 python3 server.py          # 自定义端口

日志格式: timestamp level: message key=value
"""

import http.client
import json
import os
import re
import ssl
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", "8080"))


def _resolve_supabase_url():
    """
    上游地址: 环境变量优先; 没给就读隔壁手表源码的 config.js ——
    本服务通常就跑在仓库里, 让它和手表端共用同一个事实来源, 少一处要改的地方。
    """
    v = os.environ.get("SUPABASE_URL")
    if v:
        return v.rstrip("/")
    cfg = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "config.js")
    try:
        with open(cfg, encoding="utf-8") as f:
            m = re.search(r"SUPABASE_URL:\s*['\"]([^'\"]+)['\"]", f.read())
            if m:
                return m.group(1).rstrip("/")
    except OSError:
        pass
    return ""


SUPABASE_URL = _resolve_supabase_url()
UPSTREAM_HOST = SUPABASE_URL.split("://", 1)[-1]

# 只允许这几个 RPC —— 与手表端用到的完全一致
ALLOWED_RPC = {
    "watch_redeem_pairing_code",
    "watch_get_today",
    "watch_get_week",
    "watch_submit_logs",
}

MAX_BODY = 256 * 1024      # 256KB，训练记录远小于此
UPSTREAM_TIMEOUT = 15      # 秒
POOL_MAX = 4               # 池里最多留几条空闲连接
POOL_IDLE_MAX = 50         # 空闲超过这么久就不再复用（对端多半已关）
WARM_INTERVAL = 40         # 保温间隔，要小于 POOL_IDLE_MAX
REDEEM_TTL = 600           # 配对结果幂等缓存时长（秒），与配对码有效期同量级


def log(level, message, **kv):
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    tail = " ".join("{}={}".format(k, v) for k, v in kv.items())
    print("{} {}: {}{}".format(ts, level, message, (" " + tail) if tail else ""), flush=True)


# ---------------------------------------------------------------------------
# 上游连接池
# ---------------------------------------------------------------------------
_ssl_ctx = ssl.create_default_context()
_pool = []                      # [(conn, 放回池子的时刻)]
_pool_lock = threading.Lock()


def _take_conn():
    """取一条可用连接; 返回 (conn, 是否来自池子)"""
    with _pool_lock:
        while _pool:
            conn, ts = _pool.pop()
            if time.time() - ts <= POOL_IDLE_MAX:
                return conn, True
            try:
                conn.close()
            except Exception:
                pass
    conn = http.client.HTTPSConnection(
        UPSTREAM_HOST, 443, timeout=UPSTREAM_TIMEOUT, context=_ssl_ctx
    )
    return conn, False


def _put_conn(conn):
    with _pool_lock:
        if len(_pool) < POOL_MAX:
            _pool.append((conn, time.time()))
            return
    try:
        conn.close()
    except Exception:
        pass


def upstream_request(method, path, body, headers):
    """
    打上游，返回 (status, bytes)。

    只有「复用池里的旧连接」失败时才重试 —— 那种失败发生在请求发出之前
    (对端早就把空闲连接关了)，重试是安全的。新建的连接失败则不重试:
    请求可能已经送达并被执行，重发会造成重复兑换。
    """
    last_err = None
    for _ in range(2):
        conn, reused = _take_conn()
        try:
            conn.request(method, path, body=body, headers=headers)
            resp = conn.getresponse()
            data = resp.read()
            status = resp.status
            if resp.will_close:
                try:
                    conn.close()
                except Exception:
                    pass
            else:
                _put_conn(conn)
            return status, data
        except Exception as e:
            try:
                conn.close()
            except Exception:
                pass
            last_err = e
            if not reused:
                break
    raise last_err


def _warm_loop():
    """后台保温: 定时打一下上游，让池子里始终有条握好手的连接"""
    while True:
        time.sleep(WARM_INTERVAL)
        try:
            started = time.time()
            status, _ = upstream_request(
                "GET", "/rest/v1/", None, {"Accept": "application/json"}
            )
            ms = int((time.time() - started) * 1000)
            # 慢到这个程度说明连接没保住，记一条便于回溯
            if ms > 1500:
                log("WARN", "保温偏慢", status=status, ms=ms)
        except Exception as e:
            log("WARN", "保温失败", err=str(e)[:80])


# ---------------------------------------------------------------------------
# 配对码兑换的幂等层
# ---------------------------------------------------------------------------
_redeem_cache = {}              # code -> (到期时刻, status, bytes)
_redeem_locks = {}              # code -> Lock
_redeem_meta_lock = threading.Lock()


def _redeem_lock_for(code):
    with _redeem_meta_lock:
        lk = _redeem_locks.get(code)
        if lk is None:
            lk = threading.Lock()
            _redeem_locks[code] = lk
        return lk


def _redeem_cache_get(code):
    now = time.time()
    with _redeem_meta_lock:
        # 顺手清一遍过期的，省得长跑之后越攒越多
        for k in [k for k, v in _redeem_cache.items() if v[0] <= now]:
            _redeem_cache.pop(k, None)
            _redeem_locks.pop(k, None)
        hit = _redeem_cache.get(code)
    if hit:
        return hit[1], hit[2]
    return None


def _redeem_cache_put(code, status, body):
    with _redeem_meta_lock:
        _redeem_cache[code] = (time.time() + REDEEM_TTL, status, body)


def _wrap_token(body):
    """
    标量返回值包装。
    watch_redeem_pairing_code 在 PostgREST 侧返回的是标量 JSON, 形如
    "abc123"(带引号的字符串)。蓝河 fetch 对这类标量的解析不可控 ——
    实测手表拿到的是对象, String() 后变成 "[object Object]"(15 字符),
    于是被判为无效 token。统一包成 {"token": "..."}, 无论框架怎么解析都能取到。
    """
    try:
        tok = json.loads(body.decode("utf-8"))
        if isinstance(tok, str):
            return json.dumps({"token": tok}).encode()
    except Exception:
        pass
    return body


def _param_names(body):
    """出错时用来定位: 只记参数名，绝不记参数值(里面是 token)"""
    try:
        obj = json.loads(body.decode("utf-8"))
        if isinstance(obj, dict):
            return ",".join(sorted(obj.keys())) or "空"
        return type(obj).__name__
    except Exception:
        return "非JSON"


class Handler(BaseHTTPRequestHandler):
    # 响应一律带 Content-Length，可以安全启用 keep-alive:
    # 手表经手机蓝牙代理过来，省掉每次重连的开销很值
    protocol_version = "HTTP/1.1"

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
        except (BrokenPipeError, ConnectionResetError):
            # 手表那头等不及先断了 —— 常事，不必刷屏
            self.close_connection = True

    def do_GET(self):
        # 健康检查：手表自检也会打这个地址
        if self.path in ("/", "/health"):
            self._send(200, {"ok": True, "upstream": UPSTREAM_HOST})
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
        headers = {"Content-Type": "application/json", "Content-Length": str(len(body))}
        for h in ("apikey", "Authorization"):
            v = self.headers.get(h)
            if v:
                headers[h] = v

        if fn == "watch_redeem_pairing_code":
            self._handle_redeem(body, headers, started)
        else:
            self._forward(fn, body, headers, started)

    # -- 兑换配对码: 同码串行 + 成功结果缓存 --------------------------------
    def _handle_redeem(self, body, headers, started):
        code = None
        try:
            obj = json.loads(body.decode("utf-8"))
            if isinstance(obj, dict):
                code = obj.get("p_code")
        except Exception:
            pass

        if not isinstance(code, str) or not code:
            # 解析不出配对码就退化成普通转发，让上游去报错
            self._forward("watch_redeem_pairing_code", body, headers, started)
            return

        with _redeem_lock_for(code):
            cached = _redeem_cache_get(code)
            if cached:
                status, out = cached
                log(
                    "INFO",
                    "配对重发, 返回缓存结果",
                    fn="watch_redeem_pairing_code",
                    status=status,
                    ms=int((time.time() - started) * 1000),
                )
                self._send(status, out)
                return

            try:
                status, out = upstream_request(
                    "POST", "/rest/v1/rpc/watch_redeem_pairing_code", body, headers
                )
            except Exception as e:
                log("ERROR", "上游错误", fn="watch_redeem_pairing_code", err=str(e)[:120])
                self._send(502, {"message": "upstream error"})
                return

            if 200 <= status < 300:
                out = _wrap_token(out)
                # 只缓存成功结果: 码本来就错的话不该被缓存成永久错误
                _redeem_cache_put(code, status, out)

            log(
                "INFO",
                "转发完成",
                fn="watch_redeem_pairing_code",
                status=status,
                bytes=len(out),
                ms=int((time.time() - started) * 1000),
            )
            self._send(status, out)

    # -- 其余 RPC: 直通 ----------------------------------------------------
    def _forward(self, fn, body, headers, started):
        try:
            status, out = upstream_request("POST", "/rest/v1/rpc/" + fn, body, headers)
        except Exception as e:
            log("ERROR", "上游错误", fn=fn, err=str(e)[:120])
            self._send(502, {"message": "upstream error"})
            return

        if fn == "watch_redeem_pairing_code" and 200 <= status < 300:
            out = _wrap_token(out)

        kv = dict(fn=fn, status=status, bytes=len(out),
                  ms=int((time.time() - started) * 1000))
        if status >= 400:
            # 4xx/5xx 时补上参数名(不含值), 否则事后完全看不出是哪一步传错了 ——
            # 曾出现 watch_get_today 404, 就是 token 没带上导致函数签名对不上
            kv["params"] = _param_names(body)
        log("INFO", "转发完成", **kv)
        self._send(status, out)


def main():
    if not SUPABASE_URL:
        log("ERROR", "没有上游地址, 无法启动")
        print(
            "\n请二选一:\n"
            "  1) 填好 watch/src/config.js 的 SUPABASE_URL "
            "(从 config.example.js 复制)\n"
            "  2) 启动时给环境变量: "
            "SUPABASE_URL=https://<project-ref>.supabase.co python3 server.py\n",
            file=sys.stderr,
        )
        sys.exit(1)

    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    threading.Thread(target=_warm_loop, daemon=True).start()
    log("INFO", "转发服务已启动", port=PORT, upstream=UPSTREAM_HOST, rpc=len(ALLOWED_RPC))
    log("INFO", "手表端把 config.js 的 API_BASE 改成 http://<本机IP>:%d" % PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("INFO", "已停止")
        server.server_close()


if __name__ == "__main__":
    main()
