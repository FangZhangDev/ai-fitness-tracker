"use client";

import { useActionState, useState } from "react";
import { createDailyMetric, updateDailyMetric, deleteDailyMetric } from "@/lib/actions/daily-metrics";
import { todayISO, fmtDateLong } from "@/lib/utils/date";
import { r1, r2 } from "@/lib/utils/pr";
import type { DailyMetric } from "@/lib/types/database";
import { Card, Field, EmptyState } from "@/components/ui";

export default function DailyMetricsManager({ list }: { list: DailyMetric[] }) {
  const [state, formAction, pending] = useActionState(createDailyMetric, undefined);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {/* 新增 */}
      <Card className="p-4">
        <form action={formAction} className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="日期">
            <input name="date" type="date" defaultValue={todayISO()} className="input" required />
          </Field>
          <Field label="体重(kg)">
            <input name="weight_kg" type="number" step="0.1" className="input" />
          </Field>
          <Field label="体脂(%)">
            <input name="body_fat_pct" type="number" step="0.1" className="input" />
          </Field>
          <Field label="腰围(cm)">
            <input name="waist_cm" type="number" step="0.1" className="input" />
          </Field>
          <Field label="睡眠(h)">
            <input name="sleep_hours" type="number" step="0.1" className="input" />
          </Field>
          <div className="col-span-2 md:col-span-3">
            <Field label="备注">
              <input name="notes" className="input" />
            </Field>
          </div>
          <div className="col-span-2 flex items-end gap-2 md:col-span-1">
            <button disabled={pending} className="btn btn-primary w-full">
              {pending ? "保存中" : "+ 记录"}
            </button>
          </div>
          {state?.error && (
            <div className="col-span-full rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-300">
              {state.error}
            </div>
          )}
        </form>
      </Card>

      {/* 列表 */}
      {list.length === 0 ? (
        <EmptyState title="暂无身体记录" hint="在上方填写并保存第一条记录" />
      ) : (
        <Card className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {list.map((m) =>
            editingId === m.id ? (
              <EditRow key={m.id} metric={m} onDone={() => setEditingId(null)} />
            ) : (
              <div key={m.id} className="flex flex-wrap items-center gap-x-6 gap-y-1 p-3 text-sm">
                <span className="w-28 font-medium tabular-nums">{fmtDateLong(m.date)}</span>
                <span className="tabular-nums text-neutral-500">体重 {r2(m.weight_kg)}</span>
                <span className="tabular-nums text-neutral-500">体脂 {r1(m.body_fat_pct)}%</span>
                <span className="tabular-nums text-neutral-500">腰围 {r2(m.waist_cm)}</span>
                <span className="tabular-nums text-neutral-500">睡眠 {r1(m.sleep_hours)}h</span>
                {m.notes && <span className="text-neutral-400">{m.notes}</span>}
                <div className="ml-auto flex gap-1">
                  <button onClick={() => setEditingId(m.id)} className="btn btn-ghost px-2 py-1 text-xs">编辑</button>
                  <form action={async (fd) => { await deleteDailyMetric(fd); }}>
                    <input type="hidden" name="id" value={m.id} />
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

function EditRow({ metric, onDone }: { metric: DailyMetric; onDone: () => void }) {
  const [, formAction, pending] = useActionState(updateDailyMetric, undefined);
  return (
    <form action={formAction} className="grid grid-cols-2 gap-2 p-3 md:grid-cols-4">
      <input type="hidden" name="id" value={metric.id} />
      <input name="date" type="date" defaultValue={metric.date} className="input" />
      <input name="weight_kg" type="number" step="0.1" defaultValue={metric.weight_kg ?? ""} className="input" placeholder="体重" />
      <input name="body_fat_pct" type="number" step="0.1" defaultValue={metric.body_fat_pct ?? ""} className="input" placeholder="体脂" />
      <input name="waist_cm" type="number" step="0.1" defaultValue={metric.waist_cm ?? ""} className="input" placeholder="腰围" />
      <input name="sleep_hours" type="number" step="0.1" defaultValue={metric.sleep_hours ?? ""} className="input" placeholder="睡眠" />
      <input name="notes" defaultValue={metric.notes ?? ""} className="input col-span-2" placeholder="备注" />
      <div className="col-span-2 flex gap-2 md:col-span-4 md:justify-end">
        <button type="button" onClick={onDone} className="btn btn-ghost text-xs">取消</button>
        <button disabled={pending} className="btn btn-primary text-xs">{pending ? "保存中" : "保存"}</button>
      </div>
    </form>
  );
}
