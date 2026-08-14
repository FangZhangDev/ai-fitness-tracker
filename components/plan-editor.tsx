"use client";

import { useActionState, useState } from "react";
import {
  updatePlanExercise,
  addPlanExercise,
  deletePlanExercise,
  movePlanExercise,
  updatePlanDay,
} from "@/lib/actions/plan";
import {
  WEEKDAY_LABEL,
  type PlanDay,
  type PlanExercise,
} from "@/lib/types/database";
import { Card, Field, runAction } from "@/components/ui";
import { fmtRange, fmtSetsReps } from "@/components/plan-creator";

/** 编辑启用中计划的内容: 改动作参数、增删、调顺序、改训练日主题 */
export default function PlanEditor({
  days,
  exercisesByDay,
}: {
  days: PlanDay[];
  exercisesByDay: Record<string, PlanExercise[]>;
}) {
  if (!days.length) {
    return (
      <Card className="p-4 text-sm text-neutral-500">
        这套计划还没有训练日。
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {days.map((d) => (
        <DayBlock key={d.id} day={d} exercises={exercisesByDay[d.id] ?? []} />
      ))}
    </div>
  );
}

function DayBlock({ day, exercises }: { day: PlanDay; exercises: PlanExercise[] }) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [adding, setAdding] = useState(false);
  const [, titleAction] = useActionState(updatePlanDay, undefined);

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-3 py-2 dark:border-neutral-800">
        <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-sm font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
          {WEEKDAY_LABEL[day.weekday]}
        </span>
        {editingTitle ? (
          <form
            action={(fd) => {
              titleAction(fd);
              setEditingTitle(false);
            }}
            className="flex flex-1 gap-2"
          >
            <input type="hidden" name="id" value={day.id} />
            <input name="title" defaultValue={day.title} className="input flex-1" autoFocus />
            <button className="btn btn-primary px-3 py-1 text-xs">保存</button>
          </form>
        ) : (
          <>
            <span className="text-sm text-neutral-600 dark:text-neutral-300">{day.title}</span>
            <button
              onClick={() => setEditingTitle(true)}
              className="btn btn-ghost px-2 py-0.5 text-xs"
            >
              改主题
            </button>
          </>
        )}
        <span className="ml-auto text-xs text-neutral-400">{exercises.length} 个动作</span>
      </div>

      <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {exercises.map((e, i) => (
          <ExerciseRow
            key={e.id}
            ex={e}
            isFirst={i === 0}
            isLast={i === exercises.length - 1}
          />
        ))}
      </div>

      <div className="border-t border-neutral-100 p-3 dark:border-neutral-800">
        {adding ? (
          <ExerciseForm dayId={day.id} onDone={() => setAdding(false)} />
        ) : (
          <button onClick={() => setAdding(true)} className="btn btn-ghost px-2 py-1 text-xs">
            + 添加动作
          </button>
        )}
      </div>
    </Card>
  );
}

function ExerciseRow({
  ex,
  isFirst,
  isLast,
}: {
  ex: PlanExercise;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="p-3">
        <ExerciseForm ex={ex} onDone={() => setEditing(false)} />
      </div>
    );
  }

  return (
    <div className="p-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="font-medium">{ex.exercise}</span>
        <span className="tabular-nums text-neutral-500">{fmtSetsReps(ex)}</span>
        {ex.rir_min !== null && (
          <span className="text-neutral-400">RIR {fmtRange(ex.rir_min, ex.rir_max)}</span>
        )}
        {ex.rest && <span className="text-neutral-400">休息 {ex.rest}</span>}
        {ex.equipment && <span className="text-neutral-400">· {ex.equipment}</span>}

        <div className="ml-auto flex gap-1">
          {!isFirst && (
            <form action={async (fd) => { await movePlanExercise(fd); }}>
              <input type="hidden" name="id" value={ex.id} />
              <input type="hidden" name="dir" value={-1} />
              <button className="btn btn-ghost px-1.5 py-0.5 text-xs" title="上移">↑</button>
            </form>
          )}
          {!isLast && (
            <form action={async (fd) => { await movePlanExercise(fd); }}>
              <input type="hidden" name="id" value={ex.id} />
              <input type="hidden" name="dir" value={1} />
              <button className="btn btn-ghost px-1.5 py-0.5 text-xs" title="下移">↓</button>
            </form>
          )}
          <button onClick={() => setEditing(true)} className="btn btn-ghost px-2 py-0.5 text-xs">
            编辑
          </button>
          <form action={async (fd) => { await runAction(deletePlanExercise(fd)); }}>
            <input type="hidden" name="id" value={ex.id} />
            <button className="btn btn-danger px-2 py-0.5 text-xs">删除</button>
          </form>
        </div>
      </div>
      {ex.cues && <div className="mt-0.5 text-xs text-neutral-400">{ex.cues}</div>}
    </div>
  );
}

/** 新增与编辑共用的表单; 传了 ex 就是编辑, 传 dayId 就是新增 */
function ExerciseForm({
  ex,
  dayId,
  onDone,
}: {
  ex?: PlanExercise;
  dayId?: string;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const res = ex ? await updatePlanExercise(prev, fd) : await addPlanExercise(prev, fd);
      if (!res.error) onDone();
      return res;
    },
    undefined,
  );

  return (
    <form action={formAction} className="space-y-2">
      {ex && <input type="hidden" name="id" value={ex.id} />}
      {dayId && <input type="hidden" name="day_id" value={dayId} />}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        <div className="col-span-2">
          <Field label="动作">
            <input name="exercise" defaultValue={ex?.exercise ?? ""} className="input" required />
          </Field>
        </div>
        <Field label="组数">
          <input name="target_sets" type="number" min={0} max={20} defaultValue={ex?.target_sets ?? ""} className="input" />
        </Field>
        <Field label="次数下限">
          <input name="rep_min" type="number" min={0} max={100} defaultValue={ex?.rep_min ?? ""} className="input" />
        </Field>
        <Field label="次数上限">
          <input name="rep_max" type="number" min={0} max={100} defaultValue={ex?.rep_max ?? ""} className="input" />
        </Field>
        <Field label="休息">
          <input name="rest" defaultValue={ex?.rest ?? ""} className="input" placeholder="2-3分钟" />
        </Field>
        <Field label="RIR 下限">
          <input name="rir_min" type="number" min={0} max={10} defaultValue={ex?.rir_min ?? ""} className="input" />
        </Field>
        <Field label="RIR 上限">
          <input name="rir_max" type="number" min={0} max={10} defaultValue={ex?.rir_max ?? ""} className="input" />
        </Field>
        <div className="col-span-2 md:col-span-4">
          <Field label="器材">
            <input name="equipment" defaultValue={ex?.equipment ?? ""} className="input" />
          </Field>
        </div>
        <div className="col-span-2 md:col-span-6">
          <Field label="要点">
            <textarea name="cues" rows={2} defaultValue={ex?.cues ?? ""} className="input" />
          </Field>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button disabled={pending} className="btn btn-primary px-3 py-1 text-xs">
          {pending ? "保存中…" : "保存"}
        </button>
        <button type="button" onClick={onDone} className="btn btn-ghost px-3 py-1 text-xs">
          取消
        </button>
        {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
