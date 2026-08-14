"use client";

import { useActionState, useRef } from "react";
import { createMeal, reanalyzeMeal, deleteMeal } from "@/lib/actions/meals";
import { todayISO, fmtDateLong } from "@/lib/utils/date";
import { r1 } from "@/lib/utils/pr";
import type { MealLog } from "@/lib/types/database";
import { Card, Field, EmptyState, Badge, MEAL_TYPE_LABEL } from "@/components/ui";

/** 取最近可套用的「全天」饮食: 排除今天, 每天只留一条, 最多 7 条 */
function pickRecent(list: MealLog[]): MealLog[] {
  const today = todayISO();
  const seen = new Set<string>();
  const out: MealLog[] = [];
  for (const m of list) {
    if (m.meal_type !== "all_day" || m.date === today) continue;
    if (!m.description.trim() || seen.has(m.date)) continue;
    seen.add(m.date);
    out.push(m);
    if (out.length >= 7) break;
  }
  return out;
}

export default function MealsManager({ list }: { list: MealLog[] }) {
  const [state, formAction, pending] = useActionState(createMeal, undefined);
  const descRef = useRef<HTMLTextAreaElement>(null);
  // list 已按日期倒序, 直接顺着取即可
  const recent = pickRecent(list);

  /** 把选中的那天填进输入框, 光标落到末尾便于接着改 */
  function fill(text: string) {
    const el = descRef.current;
    if (!el) return;
    el.value = text;
    el.focus();
    el.setSelectionRange(text.length, text.length);
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="mb-2 text-sm text-neutral-500">
          💡 用自然语言描述就行，AI 会自动估算卡路里与三大营养素。
          默认「全天」——把今天吃的一次性写完最省事，不用一餐餐分开录。
        </div>
        <form action={formAction} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="日期">
              <input name="date" type="date" defaultValue={todayISO()} className="input" required />
            </Field>
            <Field label="餐次" hint="想单独记某一餐再改这里">
              <select name="meal_type" defaultValue="all_day" className="input">
                {Object.entries(MEAL_TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </Field>
            <div className="col-span-2">
              <Field label="吃了什么">
                {/* 日常饮食变化不大, 直接套用最近某天再微调, 比每次重敲一遍快得多 */}
                {recent.length > 0 && (
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="shrink-0 text-xs text-neutral-400">套用最近：</span>
                    {recent.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => fill(m.description)}
                        title={m.description}
                        className="max-w-[16rem] truncate rounded-full border border-neutral-200 px-2.5 py-1 text-xs text-neutral-600 transition hover:border-indigo-400 hover:text-indigo-600 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-indigo-500 dark:hover:text-indigo-400"
                      >
                        {m.date.slice(5)} · {m.description}
                      </button>
                    ))}
                  </div>
                )}
                <textarea
                  ref={descRef}
                  name="description"
                  rows={3}
                  className="input"
                  placeholder="早上三个鸡蛋一个肉包一碗豆浆，中午两碗米饭一份红烧肉一份青菜，下午一个苹果一杯蛋白粉，晚上一碗面条加两个荷包蛋"
                  required
                />
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
