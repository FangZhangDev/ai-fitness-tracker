"use client";

import { useActionState } from "react";
import { createMeal, reanalyzeMeal, deleteMeal } from "@/lib/actions/meals";
import { todayISO, fmtDateLong } from "@/lib/utils/date";
import { r1 } from "@/lib/utils/pr";
import type { MealLog } from "@/lib/types/database";
import { Card, Field, EmptyState, Badge, MEAL_TYPE_LABEL } from "@/components/ui";

export default function MealsManager({ list }: { list: MealLog[] }) {
  const [state, formAction, pending] = useActionState(createMeal, undefined);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="mb-2 text-sm text-neutral-500">
          💡 只需用自然语言描述食物，AI 会自动估算卡路里与三大营养素
        </div>
        <form action={formAction} className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label="日期">
              <input name="date" type="date" defaultValue={todayISO()} className="input" required />
            </Field>
            <Field label="餐次">
              <select name="meal_type" defaultValue="breakfast" className="input">
                {Object.entries(MEAL_TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </Field>
            <div className="col-span-2 md:col-span-2">
              <Field label="食物描述">
                <input name="description" className="input" placeholder="如：三个鸡蛋，一个肉包，一碗豆浆" required />
              </Field>
            </div>
          </div>
          {state?.error && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-300">{state.error}</div>
          )}
          <button disabled={pending} className="btn btn-primary">
            {pending ? "AI 分析中..." : "+ 添加并分析"}
          </button>
        </form>
      </Card>

      {list.length === 0 ? (
        <EmptyState title="暂无饮食记录" hint="在上方描述今天的饮食" />
      ) : (
        <Card className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {list.map((m) => (
            <div key={m.id} className="p-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium tabular-nums">{fmtDateLong(m.date)}</span>
                <Badge color="indigo">{MEAL_TYPE_LABEL[m.meal_type]}</Badge>
                {m.analyzed_at ? <Badge color="green">已分析</Badge> : <Badge color="amber">待分析</Badge>}
                <div className="ml-auto flex gap-1">
                  <form action={async (fd) => { await reanalyzeMeal(fd); }}>
                    <input type="hidden" name="id" value={m.id} />
                    <input type="hidden" name="description" value={m.description} />
                    <input type="hidden" name="meal_type" value={m.meal_type} />
                    <button className="btn btn-ghost px-2 py-1 text-xs">重分析</button>
                  </form>
                  <form action={async (fd) => { await deleteMeal(fd); }}>
                    <input type="hidden" name="id" value={m.id} />
                    <button className="btn btn-danger px-2 py-1 text-xs">删除</button>
                  </form>
                </div>
              </div>
              <div className="mt-1 text-sm">{m.description}</div>
              {m.analyzed_at && (
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs tabular-nums text-neutral-500">
                  <span>热量 <b className="text-neutral-700 dark:text-neutral-200">{m.calories}</b> kcal</span>
                  <span>蛋白 <b className="text-neutral-700 dark:text-neutral-200">{r1(m.protein_g)}</b> g</span>
                  <span>碳水 <b className="text-neutral-700 dark:text-neutral-200">{r1(m.carbs_g)}</b> g</span>
                  <span>脂肪 <b className="text-neutral-700 dark:text-neutral-200">{r1(m.fat_g)}</b> g</span>
                </div>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
