"use client";

import { useActionState, useMemo, useState } from "react";
import {
  createWorkout,
  updateWorkout,
  deleteWorkout,
  deleteWorkoutSession,
} from "@/lib/actions/workouts";
import { todayISO, fmtDateLong } from "@/lib/utils/date";
import { r2, epley1rm } from "@/lib/utils/pr";
import type { WorkoutLog } from "@/lib/types/database";
import { Card, Field, EmptyState, runAction } from "@/components/ui";
import { WEIGHT_HINT } from "@/lib/constants/weight-convention";

/** 一次训练里的一个动作: 当天该动作的全部组 */
type Session = {
  key: string;
  date: string;
  exercise: string;
  workout_day: string | null;
  sets: WorkoutLog[];
};

/**
 * 把每组一行的原始记录收拢成「某天某动作」一条。
 * 降到按组之后直接平铺会让一次训练刷出二三十行, 翻记录变成体力活;
 * 汇总在外、明细在内, 想看单组再展开。
 */
function groupSessions(list: WorkoutLog[]): Session[] {
  const map = new Map<string, Session>();
  for (const w of list) {
    const key = `${w.date}|${w.exercise}`;
    let s = map.get(key);
    if (!s) {
      s = { key, date: w.date, exercise: w.exercise, workout_day: w.workout_day, sets: [] };
      map.set(key, s);
    }
    s.sets.push(w);
  }
  for (const s of map.values()) s.sets.sort((a, b) => a.set_index - b.set_index);
  return Array.from(map.values());
}

/** 汇总口径与视图 v_exercise_sessions 保持一致: 热身组不进容量、不进最大重量 */
function summarize(sets: WorkoutLog[]) {
  const work = sets.filter((s) => !s.is_warmup);
  const weights = work.map((s) => s.weight_kg).filter((w): w is number => w !== null);
  const top = weights.length ? Math.max(...weights) : null;
  const volume = work.reduce((sum, s) => sum + (s.weight_kg ?? 0) * (s.reps ?? 0), 0);
  const rirs = work.map((s) => s.rir).filter((r): r is number => r !== null);
  const lastWeight = work.length ? work[work.length - 1].weight_kg : null;
  return {
    workSets: work.length,
    warmupSets: sets.length - work.length,
    top,
    volume,
    totalReps: work.reduce((n, s) => n + (s.reps ?? 0), 0),
    avgRir: rirs.length ? rirs.reduce((a, b) => a + b, 0) / rirs.length : null,
    // 最后一个工作组比最重的那组轻 —— 力竭减重, 值得一眼看见
    dropped: top !== null && lastWeight !== null && lastWeight < top,
    best1rm: work.reduce<number | null>((best, s) => {
      const v = epley1rm(s.weight_kg, s.reps);
      return v !== null && (best === null || v > best) ? v : best;
    }, null),
    fromWatch: sets.some((s) => s.source === "watch"),
  };
}

export default function WorkoutsManager({ list }: { list: WorkoutLog[] }) {
  const [state, formAction, pending] = useActionState(createWorkout, undefined);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const sessions = useMemo(() => groupSessions(list), [list]);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <form action={formAction} className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="日期">
            <input name="date" type="date" defaultValue={todayISO()} className="input" required />
          </Field>
          <Field label="训练日">
            <input name="workout_day" className="input" placeholder="推/拉/腿" />
          </Field>
          <Field label="动作">
            <input name="exercise" className="input" placeholder="如：卧推" required />
          </Field>
          <Field label="重量(kg)" hint={WEIGHT_HINT}>
            <input name="weight_kg" type="number" step="0.5" className="input" />
          </Field>
          <Field label="组数" hint="按这个数展开成 N 组相同数据，之后可单独改某一组">
            <input name="sets" type="number" min={1} max={20} defaultValue={1} className="input" />
          </Field>
          <Field label="每组次数">
            <input name="reps" type="number" className="input" />
          </Field>
          <Field label="RIR">
            <input name="rir" type="number" min={0} max={10} className="input" placeholder="0-10" />
          </Field>
          <Field label="备注">
            <input name="notes" className="input" />
          </Field>
          <div className="col-span-2 flex flex-wrap items-center gap-3 md:col-span-4">
            <button disabled={pending} className="btn btn-primary">
              {pending ? "保存中" : "+ 添加训练"}
            </button>
            <label className="flex items-center gap-1 text-xs text-neutral-500">
              <input type="checkbox" name="is_warmup" />
              热身组（不计入容量与 PR）
            </label>
            {state?.error && <span className="text-sm text-red-600">{state.error}</span>}
          </div>
        </form>
      </Card>

      {sessions.length === 0 ? (
        <EmptyState title="暂无训练记录" hint="在上方记录今天的训练" />
      ) : (
        <Card className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {sessions.map((s) => {
            const sum = summarize(s.sets);
            const open = openKey === s.key;
            return (
              <div key={s.key}>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 p-3 text-sm">
                  <span className="w-24 font-medium tabular-nums">{fmtDateLong(s.date)}</span>
                  {s.workout_day && <span className="text-neutral-400">{s.workout_day}</span>}
                  <span className="font-medium">
                    {s.exercise}
                    {/* 手表上转表冠难免记错一位, 标出来便于集中复核 */}
                    {sum.fromWatch && (
                      <span title="这条有在手表上记的组" className="ml-1 text-neutral-400">
                        ⌚
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums text-neutral-500">
                    {r2(sum.top)}kg × {sum.workSets}组 · {sum.totalReps}次
                  </span>
                  {sum.dropped && (
                    <span
                      title="最后一组比最重的那组轻"
                      className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
                    >
                      掉重量
                    </span>
                  )}
                  {sum.warmupSets > 0 && (
                    <span className="text-xs text-neutral-400">热身 {sum.warmupSets} 组</span>
                  )}
                  {sum.avgRir !== null && (
                    <span className="text-neutral-400">RIR≈{r2(sum.avgRir)}</span>
                  )}
                  <span className="tabular-nums text-neutral-400">容量 {r2(sum.volume)}kg</span>
                  <span className="tabular-nums text-neutral-400">1RM≈{r2(sum.best1rm)}</span>
                  <div className="ml-auto flex gap-1">
                    <button
                      onClick={() => setOpenKey(open ? null : s.key)}
                      className="btn btn-ghost px-2 py-1 text-xs"
                    >
                      {open ? "收起" : `${s.sets.length} 组 ▾`}
                    </button>
                    <form
                      action={async (fd) => {
                        await runAction(deleteWorkoutSession(fd));
                      }}
                    >
                      <input type="hidden" name="date" value={s.date} />
                      <input type="hidden" name="exercise" value={s.exercise} />
                      <button className="btn btn-danger px-2 py-1 text-xs">删除</button>
                    </form>
                  </div>
                </div>

                {open && (
                  <div className="space-y-1 bg-neutral-50 px-3 pb-3 dark:bg-neutral-900/40">
                    {s.sets.map((w) => (
                      <SetRow key={w.id} log={w} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

/** 单独一组: 平时只读, 点编辑才展开成表单 */
function SetRow({ log }: { log: WorkoutLog }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <EditRow log={log} onDone={() => setEditing(false)} />;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-1 text-sm">
      <span className="w-10 shrink-0 text-xs tabular-nums text-neutral-400">
        {log.set_index}组
      </span>
      <span className="tabular-nums">
        {r2(log.weight_kg)}kg × {log.reps ?? "—"}
      </span>
      {log.rir !== null && <span className="text-neutral-400">RIR {log.rir}</span>}
      {log.is_warmup && <span className="text-xs text-neutral-400">热身</span>}
      {log.rest_sec !== null && (
        <span className="text-xs tabular-nums text-neutral-400" title="这组之后休息了多久">
          休息 {log.rest_sec}s
        </span>
      )}
      {log.notes && <span className="text-neutral-400">{log.notes}</span>}
      <div className="ml-auto flex gap-1">
        <button onClick={() => setEditing(true)} className="btn btn-ghost px-2 py-0.5 text-xs">
          编辑
        </button>
        <form
          action={async (fd) => {
            await runAction(deleteWorkout(fd));
          }}
        >
          <input type="hidden" name="id" value={log.id} />
          <button className="btn btn-ghost px-2 py-0.5 text-xs text-red-600">删除</button>
        </form>
      </div>
    </div>
  );
}

function EditRow({ log, onDone }: { log: WorkoutLog; onDone: () => void }) {
  const [, formAction, pending] = useActionState(updateWorkout, undefined);
  return (
    <form action={formAction} className="grid grid-cols-2 gap-2 py-2 md:grid-cols-4">
      <input type="hidden" name="id" value={log.id} />
      <input name="date" type="date" defaultValue={log.date} className="input" />
      <input
        name="workout_day"
        defaultValue={log.workout_day ?? ""}
        className="input"
        placeholder="训练日"
      />
      <input name="exercise" defaultValue={log.exercise} className="input" placeholder="动作" />
      <input
        name="weight_kg"
        type="number"
        step="0.5"
        defaultValue={log.weight_kg ?? ""}
        className="input"
        placeholder="重量"
      />
      <input
        name="reps"
        type="number"
        defaultValue={log.reps ?? ""}
        className="input"
        placeholder="次数"
      />
      <input
        name="rir"
        type="number"
        defaultValue={log.rir ?? ""}
        className="input"
        placeholder="RIR"
      />
      <input
        name="notes"
        defaultValue={log.notes ?? ""}
        className="input"
        placeholder="备注"
      />
      <label className="flex items-center gap-1 text-xs text-neutral-500">
        <input type="checkbox" name="is_warmup" defaultChecked={log.is_warmup} />
        热身组
      </label>
      <div className="col-span-2 flex justify-end gap-2 md:col-span-4">
        <button type="button" onClick={onDone} className="btn btn-ghost text-xs">
          取消
        </button>
        <button disabled={pending} className="btn btn-primary text-xs">
          {pending ? "保存中" : "保存"}
        </button>
      </div>
    </form>
  );
}
