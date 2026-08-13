"use client";

import { useState } from "react";
import StrengthChart from "@/components/charts/strength-chart";
import { epley1rm } from "@/lib/utils/pr";
import { EmptyState } from "@/components/ui";

interface Log {
  date: string;
  exercise: string;
  weight_kg: number | null;
  reps: number | null;
}

export default function StrengthChartSelector({ logs }: { logs: Log[] }) {
  const exercises = Array.from(new Set(logs.map((l) => l.exercise))).sort();
  const [selected, setSelected] = useState(exercises[0] || "");

  if (exercises.length === 0) {
    return <EmptyState title="暂无训练数据" hint="记录训练后将生成力量增长曲线" />;
  }

  const points = logs
    .filter((l) => l.exercise === selected && l.weight_kg && l.reps)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((l) => ({
      date: l.date,
      weight: l.weight_kg,
      e1rm: epley1rm(l.weight_kg, l.reps),
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
