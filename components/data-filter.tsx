"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { RANGE_LABEL, type RangeKey } from "@/lib/utils/date";
import type { DataKind } from "@/lib/actions/data";

const RANGES: RangeKey[] = ["7d", "30d", "month", "3m", "year", "all"];

const KIND_LABEL: Record<DataKind, string> = {
  daily_metrics: "身体",
  meal_logs: "饮食",
  workout_logs: "训练",
};
const ALL_KINDS = Object.keys(KIND_LABEL) as DataKind[];

/**
 * 时间范围与类型筛选。
 *
 * 状态放在 URL 上而不是组件里 —— 刷新、后退、收藏都能保住当前视图,
 * 数据也就仍由服务端按范围查, 不必把全部记录拉到前端再过滤。
 */
export default function DataFilter({
  range,
  from,
  to,
  kinds,
  total,
}: {
  range: RangeKey;
  from: string;
  to: string;
  kinds: DataKind[];
  total: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [customFrom, setCustomFrom] = useState(from);
  const [customTo, setCustomTo] = useState(to);

  function go(next: Record<string, string | string[] | null>) {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      q.delete(k);
      if (v === null) continue;
      if (Array.isArray(v)) v.forEach((x) => q.append(k, x));
      else q.set(k, v);
    }
    router.push(`/data?${q.toString()}`);
  }

  function toggleKind(k: DataKind) {
    const next = kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k];
    // 一个都不选等于什么都看不到, 那不如视作「全选」
    go({ kind: next.length && next.length < ALL_KINDS.length ? next : null });
  }

  return (
    <div className="space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 shrink-0 text-xs text-neutral-400">时间</span>
        {RANGES.map((r) => (
          <button
            key={r}
            onClick={() => go({ range: r, from: null, to: null })}
            className={
              "rounded-full px-2.5 py-1 text-xs transition " +
              (range === r
                ? "bg-indigo-600 text-white"
                : "border border-neutral-200 text-neutral-600 hover:border-indigo-400 dark:border-neutral-700 dark:text-neutral-300")
            }
          >
            {RANGE_LABEL[r]}
          </button>
        ))}

        <span className="ml-2 flex items-center gap-1">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="input px-2 py-1 text-xs"
          />
          <span className="text-xs text-neutral-400">→</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="input px-2 py-1 text-xs"
          />
          <button
            onClick={() => go({ range: "custom", from: customFrom, to: customTo })}
            className={
              "rounded-full px-2.5 py-1 text-xs transition " +
              (range === "custom"
                ? "bg-indigo-600 text-white"
                : "border border-neutral-200 text-neutral-600 hover:border-indigo-400 dark:border-neutral-700 dark:text-neutral-300")
            }
          >
            应用
          </button>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 shrink-0 text-xs text-neutral-400">类型</span>
        {ALL_KINDS.map((k) => {
          const on = kinds.includes(k);
          return (
            <button
              key={k}
              onClick={() => toggleKind(k)}
              className={
                "rounded-full px-2.5 py-1 text-xs transition " +
                (on
                  ? "bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900"
                  : "border border-neutral-200 text-neutral-400 hover:border-neutral-400 dark:border-neutral-700")
              }
            >
              {KIND_LABEL[k]}
            </button>
          );
        })}
        <span className="ml-auto text-xs text-neutral-400">
          {from} ~ {to} · 共 {total} 条
        </span>
      </div>
    </div>
  );
}
