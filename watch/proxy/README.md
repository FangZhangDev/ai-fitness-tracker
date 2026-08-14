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

## 它不只是个管道：两个必须保留的机制

### 1. 配对码兑换幂等（治「网页显示已绑定、手表却报 400」）

手机蓝牙代理会**自作主张重发超时的 POST**。实测日志：

```
16:55:33 watch_redeem_pairing_code status=200 ms=3568   ← 这次其实成功了
16:55:42 watch_redeem_pairing_code status=400 ms=7320   ← 同一个码被重发, 已作废
```

配对码是一次性的，第二发必然 `code invalid or expired`，于是设备在库里建好了、
手表却停在错误页。服务按 `p_code` **合并并发 + 缓存成功结果 10 分钟**，
重发直接拿回同一个 token。缓存只在内存，重启即清空。

### 2. 连接复用 + 定时保温（治超时重发的根因）

上游延迟实测 total 1.2s / 2.5s / 9.8s，光 TLS 握手就 0.6~2.2s，DNS 偶尔抖到 5s。
每请求新建一条 TLS 连接的话，手表侧大约 5 秒就超时。改成 keep-alive 连接池 +
每 40s 打一次上游保温后，稳定态只剩一个 RTT：

```
改之前: ms=3568
改之后: ms=566 / 587 / 591 / 562
```

对手表侧也开了 HTTP/1.1 keep-alive（响应一律带 Content-Length，安全）。

> 复用连接失败时只对「从池子里取出的旧连接」重试——那种失败发生在请求发出之前。
> 新建连接失败不重试，否则可能造成重复兑换。

## 方案一：跑在常开的 Mac 上（零成本，推荐先试）

macOS 自带 python3，**不用装任何东西**：

```bash
cd 到本目录
python3 server.py            # 默认 8080
PORT=9000 python3 server.py  # 换端口
```

首次运行 macOS 会弹窗询问「是否允许接受传入网络连接」，选**允许**。

### 查 Mac 的内网 IP

```bash
ipconfig getifaddr en0     # Wi-Fi
ipconfig getifaddr en1     # 有线
```

得到形如 `192.168.1.23` 的地址，手表端 `config.js` 就填 `http://192.168.1.23:8080`。

### 关键前提

手表不能连 Wi-Fi，它走蓝牙经手机上网。所以**只有当手机也连着同一个家庭 Wi-Fi 时**，
手表的请求才可能到达这台 Mac。也就是说：

- **在家**：手机连家里 Wi-Fi → 手表可同步（拉计划、上传记录）
- **在健身房**：手机用移动数据 → 手表连不上 Mac，但**离线缓存与补传队列会接管**，
  记录照常，回家自动补传

这套用法与应用已实现的离线机制天然契合：出门前在家同步当天计划，练完回家自动上传。

### 两个注意事项

1. **Mac 的 IP 会变**。去路由器管理页给这台 Mac 绑定固定 IP（DHCP 静态分配），
   否则哪天 IP 变了就得重新打包手表应用。
2. **Mac 睡眠时服务会停**。系统设置 → 电池/节能 里关掉自动睡眠，
   或至少设置「接入电源时不睡眠」。

### 让它开机自启（可选）

```bash
# 把 server.py 放到固定位置，例如 ~/watch-proxy/server.py
mkdir -p ~/Library/LaunchAgents
cat > ~/Library/LaunchAgents/com.fzg.watchproxy.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.fzg.watchproxy</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>/Users/你的用户名/watch-proxy/server.py</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
EOF
launchctl load ~/Library/LaunchAgents/com.fzg.watchproxy.plist
```

## 方案二：跑在公网服务器上

### 服务器要求（极低）


| 资源 | 需要 |
|---|---|
| 内存 | 30MB 以内（零第三方依赖） |
| CPU | 几乎为 0 |
| 流量 | 每天几十 KB |
| 系统 | 任意 Linux + Node.js 14+ |

最低配的云服务器足够。**关键：用非 80/443 端口**（如 8080），国内服务器可免 ICP 备案。

### 启动

```bash
# 上传后二选一，功能完全一致
PORT=8080 node server.js     # Node 版
PORT=8080 python3 server.py  # Python 版
```

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8080` | 监听端口，避开 80/443 |
| `SUPABASE_URL` | 项目的 Supabase 地址 | 上游地址 |

### 常驻运行

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

### 验证

```bash
curl http://你的IP:8080/health
# {"ok":true,"upstream":"xxx.supabase.co"}
```

## 配置手表端（两种方案都一样）

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

幂等性冒烟测试（假上游 + 真 `server.py`）：串行重发与 3 路并发重发，
上游都只收到 1 次，三个调用方拿到同一个 token。

## 看日志

非 2xx 会额外记一列 `params=`，**只记参数名不记参数值**（值里有 token）：

```
17:07:37 INFO: 转发完成 fn=watch_get_today status=404 bytes=382 params=p_weekday
```

上面这条就是手表把 `p_token` 弄丢了——`JSON.stringify` 会把值为 `undefined`
的字段整个丢掉，PostgREST 找不到匹配签名就回 404，看着特别像「接口没部署」。
手表端已在 `api.js` 里做了 token 体检，发出去之前就拦下。
