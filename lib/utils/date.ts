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
