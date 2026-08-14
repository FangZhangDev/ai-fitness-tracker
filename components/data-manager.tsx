"use client";

import { useMemo, useState } from "react";
import { deleteDay, deleteOne, deleteMany } from "@/lib/actions/data";
import { r1, r2 } from "@/lib/utils/pr";
import { fmtMonth, monthOf } from "@/lib/utils/date";
import type { DailyMetric, MealLog, WorkoutLog } from "@/lib/types/database";
import { Card, Badge, EmptyState, MEAL_TYPE_LABEL, runAction } from "@/components/ui";

export interface DayGroup {
  date: string;
  metrics: DailyMetric[];
  meals: MealLog[];
  workouts: WorkoutLog[];
}

/** 选中项的编码: "表名:id"。与 deleteMany 的解析口径一致 */
type RowKey = string;
const key = (kind: string, id: string): RowKey => `${kind}:${id}`;

function allKeysOf(day: DayGroup): RowKey[] {
  return [
    ...day.metrics.map((m) => key("daily_metrics", m.id)),
    ...day.meals.map((m) => key("meal_logs", m.id)),
    ...day.workouts.map((w) => key("workout_logs", w.id)),
  ];
}

/** 按天汇总所有记录: 勾选批量删除、整天清空、或单条删除 */
export default function DataManager({ days }: { days: DayGroup[] }) {
  const [selected, setSelected] = useState<Set<RowKey>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // 当前视图的全部行, 顺便按月分组 —— 范围拉到三个月以上页面会很长, 按月折叠
  const { months, allKeys } = useMemo(() => {
    const m = new Map<string, DayGroup[]>();
    const keys: RowKey[] = [];
    for (const d of days) {
      const ym = monthOf(d.date);
      const arr = m.get(ym);
      if (arr) arr.push(d);
      else m.set(ym, [d]);
      keys.push(...allKeysOf(d));
    }
    return { months: [...m.entries()], allKeys: keys };
  }, [days]);

  function toggle(k: RowKey) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function setMany(keys: RowKey[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  }

  /** 选中项按类型拆开, 确认时把「要删什么」说清楚 */
  const counts = useMemo(() => {
    let body = 0,
      meal = 0,
      workout = 0;
    for (const k of selected) {
      if (k.startsWith("daily_metrics:")) body++;
      else if (k.startsWith("meal_logs:")) meal++;
      else workout++;
    }
    return { body, meal, workout };
  }, [selected]);

  async function removeSelected() {
    setBusy(true);
    setErr(null);
    const fd = new FormData();
    for (const k of selected) fd.append("ids", k);
    const res = await deleteMany(fd);
    setBusy(false);
    setConfirming(false);
    if (res?.error) {
      setErr(res.error);
      return;
    }
    setSelected(new Set());
  }

  if (!days.length) {
    return (
      <EmptyState
        title="这个范围内没有记录"
        hint="换个时间范围，或去「身体」「饮食」「训练」里先记几条"
      />
    );
  }

  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k));

  return (
    <div className="space-y-3">
      {/* 批量操作栏: 跟随滚动, 选中后才展开具体动作 */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-white/95 px-3 py-2 text-sm backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(e) => setMany(allKeys, e.target.checked)}
            className="h-4 w-4 accent-indigo-600"
          />
          <span className="text-neutral-600 dark:text-neutral-300">
            全选当前 {allKeys.length} 条
          </span>
        </label>

        {selected.size > 0 && (
          <>
            <span className="text-neutral-400">
              已选 <b className="text-neutral-700 dark:text-neutral-200">{selected.size}</b> 条
              {counts.body > 0 && ` · 身体 ${counts.body}`}
              {counts.meal > 0 && ` · 饮食 ${counts.meal}`}
              {counts.workout > 0 && ` · 训练 ${counts.workout}`}
            </span>
            <button onClick={() => setSelected(new Set())} className="btn btn-ghost px-2 py-1 text-xs">
              取消选择
            </button>
            <div className="ml-auto flex items-center gap-1.5">
              {confirming ? (
                <>
                  <span className="text-xs text-red-600">
                    确定删除这 {selected.size} 条？不可撤销
                  </span>
                  <button
                    onClick={removeSelected}
                    disabled={busy}
                    className="btn btn-danger px-2 py-1 text-xs"
                  >
                    {busy ? "删除中…" : "确定删除"}
                  </button>
                  <button onClick={() => setConfirming(false)} className="btn btn-ghost px-2 py-1 text-xs">
                    取消
                  </button>
                </>
              ) : (
                <button onClick={() => setConfirming(true)} className="btn btn-danger px-2 py-1 text-xs">
                  删除选中
                </button>
              )}
            </div>
          </>
        )}
        {err && <span className="w-full text-xs text-red-600">{err}</span>}
      </div>

      {months.map(([ym, list], idx) => {
        const monthKeys = list.flatMap(allKeysOf);
        return (
          // 最近的月份默认展开, 更早的折起来 —— 翻旧账是少数情况
          <details key={ym} open={idx === 0}>
            <summary className="flex cursor-pointer items-center gap-2 py-1 text-sm text-neutral-500">
              <span className="font-medium text-neutral-700 dark:text-neutral-200">
                {fmtMonth(ym)}
              </span>
              <span className="text-xs text-neutral-400">
                {list.length} 天 · {monthKeys.length} 条
              </span>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  setMany(monthKeys, !monthKeys.every((k) => selected.has(k)));
                }}
                className="text-xs text-neutral-400 underline-offset-2 hover:text-indigo-600 hover:underline"
              >
                选中本月
              </button>
            </summary>
            <div className="mt-1 space-y-3">
              {list.map((d) => (
                <DayCard
                  key={d.date}
                  day={d}
                  selected={selected}
                  onToggle={toggle}
                  onToggleDay={setMany}
                />
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function DayCard({
  day,
  selected,
  onToggle,
  onToggleDay,
}: {
  day: DayGroup;
  selected: Set<RowKey>;
  onToggle: (k: RowKey) => void;
  onToggleDay: (keys: RowKey[], on: boolean) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const total = day.metrics.length + day.meals.length + day.workouts.length;
  const keys = allKeysOf(day);
  const dayAll = keys.length > 0 && keys.every((k) => selected.has(k));

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-3 py-2 dark:border-neutral-800">
        <input
          type="checkbox"
          checked={dayAll}
          onChange={(e) => onToggleDay(keys, e.target.checked)}
          title="全选当日"
          className="h-4 w-4 accent-indigo-600"
        />
        <span className="font-medium tabular-nums">{day.date}</span>
        <span className="text-xs text-neutral-400">共 {total} 条</span>
        {day.metrics.length > 0 && <Badge>身体 {day.metrics.length}</Badge>}
        {day.meals.length > 0 && <Badge color="amber">饮食 {day.meals.length}</Badge>}
        {day.workouts.length > 0 && <Badge color="indigo">训练 {day.workouts.length}</Badge>}

        <div className="ml-auto">
          {confirming ? (
            <form
              action={async (fd) => {
                await runAction(deleteDay(fd));
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
          <Row
            key={m.id}
            kind="daily_metrics"
            id={m.id}
            selected={selected}
            onToggle={onToggle}
            label="身体"
          >
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
          <Row
            key={m.id}
            kind="meal_logs"
            id={m.id}
            selected={selected}
            onToggle={onToggle}
            label={MEAL_TYPE_LABEL[m.meal_type] ?? "饮食"}
          >
            <span className="line-clamp-2">{m.description}</span>
            <span className="ml-2 whitespace-nowrap text-neutral-400">
              {m.calories !== null ? `${m.calories}kcal · 蛋白 ${r1(m.protein_g)}g` : "未分析"}
            </span>
          </Row>
        ))}

        {day.workouts.map((w) => (
          <Row
            key={w.id}
            kind="workout_logs"
            id={w.id}
            selected={selected}
            onToggle={onToggle}
            label="训练"
          >
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
  selected,
  onToggle,
  label,
  children,
}: {
  kind: string;
  id: string;
  selected: Set<RowKey>;
  onToggle: (k: RowKey) => void;
  label: string;
  children: React.ReactNode;
}) {
  const k = key(kind, id);
  const on = selected.has(k);
  return (
    <div
      className={
        "flex items-start gap-3 px-3 py-2 text-sm transition " +
        (on ? "bg-indigo-50/60 dark:bg-indigo-950/30" : "hover:bg-neutral-50 dark:hover:bg-neutral-900")
      }
    >
      <input
        type="checkbox"
        checked={on}
        onChange={() => onToggle(k)}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-indigo-600"
      />
      <span className="w-12 shrink-0 pt-0.5 text-xs text-neutral-400">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline">{children}</div>
      {/* 只删一条时不必先勾选再批量删, 保留单条入口 */}
      <form action={async (fd) => { await runAction(deleteOne(fd)); }} className="shrink-0">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="id" value={id} />
        <button className="btn btn-ghost px-2 py-0.5 text-xs text-red-600">删除</button>
      </form>
    </div>
  );
}
