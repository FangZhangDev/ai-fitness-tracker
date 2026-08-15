/**
 * 休息时长: 自由文本 -> 秒
 *
 * 计划里的 rest 一直是人写给人看的 ("2-3分钟" / "60-90秒"), 手表的倒计时用不了,
 * 所以 0008 给 plan_exercises 加了 rest_sec 数字列。这里是写入侧的统一解析,
 * 与迁移里回填历史用的规则保持一致 —— 两边不一致的话, 同一段文本在旧数据和
 * 新数据上会算出不同的秒数。
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

/** 秒 -> 给人看的短文本, 用于计划编辑器里回显 */
export function fmtRestSec(sec: number | null | undefined): string {
  if (!sec) return "";
  if (sec % 60 === 0) return `${sec / 60}分钟`;
  if (sec < 60) return `${sec}秒`;
  return `${Math.floor(sec / 60)}分${sec % 60}秒`;
}
