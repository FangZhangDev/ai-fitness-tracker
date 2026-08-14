# 手表 HTTP 转发服务

手表 → 这台服务（**http**）→ Supabase（https）。

## 为什么需要它

vivo Watch 3 上，蓝河快应用的 `fetch` 通道**发不出 HTTPS 请求**。实测（手表时间正确、`net:bluetooth`）：

| 目标 | 结果 |
|---|---|
| `http://www.baidu.com` | **206** ✅ |
| `https://www.baidu.com` | E-6 ❌ |
| `https://www.qq.com` | E0 ❌ |
| `https://<supabase>` | E-6 ❌ |

三个不同域名的 HTTPS 全部失败、HTTP 正常，排除了域名、时间、网络等因素。
另外两个开源蓝河应用也都只用 http，其中 `legado-watch-reader` 同样自建了转发服务器
——这是该平台的共性限制，不是本项目的 bug。

而 Supabase 强制 https，所以中间必须有一跳。

## 部署

### 1. 服务器要求（极低）

| 资源 | 需要 |
|---|---|
| 内存 | 30MB 以内（零第三方依赖） |
| CPU | 几乎为 0 |
| 流量 | 每天几十 KB |
| 系统 | 任意 Linux + Node.js 14+ |

最低配的云服务器足够。**关键：用非 80/443 端口**（如 8080），国内服务器可免 ICP 备案。

### 2. 启动

```bash
# 上传 server.js 到服务器后
PORT=8080 node server.js
```

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8080` | 监听端口，避开 80/443 |
| `SUPABASE_URL` | 项目的 Supabase 地址 | 上游地址 |

### 3. 常驻运行

```bash
# systemd（推荐）
sudo tee /etc/systemd/system/watch-proxy.service > /dev/null <<'EOF'
[Unit]
Description=Watch HTTP Proxy
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/watch-proxy/server.js
Environment=PORT=8080
Restart=always
User=nobody

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable --now watch-proxy
```

记得在云厂商的**安全组**里放行该端口。

### 4. 验证

```bash
curl http://你的IP:8080/health
# {"ok":true,"upstream":"xxx.supabase.co"}
```

### 5. 配置手表端

改 `watch/src/config.js` 一行，然后重新打包：

```js
API_BASE: 'http://你的IP:8080',
```

其余代码无需改动。装好后长按配对页标题跑自检，应看到 `proxy:200`。

## 安全设计

这不是开放代理，别人拿到地址也做不了坏事：

- **路径白名单**：只接受 `POST /rest/v1/rpc/<fn>`，且 `<fn>` 必须是
  `watch_redeem_pairing_code` / `watch_get_today` / `watch_submit_logs` 三者之一。
  其它 RPC 返回 403，直接查表返回 404
- **不持有密钥**：`apikey` 由手表带上来原样透传，本服务不存储、不打印
- **请求体上限** 256KB
- 上游地址写死，不接受客户端指定目标

即便如此，仍建议：

- 端口别用常见的 80/8080，换个不常见的
- 云厂商安全组里只放行该端口
- 真正的鉴权在 Supabase 那侧：手表持有的 device token 与 RLS 才是防线，
  转发服务只是个管道

## 实测结果

在开发机上验证过：

```
GET  /health                              -> 200 {"ok":true,...}
POST /rest/v1/rpc/watch_get_today         -> 400 {"message":"unpaired"}      正确转发
POST /rest/v1/rpc/watch_redeem_pairing_code -> 400 {"message":"code invalid..."} 正确转发
POST /rest/v1/rpc/pg_sleep                -> 403 {"message":"rpc not allowed"}  拒绝
GET  /rest/v1/workout_logs?select=*       -> 404 {"message":"not found"}        拒绝
```
