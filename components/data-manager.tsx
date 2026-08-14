"use client";

import { useState } from "react";
import { deleteDay, deleteOne } from "@/lib/actions/data";
import { r1, r2 } from "@/lib/utils/pr";
import type { DailyMetric, MealLog, WorkoutLog } from "@/lib/types/database";
import { Card, Badge, EmptyState, MEAL_TYPE_LABEL } from "@/components/ui";

export interface DayGroup {
  date: string;
  metrics: DailyMetric[];
  meals: MealLog[];
  workouts: WorkoutLog[];
}

/** 按天汇总所有记录, 支持整天清空或逐条删除 */
export default function DataManager({ days }: { days: DayGroup[] }) {
  if (!days.length) {
    return <EmptyState title="还没有任何记录" hint="去「身体」「饮食」「训练」里先记几条" />;
  }
  return (
    <div className="space-y-3">
      {days.map((d) => (
        <DayCard key={d.date} day={d} />
      ))}
    </div>
  );
}

function DayCard({ day }: { day: DayGroup }) {
  const [confirming, setConfirming] = useState(false);
  const total = day.metrics.length + day.meals.length + day.workouts.length;

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-3 py-2 dark:border-neutral-800">
        <span className="font-medium tabular-nums">{day.date}</span>
        <span className="text-xs text-neutral-400">共 {total} 条</span>
        {day.metrics.length > 0 && <Badge>身体 {day.metrics.length}</Badge>}
        {day.meals.length > 0 && <Badge color="amber">饮食 {day.meals.length}</Badge>}
        {day.workouts.length > 0 && <Badge color="indigo">训练 {day.workouts.length}</Badge>}

        <div className="ml-auto">
          {confirming ? (
            <form
              action={async (fd) => {
                await deleteDay(fd);
                setConfirming(false);
              }}
              className="flex items-center gap-1"
            >
              <input type="hidden" name="date" value={day.date} />
              <span className="text-xs text-neutral-500">删掉这天全部 {total} 条？</span>
              <button className="btn btn-danger px-2 py-1 text-xs">确定删除</button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="btn btn-ghost px-2 py-1 text-xs"
              >
                取消
              </button>
            </form>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="btn btn-ghost px-2 py-1 text-xs text-red-600"
            >
              清空这天
            </button>
          )}
        </div>
      </div>

      <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {day.metrics.map((m) => (
          <Row key={m.id} kind="daily_metrics" id={m.id} label="身体">
            {[
              m.weight_kg !== null && `体重 ${r1(m.weight_kg)}kg`,
              m.body_fat_pct !== null && `体脂 ${r1(m.body_fat_pct)}%`,
              m.waist_cm !== null && `腰围 ${r1(m.waist_cm)}cm`,
              m.sleep_hours !== null && `睡眠 ${r1(m.sleep_hours)}h`,
            ]
              .filter(Boolean)
              .join(" · ") || "（无数据）"}
          </Row>
        ))}

        {day.meals.map((m) => (
          <Row key={m.id} kind="meal_logs" id={m.id} label={MEAL_TYPE_LABEL[m.meal_type] ?? "饮食"}>
            <span className="line-clamp-2">{m.description}</span>
            <span className="ml-2 whitespace-nowrap text-neutral-400">
              {m.calories !== null
                ? `${m.calories}kcal · 蛋白 ${r1(m.protein_g)}g`
                : "未分析"}
            </span>
          </Row>
        ))}

        {day.workouts.map((w) => (
          <Row key={w.id} kind="workout_logs" id={w.id} label="训练">
            <span className="font-medium">{w.exercise}</span>
            {/* 表上转表冠难免记错一位(62.5 记成 6.25), 标出来才好集中复核 */}
            {w.source === "watch" && (
              <span
                title="这条是在手表上记的"
                className="ml-1.5 shrink-0 rounded px-1 text-xs text-neutral-400"
              >
                ⌚
              </span>
            )}
            <span className="ml-2 whitespace-nowrap tabular-nums text-neutral-400">
              {r2(w.weight_kg)}kg × {w.sets ?? "—"}×{w.reps ?? "—"}
              {w.rir !== null && ` · RIR ${w.rir}`}
            </span>
          </Row>
        ))}
      </div>
    </Card>
  );
}

function Row({
  kind,
  id,
  label,
  children,
}: {
  kind: string;
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 px-3 py-2 text-sm">
      <span className="w-12 shrink-0 pt-0.5 text-xs text-neutral-400">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline">{children}</div>
      <form action={async (fd) => { await deleteOne(fd); }} className="shrink-0">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="id" value={id} />
        <button className="btn btn-ghost px-2 py-0.5 text-xs text-red-600">删除</button>
      </form>
    </div>
  );
}
