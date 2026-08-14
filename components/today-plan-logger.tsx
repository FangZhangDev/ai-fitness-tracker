"use client";

import { useActionState } from "react";
import Link from "next/link";
import { logFromPlan } from "@/lib/actions/plan";
import { todayISO } from "@/lib/utils/date";
import {
  WEEKDAY_LABEL,
  type ExerciseLast,
  type PlanDay,
  type PlanExercise,
  type Weekday,
} from "@/lib/types/database";
import { Card } from "@/components/ui";
import { fmtRange, fmtSetsReps } from "@/components/plan-creator";
import { WEIGHT_HINT, WEIGHT_RULE } from "@/lib/constants/weight-convention";

/**
 * 今日计划快速记录。
 * 每个动作预填「计划目标组次」与「上次用的重量」, 改几个数字就能一次性保存。
 */
export default function TodayPlanLogger({
  weekday,
  day,
  exercises,
  lastByExercise,
  hasActivePlan,
}: {
  weekday: Weekday;
  day: PlanDay | null;
  exercises: PlanExercise[];
  lastByExercise: Record<string, ExerciseLast>;
  hasActivePlan: boolean;
}) {
  const [state, formAction, pending] = useActionState(logFromPlan, undefined);

  if (!hasActivePlan) {
    return (
      <Card className="p-4">
        <div className="text-sm font-medium">今天是{WEEKDAY_LABEL[weekday]}</div>
        <p className="mt-1 text-sm text-neutral-500">
          还没有启用中的训练计划。
          <Link href="/plan" className="ml-1 text-indigo-600 hover:underline dark:text-indigo-400">
            去建一份
          </Link>
          ，之后每天打开这里就能直接按计划记录。
        </p>
      </Card>
    );
  }

  if (!day || exercises.length === 0) {
    return (
      <Card className="p-4">
        <div className="text-sm font-medium">今天是{WEEKDAY_LABEL[weekday]} · 休息日</div>
        <p className="mt-1 text-sm text-neutral-500">
          当前计划没有安排{WEEKDAY_LABEL[weekday]}的训练。临时想练可以用下面的表单手动记录，或
          <Link href="/plan" className="mx-1 text-indigo-600 hover:underline dark:text-indigo-400">
            调整计划
          </Link>
          。
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
        <span className="text-sm font-medium">
          今天是{WEEKDAY_LABEL[weekday]} · {day.title}
        </span>
        <Link
          href="/plan"
          className="ml-auto text-xs text-neutral-400 hover:text-indigo-600 dark:hover:text-indigo-400"
        >
          调整计划
        </Link>
      </div>

      {/* 重量口径提示: 记法不一致会让 1RM 与容量统计出现系统性偏差 */}
      <p className="mb-3 text-xs text-neutral-400" title={WEIGHT_RULE}>
        重量填写：{WEIGHT_HINT}（{WEIGHT_RULE}）
      </p>

      <form action={formAction} className="space-y-2">
        <input type="hidden" name="date" value={todayISO()} />
        <input type="hidden" name="workout_day" value={day.title} />

        {exercises.map((e) => {
          const last = lastByExercise[e.exercise];
          return (
            <div
              key={e.id}
              className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
            >
              <input type="hidden" name="ids" value={e.id} />
              <input type="hidden" name={`exercise_${e.id}`} value={e.exercise} />

              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="font-medium">{e.exercise}</span>
                {/* 器材类型直接决定重量怎么记(杠铃含杆/哑铃单只), 显示出来省得每次想 */}
                {e.equipment && (
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                    {e.equipment}
                  </span>
                )}
                <span className="text-xs text-neutral-500">
                  目标 {fmtSetsReps(e)}
                  {e.rir_min !== null && ` · RIR ${fmtRange(e.rir_min, e.rir_max)}`}
                  {e.rest && ` · 休息 ${e.rest}`}
                </span>
                {last && (
                  <span className="text-xs text-neutral-400">
                    上次 {last.last_weight_kg ?? "—"}kg × {last.last_sets ?? "—"}×
                    {last.last_reps ?? "—"}（{last.last_date}）
                  </span>
                )}
              </div>

              {e.cues && <div className="mt-1 text-xs text-neutral-400">{e.cues}</div>}

              <div className="mt-2 grid grid-cols-4 gap-2">
                <LabeledInput
                  name={`weight_${e.id}`}
                  label="重量 kg"
                  type="number"
                  step="0.5"
                  defaultValue={last?.last_weight_kg ?? ""}
                />
                <LabeledInput
                  name={`sets_${e.id}`}
                  label="组数"
                  type="number"
                  defaultValue={e.target_sets ?? last?.last_sets ?? ""}
                />
                <LabeledInput
                  name={`reps_${e.id}`}
                  label="次数"
                  type="number"
                  defaultValue={e.rep_min ?? last?.last_reps ?? ""}
                />
                <LabeledInput
                  name={`rir_${e.id}`}
                  label="RIR"
                  type="number"
                  min={0}
                  max={10}
                  defaultValue={e.rir_min ?? last?.last_rir ?? ""}
                />
              </div>
            </div>
          );
        })}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button disabled={pending} className="btn btn-primary">
            {pending ? "保存中…" : "保存今天的训练"}
          </button>
          <span className="text-xs text-neutral-400">
            没练的动作把重量和组次清空即可，不会被记录。
          </span>
          {state?.error && <span className="text-sm text-red-600">{state.error}</span>}
          {state?.saved ? (
            <span className="text-sm text-emerald-600">已保存 {state.saved} 条</span>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

function LabeledInput({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] text-neutral-400">{label}</span>
      <input {...props} className="input" />
    </label>
  );
}
