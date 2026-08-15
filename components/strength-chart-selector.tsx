"use client";

import { useState } from "react";
import StrengthChart from "@/components/charts/strength-chart";
import { EmptyState } from "@/components/ui";

/**
 * 一次训练里某个动作的汇总 (视图 v_exercise_sessions 的子集)。
 * 一天一个点 —— 按组存下来之后, 拿原始行画会在同一个横坐标上叠出好几个点。
 */
interface SessionPoint {
  date: string;
  exercise: string;
  top_weight_kg: number | null;
  best_1rm_kg: number | null;
}

export default function StrengthChartSelector({ logs }: { logs: SessionPoint[] }) {
  const exercises = Array.from(new Set(logs.map((l) => l.exercise))).sort();
  const [selected, setSelected] = useState(exercises[0] || "");

  if (exercises.length === 0) {
    return <EmptyState title="暂无训练数据" hint="记录训练后将生成力量增长曲线" />;
  }

  const points = logs
    .filter((l) => l.exercise === selected && l.top_weight_kg !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((l) => ({
      date: l.date,
      weight: l.top_weight_kg,
      e1rm: l.best_1rm_kg,
    }));

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1">
        {exercises.map((ex) => (
          <button
            key={ex}
            onClick={() => setSelected(ex)}
            className={`rounded-full px-3 py-1 text-xs transition ${
              selected === ex
                ? "bg-indigo-600 text-white"
                : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300"
            }`}
          >
            {ex}
          </button>
        ))}
      </div>
      <StrengthChart data={points} />
    </div>
  );
}
