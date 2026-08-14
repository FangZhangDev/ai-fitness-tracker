"use client";

import { useActionState, useState } from "react";
import { createWorkout, updateWorkout, deleteWorkout } from "@/lib/actions/workouts";
import { todayISO, fmtDateLong } from "@/lib/utils/date";
import { r2, epley1rm } from "@/lib/utils/pr";
import type { WorkoutLog } from "@/lib/types/database";
import { Card, Field, EmptyState } from "@/components/ui";
import { WEIGHT_HINT } from "@/lib/constants/weight-convention";

export default function WorkoutsManager({ list }: { list: WorkoutLog[] }) {
  const [state, formAction, pending] = useActionState(createWorkout, undefined);
  const [editingId, setEditingId] = useState<string | null>(null);

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
          <Field label="组数">
            <input name="sets" type="number" className="input" />
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
          <div className="col-span-2 md:col-span-4">
            <button disabled={pending} className="btn btn-primary">{pending ? "保存中" : "+ 添加训练"}</button>
            {state?.error && (
              <span className="ml-3 text-sm text-red-600">{state.error}</span>
            )}
          </div>
        </form>
      </Card>

      {list.length === 0 ? (
        <EmptyState title="暂无训练记录" hint="在上方记录今天的训练" />
      ) : (
        <Card className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {list.map((w) =>
            editingId === w.id ? (
              <EditRow key={w.id} log={w} onDone={() => setEditingId(null)} />
            ) : (
              <div key={w.id} className="flex flex-wrap items-center gap-x-5 gap-y-1 p-3 text-sm">
                <span className="w-24 font-medium tabular-nums">{fmtDateLong(w.date)}</span>
                {w.workout_day && <span className="text-neutral-400">{w.workout_day}</span>}
                <span className="font-medium">
                  {w.exercise}
                  {/* 手表上转表冠难免记错一位, 标出来便于集中复核 */}
                  {w.source === "watch" && (
                    <span title="这条是在手表上记的" className="ml-1 text-neutral-400">⌚</span>
                  )}
                </span>
                <span className="tabular-nums text-neutral-500">{r2(w.weight_kg)}kg × {w.sets}×{w.reps}</span>
                {w.rir !== null && <span className="text-neutral-400">RIR {w.rir}</span>}
                <span className="tabular-nums text-neutral-400">1RM≈{r2(epley1rm(w.weight_kg, w.reps))}</span>
                {w.notes && <span className="text-neutral-400">{w.notes}</span>}
                <div className="ml-auto flex gap-1">
                  <button onClick={() => setEditingId(w.id)} className="btn btn-ghost px-2 py-1 text-xs">编辑</button>
                  <form action={async (fd) => { await deleteWorkout(fd); }}>
                    <input type="hidden" name="id" value={w.id} />
                    <button className="btn btn-danger px-2 py-1 text-xs">删除</button>
                  </form>
                </div>
              </div>
            ),
          )}
        </Card>
      )}
    </div>
  );
}

function EditRow({ log, onDone }: { log: WorkoutLog; onDone: () => void }) {
  const [, formAction, pending] = useActionState(updateWorkout, undefined);
  return (
    <form action={formAction} className="grid grid-cols-2 gap-2 p-3 md:grid-cols-4">
      <input type="hidden" name="id" value={log.id} />
      <input name="date" type="date" defaultValue={log.date} className="input" />
      <input name="workout_day" defaultValue={log.workout_day ?? ""} className="input" placeholder="训练日" />
      <input name="exercise" defaultValue={log.exercise} className="input" placeholder="动作" />
      <input name="weight_kg" type="number" step="0.5" defaultValue={log.weight_kg ?? ""} className="input" placeholder="重量" />
      <input name="sets" type="number" defaultValue={log.sets ?? ""} className="input" placeholder="组数" />
      <input name="reps" type="number" defaultValue={log.reps ?? ""} className="input" placeholder="次数" />
      <input name="rir" type="number" defaultValue={log.rir ?? ""} className="input" placeholder="RIR" />
      <input name="notes" defaultValue={log.notes ?? ""} className="input" placeholder="备注" />
      <div className="col-span-2 flex justify-end gap-2 md:col-span-4">
        <button type="button" onClick={onDone} className="btn btn-ghost text-xs">取消</button>
        <button disabled={pending} className="btn btn-primary text-xs">{pending ? "保存中" : "保存"}</button>
      </div>
    </form>
  );
}
