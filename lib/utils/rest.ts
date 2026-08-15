/**
 * 休息时长解析 —— 只在「拿到的是文本」时才需要
 *
 * 计划里的休息时长现在只有 rest_sec 一个字段, 单位秒 (0009 起)。
 * 但 AI 解析计划文本时, 模型偶尔仍会回 "2-3分钟" 这样的原文, 所以留一个解析器
 * 兜底。规则与 0008/0009 迁移里回填历史用的完全一致 —— 两边不一致的话,
 * 同一段文本在旧数据和新数据上会算出不同的秒数。
 *
 * 规则:
 *   "90秒"    -> 90
 *   "60-90秒" -> 60    区间取下界, 宁短勿长: 不够可以接着等, 多等一分钟很难受
 *   "2-3分钟" -> 120
 *   解析不出来 -> null  手表侧按 90 秒兜底
 */
export function parseRestSec(rest: string | null | undefined): number | null {
  if (!rest) return null;
  const m = rest.match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  if (!Number.isFinite(n)) return null;
  // 带"分"就按分钟算, 否则一律当秒
  const sec = /分/.test(rest) ? n * 60 : n;
  if (sec <= 0) return null;
  return Math.min(Math.round(sec), 3600);
}
