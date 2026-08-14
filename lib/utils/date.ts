// 日期工具
import { format, parseISO, subDays } from "date-fns";

/** 当天 ISO 日期 (yyyy-MM-dd, 本地时区) */
export function todayISO(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function fmtDate(iso: string): string {
  try {
    return format(parseISO(iso), "MM-dd");
  } catch {
    return iso;
  }
}

export function fmtDateLong(iso: string): string {
  try {
    return format(parseISO(iso), "yyyy-MM-dd");
  } catch {
    return iso;
  }
}

/** 最近 N 天的日期数组 (含今天, 升序) */
export function lastNDays(n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(format(subDays(new Date(), i), "yyyy-MM-dd"));
  }
  return out;
}

/** 相对 N 天前的 ISO 日期 */
export function daysAgoISO(n: number): string {
  return format(subDays(new Date(), n), "yyyy-MM-dd");
}

// ---------------------------------------------------------------------------
// 数据管理页的时间范围
//
// 「按周/月/年挑选」的落点其实只有一个: 一段起止日期。所以统一成 {from,to},
// 页面只管把 key 翻译成日期, 查询与筛选逻辑都不必再分情况。
// ---------------------------------------------------------------------------

export type RangeKey = "7d" | "30d" | "month" | "3m" | "year" | "all" | "custom";

export const RANGE_LABEL: Record<RangeKey, string> = {
  "7d": "近 7 天",
  "30d": "近 30 天",
  month: "本月",
  "3m": "近 3 个月",
  year: "今年",
  all: "全部",
  custom: "自定义",
};

/** 数据再早也早不过这个日子, 用它表示「不设下界」 */
const EPOCH = "1970-01-01";

/**
 * 把范围 key 换算成起止日期 (含两端)。
 * custom 用调用方传进来的 from/to; 缺一边就按不设界处理。
 */
export function resolveRange(
  key: RangeKey,
  from?: string,
  to?: string
): { from: string; to: string } {
  const today = todayISO();
  switch (key) {
    case "7d":
      return { from: daysAgoISO(6), to: today };
    case "30d":
      return { from: daysAgoISO(29), to: today };
    case "month":
      return { from: format(new Date(), "yyyy-MM-01"), to: today };
    case "3m":
      return { from: daysAgoISO(89), to: today };
    case "year":
      return { from: format(new Date(), "yyyy-01-01"), to: today };
    case "custom":
      return { from: from || EPOCH, to: to || today };
    case "all":
    default:
      return { from: EPOCH, to: today };
  }
}

/** yyyy-MM-dd -> yyyy-MM, 数据管理页按月折叠用 */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/** yyyy-MM -> 2026 年 8 月 */
export function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-");
  return `${y} 年 ${Number(m)} 月`;
}
