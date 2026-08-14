/**
 * 应用配置
 *
 * 手表直连 Supabase 的 RPC 接口, 不经过 Vercel:
 *   1. 少一跳, 延迟更低
 *   2. 绕开 vercel.app 域名在国内不稳定的问题
 *
 * ANON_KEY 是 Supabase 的「公开密钥」, 本来就会打进网页前端的 bundle,
 * 写在这里不会带来额外风险 —— 所有数据表都开了 RLS, 单靠这个 key 查不到
 * 任何人的数据。手表的真正凭据是配对后拿到的 device token。
 */
export const CONFIG = {
  SUPABASE_URL: 'https://brizffqttkhuktpqlcie.supabase.co',
  ANON_KEY: 'sb_publishable_KLWOTYIG6jQ24V4oOBSx_w_OeDQsv11',

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
