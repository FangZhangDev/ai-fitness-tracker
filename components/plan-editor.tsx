"use client";

import { useActionState, useState } from "react";
import {
  updatePlanExercise,
  addPlanExercise,
  deletePlanExercise,
  movePlanExercise,
  updatePlanDay,
  addPlanDay,
  deletePlanDay,
} from "@/lib/actions/plan";
import {
  WEEKDAY_LABEL,
  type PlanDay,
  type PlanExercise,
  type Weekday,
} from "@/lib/types/database";
import { Card, Field, runAction } from "@/components/ui";
import { fmtRange, fmtSetsReps } from "@/components/plan-creator";

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as Weekday[];

/** 编辑启用中计划的内容: 增删训练日、改周几与主题、动作的增删改与排序 */
export default function PlanEditor({
  planId,
  days,
  exercisesByDay,
}: {
  planId: string;
  days: PlanDay[];
  exercisesByDay: Record<string, PlanExercise[]>;
}) {
  // 一套计划里同一个周几只能有一条 (0002 的 unique 约束), 已占用的不给选
  const used = new Set(days.map((d) => d.weekday));

  return (
    <div className="space-y-3">
      {days.length === 0 && (
        <Card className="p-4 text-sm text-neutral-500">
          这套计划还没有训练日，先在下面加一个。
        </Card>
      )}
      {days.map((d) => (
        <DayBlock
          key={d.id}
          day={d}
          exercises={exercisesByDay[d.id] ?? []}
          used={used}
        />
      ))}
      <AddDayCard planId={planId} used={used} />
    </div>
  );
}

/** 新增训练日: 选周几 + 起个主题, 建完再往里加动作 */
function AddDayCard({ planId, used }: { planId: string; used: Set<Weekday> }) {
  const [open, setOpen] = useState(false);
  const free = WEEKDAYS.filter((w) => !used.has(w));
  const [state, formAction, pending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const res = await addPlanDay(prev, fd);
      if (!res.error) setOpen(false);
      return res;
    },
    undefined,
  );

  if (!free.length) {
    return (
      <Card className="p-3 text-xs text-neutral-400">
        一周七天都排满了，想换内容就直接改上面的训练日。
      </Card>
    );
  }

  if (!open) {
    return (
      <Card className="p-3">
        <button onClick={() => setOpen(true)} className="btn btn-ghost px-2 py-1 text-xs">
          + 添加训练日
        </button>
      </Card>
    );
  }

  return (
    <Card className="p-3">
      <form action={formAction} className="space-y-2">
        <input type="hidden" name="plan_id" value={planId} />
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <Field label="周几">
            <select name="weekday" defaultValue={free[0]} className="input">
              {free.map((w) => (
                <option key={w} value={w}>
                  {WEEKDAY_LABEL[w]}
                </option>
              ))}
            </select>
          </Field>
          <div className="md:col-span-3">
            <Field label="主题" hint="例如「下肢，股四 + 臀」；只是个名字，记录时会回填到训练日">
              <input name="title" className="input" placeholder="下肢 A" required autoFocus />
            </Field>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button disabled={pending} className="btn btn-primary px-3 py-1 text-xs">
            {pending ? "添加中…" : "添加"}
          </button>
          <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost px-3 py-1 text-xs">
            取消
          </button>
          {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
        </div>
      </form>
    </Card>
  );
}

function DayBlock({
  day,
  exercises,
  used,
}: {
  day: PlanDay;
  exercises: PlanExercise[];
  used: Set<Weekday>;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [adding, setAdding] = useState(false);
  const [titleState, titleAction, titlePending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const res = await updatePlanDay(prev, fd);
      if (!res.error) setEditingTitle(false);
      return res;
    },
    undefined,
  );
  // 别的训练日占掉的周几不能选, 自己当前这天要留着
  const selectable = WEEKDAYS.filter((w) => w === day.weekday || !used.has(w));

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-3 py-2 dark:border-neutral-800">
        {editingTitle ? (
          <form action={titleAction} className="flex flex-1 flex-wrap items-center gap-2">
            <input type="hidden" name="id" value={day.id} />
            <select name="weekday" defaultValue={day.weekday} className="input w-auto">
              {selectable.map((w) => (
                <option key={w} value={w}>
                  {WEEKDAY_LABEL[w]}
                </option>
              ))}
            </select>
            <input
              name="title"
              defaultValue={day.title}
              className="input min-w-40 flex-1"
              autoFocus
            />
            <button disabled={titlePending} className="btn btn-primary px-3 py-1 text-xs">
              {titlePending ? "保存中…" : "保存"}
            </button>
            <button
              type="button"
              onClick={() => setEditingTitle(false)}
              className="btn btn-ghost px-3 py-1 text-xs"
            >
              取消
            </button>
            {titleState?.error && (
              <span className="text-xs text-red-600">{titleState.error}</span>
            )}
          </form>
        ) : (
          <>
            <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-sm font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
              {WEEKDAY_LABEL[day.weekday]}
            </span>
            <span className="text-sm text-neutral-600 dark:text-neutral-300">{day.title}</span>
            <button
              onClick={() => setEditingTitle(true)}
              className="btn btn-ghost px-2 py-0.5 text-xs"
            >
              改周几/主题
            </button>
            <span className="ml-auto text-xs text-neutral-400">{exercises.length} 个动作</span>
            {confirmDelete ? (
              <form
                action={async (fd) => {
                  await runAction(deletePlanDay(fd));
                  setConfirmDelete(false);
                }}
                className="flex items-center gap-1"
              >
                <input type="hidden" name="id" value={day.id} />
                <span className="text-xs text-neutral-500">
                  连同 {exercises.length} 个动作一起删？
                </span>
                <button className="btn btn-danger px-2 py-0.5 text-xs">删除</button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="btn btn-ghost px-2 py-0.5 text-xs"
                >
                  取消
                </button>
              </form>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="btn btn-ghost px-2 py-0.5 text-xs text-red-600"
              >
                删除本日
              </button>
            )}
          </>
        )}
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
        {ex.rest_sec && <span className="text-neutral-400">休息 {ex.rest_sec}s</span>}
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
        {/* 手表的组间倒计时直接读它; 留空则手表按 90 秒兜底 */}
        <Field label="休息(秒)" hint="手表组间倒计时用；留空手表按 90 秒算">
          <input
            name="rest_sec"
            type="number"
            min={0}
            max={3600}
            defaultValue={ex?.rest_sec ?? ""}
            className="input"
            placeholder="120"
          />
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
