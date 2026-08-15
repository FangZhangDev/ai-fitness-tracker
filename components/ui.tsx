// 共享 UI 原语 (服务端/客户端通用, 无 'use client' 以便服务端组件直接用)
import Link from "next/link";
import type { ReactNode } from "react";
import { toast } from "@/lib/utils/toast";

export function Card({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function SectionTitle({
  title,
  desc,
  action,
}: {
  title: string;
  desc?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {desc && <p className="mt-0.5 text-sm text-neutral-500">{desc}</p>}
      </div>
      {action}
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-neutral-400">{hint}</span>}
    </label>
  );
}

/**
 * 指标卡片。
 *
 * unit 与 sub 是两件事, 别再混用:
 *   unit 紧跟数值(63.70 kg), 没有单位的指标不传
 *   sub  第二行的补充说明(目标 70kg / 近 7 天)
 * 早先只有 sub, 于是「今日热量」拿它当单位、「当前体重」拿它当目标,
 * 结果体重那张卡片没地方写 kg, 没设目标时还剩一个孤零零的破折号。
 *
 * 值本身是占位符(—)时不显示单位, 「— kg」没有意义。
 */
export function Stat({
  label,
  value,
  unit,
  sub,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: string;
}) {
  const hasValue = value !== "—" && value !== null && value !== undefined && value !== "";
  return (
    <Card className="p-4">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">
        {value}
        {unit && hasValue && (
          <span className="ml-1 text-sm font-normal text-neutral-400">{unit}</span>
        )}
      </div>
      {sub && <div className="mt-0.5 text-xs text-neutral-400">{sub}</div>}
    </Card>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 py-12 text-center dark:border-neutral-700">
      <div className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
        {title}
      </div>
      {hint && <div className="mt-1 text-xs text-neutral-400">{hint}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Badge({
  children,
  color = "neutral",
}: {
  children: ReactNode;
  color?: "neutral" | "green" | "red" | "amber" | "indigo";
}) {
  const map: Record<string, string> = {
    neutral: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
    green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    red: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[color]}`}>
      {children}
    </span>
  );
}

export function LinkButton({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "ghost";
}) {
  const cls = variant === "primary" ? "btn btn-primary" : "btn btn-ghost border border-neutral-200 dark:border-neutral-800";
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

// 餐次中文标签映射
export const MEAL_TYPE_LABEL: Record<string, string> = {
  all_day: "全天",
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐",
  snack: "加餐",
};

export const ACTIVITY_LABEL: Record<string, string> = {
  sedentary: "久坐",
  light: "轻度活动",
  moderate: "中度活动",
  active: "活跃",
  very_active: "非常活跃",
};

/**
 * 跑一个 server action, 失败时把错误摆出来。
 *
 * 这些删除/重分析按钮原先写成 `await deleteX(fd)`, 返回的 { error } 被直接丢掉,
 * 于是会话过期之类的失败表现为「点了没反应」, 最难排查的那种。
 * 早先这里用的是 window.alert —— 够用, 但它会阻塞整页、样式是浏览器原生的,
 * 手机上尤其突兀。现在换成自己那套轻提示(components/toast-host.tsx),
 * 不到 60 行, 没引任何库。
 */
export async function runAction<T extends { error?: string }>(
  p: Promise<T>,
): Promise<T> {
  const res = await p;
  if (res?.error) toast(res.error, "error");
  return res;
}
