/**
 * 应用配置 —— 复制本文件为 config.js 再填自己的值
 *
 *     cp src/config.example.js src/config.js
 *
 * config.js 已在 .gitignore 里, 不会被提交。
 *
 * 手表不走 Vercel, 而是打自建的 HTTP 转发服务, 再由它转给 Supabase:
 *   1. 少一跳, 延迟更低
 *   2. 绕开 vercel.app 域名在国内不稳定的问题
 *   3. 蓝河快应用的 fetch 通道发不出 HTTPS —— 这一跳是硬性需要, 见 proxy/README.md
 */
export const CONFIG = {
  // ===========================================================================
  // 手表实际请求的地址 —— 必须是 http，不能是 https。
  //
  // 实测(v1.0.9 自检, 手表时间正确、net:bluetooth):
  //   http://www.baidu.com  -> 206  ✅
  //   https://www.baidu.com -> E-6  ❌
  //   https://www.qq.com    -> E0   ❌
  //   https://<supabase>    -> E-6  ❌
  // 三个不同域名的 https 全挂而 http 正常，排除域名/时间/网络因素 ——
  // 蓝河快应用的 fetch 通道发不出 HTTPS。另两个开源蓝河应用同样只用 http。
  //
  // 因此改由 proxy/ 下的转发服务中转: 手表 --http--> 转发服务 --https--> Supabase。
  // 把下面这行换成转发服务的 `http://IP:端口`，其余代码无需改动。
  // ===========================================================================
  API_BASE: 'http://192.168.1.100:8080',

  // 下面两项供网络自检对照用; ANON_KEY 会由手表透传给转发服务。
  //
  // ANON_KEY 是 Supabase 的「公开密钥」(新版界面叫 Publishable key)，
  // 本来就会打进网页前端的 bundle，写在这里不会带来额外风险 ——
  // 所有数据表都开了 RLS，单靠这个 key 查不到任何人的数据。
  // 手表的真正凭据是配对后拿到的 device token。
  SUPABASE_URL: 'https://your-project-ref.supabase.co',
  ANON_KEY: 'your-publishable-or-anon-key',

  // 网络: 手表走手机蓝牙代理, 比手机直连慢, 超时给宽松些
  TIMEOUT: 15000,
  RETRY: 2, // 失败重试次数
  RETRY_DELAY: 800, // 重试间隔 (ms), 每次翻倍

  // 调节步进
  STEP: {
    weight: 0.5, // kg
    reps: 1,
    sets: 1,
    rir: 1,
  },

  // 取值范围, 防止转表冠转飞
  RANGE: {
    weight: [0, 300],
    reps: [0, 100],
    sets: [0, 20],
    rir: [0, 10],
  },
}

/** 主题色 —— 深色底 + 单强调色 */
export const THEME = {
  bg: '#000000', // AMOLED 纯黑: 省电, 且圆屏边缘自然消隐
  accent: '#00E5A0', // 薄荷绿: 进度与完成态
  text: '#FFFFFF',
  textDim: '#8A8A8E',
  textFaint: '#48484A',
  surface: '#1C1C1E',
  danger: '#FF453A',
}
