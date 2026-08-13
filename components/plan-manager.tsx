"use client";

import { useState } from "react";
import {
  activatePlan,
  duplicatePlan,
  renamePlan,
  deletePlan,
} from "@/lib/actions/plan";
import type { WorkoutPlan } from "@/lib/types/database";
import { Card, Badge, EmptyState } from "@/components/ui";

/**
 * 计划列表: 切换启用、复制、重命名、删除。
 * 想改计划又怕改坏, 就先「复制」再改副本 —— 原计划留着, 随时切回去。
 */
export default function PlanManager({
  plans,
  counts,
}: {
  plans: WorkoutPlan[];
  counts: Record<string, { days: number; exercises: number }>;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  if (!plans.length) {
    return <EmptyState title="还没有任何计划" hint="用下方的「粘贴导入」或「让 AI 生成」建一份" />;
  }

  return (
    <Card className="divide-y divide-neutral-100 dark:divide-neutral-800">
      {plans.map((p) => {
        const c = counts[p.id] ?? { days: 0, exercises: 0 };
        return (
          <div key={p.id} className="p-3">
            {renamingId === p.id ? (
              <form
                action={async (fd) => {
                  await renamePlan(fd);
                  setRenamingId(null);
                }}
                className="flex gap-2"
              >
                <input type="hidden" name="id" value={p.id} />
                <input name="name" defaultValue={p.name} className="input flex-1" autoFocus />
                <button className="btn btn-primary px-3 py-1 text-xs">保存</button>
                <button
                  type="button"
                  onClick={() => setRenamingId(null)}
                  className="btn btn-ghost px-3 py-1 text-xs"
                >
                  取消
                </button>
              </form>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="font-medium">{p.name}</span>
                {p.is_active ? <Badge color="green">启用中</Badge> : null}
                <span className="text-xs text-neutral-400">
                  {c.days} 个训练日 · {c.exercises} 个动作
                </span>

                <div className="ml-auto flex flex-wrap gap-1">
                  {!p.is_active && (
                    <form action={async (fd) => { await activatePlan(fd); }}>
                      <input type="hidden" name="id" value={p.id} />
                      <button className="btn btn-ghost px-2 py-1 text-xs">切换到这套</button>
                    </form>
                  )}
                  <form action={async (fd) => { await duplicatePlan(fd); }}>
                    <input type="hidden" name="id" value={p.id} />
                    <button className="btn btn-ghost px-2 py-1 text-xs" title="复制一份再改，原计划不受影响">
                      复制
                    </button>
                  </form>
                  <button
                    onClick={() => setRenamingId(p.id)}
                    className="btn btn-ghost px-2 py-1 text-xs"
                  >
                    重命名
                  </button>
                  {confirmId === p.id ? (
                    <form
                      action={async (fd) => {
                        await deletePlan(fd);
                        setConfirmId(null);
                      }}
                      className="flex items-center gap-1"
                    >
                      <input type="hidden" name="id" value={p.id} />
                      <span className="text-xs text-neutral-500">确定删除？</span>
                      <button className="btn btn-danger px-2 py-1 text-xs">删除</button>
                      <button
                        type="button"
                        onClick={() => setConfirmId(null)}
                        className="btn btn-ghost px-2 py-1 text-xs"
                      >
                        取消
                      </button>
                    </form>
                  ) : (
                    <button
                      onClick={() => setConfirmId(p.id)}
                      className="btn btn-ghost px-2 py-1 text-xs text-red-600"
                    >
                      删除
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
      <p className="p-3 text-xs text-neutral-400">
        删除计划不会影响已经记录的训练数据。
      </p>
    </Card>
  );
}
