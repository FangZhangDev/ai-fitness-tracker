"use client";

import { useActionState, useState } from "react";
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

        {exercises.map((e) => (
          <ExerciseRow key={e.id} e={e} last={lastByExercise[e.exercise]} />
        ))}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button disabled={pending} className="btn btn-primary">
            {pending ? "保存中…" : "保存今天的训练"}
          </button>
          <span className="text-xs text-neutral-400">
            没练的动作把重量和组次清空即可，不会被记录；保存会覆盖今天这些动作已有的记录。
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

/**
 * 一个动作一块。默认「整体填」——一次填完重量/组数/次数, 保存时展开成 N 组相同数据,
 * 日常八成的训练就是这样, 逐组敲四遍相同数字纯属受罪。
 *
 * 掉了重量、或者最后一组冲了个 PR, 点「逐组」展开, 每组各填各的。
 * 两种模式靠隐藏字段 mode_{id} 告诉 server action, 见 lib/actions/plan.ts 的 logFromPlan。
 */
function ExerciseRow({ e, last }: { e: PlanExercise; last?: ExerciseLast }) {
  const [perSet, setPerSet] = useState(false);
  // 逐组模式下的行数: 默认按计划的目标组数, 不够可以现场加
  const [setCount, setSetCount] = useState(Math.max(e.target_sets ?? last?.last_sets ?? 3, 1));

  const defWeight = last?.last_weight_kg ?? "";
  const defReps = e.rep_min ?? last?.last_reps ?? "";
  const defRir = e.rir_min ?? last?.last_rir ?? "";

  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <input type="hidden" name="ids" value={e.id} />
      <input type="hidden" name={`exercise_${e.id}`} value={e.exercise} />
      <input type="hidden" name={`mode_${e.id}`} value={perSet ? "sets" : "bulk"} />
      {perSet && <input type="hidden" name={`setcount_${e.id}`} value={setCount} />}

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
          {e.rest_sec && ` · 休息 ${e.rest_sec}s`}
        </span>
        {last && (
          <span className="text-xs text-neutral-400">
            上次 {last.last_weight_kg ?? "—"}kg × {last.last_sets ?? "—"}×
            {last.last_reps ?? "—"}（{last.last_date}）
          </span>
        )}
        <button
          type="button"
          onClick={() => setPerSet((v) => !v)}
          className="ml-auto text-xs text-neutral-400 hover:text-indigo-600 dark:hover:text-indigo-400"
        >
          {perSet ? "收起 ▴" : "逐组 ▾"}
        </button>
      </div>

      {e.cues && <div className="mt-1 text-xs text-neutral-400">{e.cues}</div>}

      {perSet ? (
        <div className="mt-2 space-y-1.5">
          {Array.from({ length: setCount }, (_, i) => i + 1).map((n) => (
            <div key={n} className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-xs tabular-nums text-neutral-400">{n}组</span>
              <input
                name={`sw_${e.id}_${n}`}
                type="number"
                step="0.5"
                placeholder="重量"
                defaultValue={defWeight}
                className="input"
              />
              <input
                name={`sr_${e.id}_${n}`}
                type="number"
                placeholder="次数"
                defaultValue={defReps}
                className="input"
              />
              <input
                name={`srir_${e.id}_${n}`}
                type="number"
                min={0}
                max={10}
                placeholder="RIR"
                defaultValue={defRir}
                className="input"
              />
              <label
                className="flex shrink-0 items-center gap-1 text-xs text-neutral-400"
                title="热身组不计入容量、PR 与平均 RIR"
              >
                <input type="checkbox" name={`swarm_${e.id}_${n}`} value="1" />
                热身
              </label>
            </div>
          ))}
          <div className="flex gap-3 pt-0.5 text-xs">
            <button
              type="button"
              onClick={() => setSetCount((n) => Math.min(n + 1, 20))}
              className="text-neutral-400 hover:text-indigo-600 dark:hover:text-indigo-400"
            >
              + 加一组
            </button>
            {setCount > 1 && (
              <button
                type="button"
                onClick={() => setSetCount((n) => Math.max(n - 1, 1))}
                className="text-neutral-400 hover:text-indigo-600 dark:hover:text-indigo-400"
              >
                − 去一组
              </button>
            )}
            <span className="text-neutral-400">整组留空 = 这组没做</span>
          </div>
        </div>
      ) : (
        <div className="mt-2 grid grid-cols-4 gap-2">
          <LabeledInput
            name={`weight_${e.id}`}
            label="重量 kg"
            type="number"
            step="0.5"
            defaultValue={defWeight}
          />
          <LabeledInput
            name={`sets_${e.id}`}
            label="组数"
            type="number"
            defaultValue={e.target_sets ?? last?.last_sets ?? ""}
          />
          <LabeledInput name={`reps_${e.id}`} label="次数" type="number" defaultValue={defReps} />
          <LabeledInput
            name={`rir_${e.id}`}
            label="RIR"
            type="number"
            min={0}
            max={10}
            defaultValue={defRir}
          />
        </div>
      )}
    </div>
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
