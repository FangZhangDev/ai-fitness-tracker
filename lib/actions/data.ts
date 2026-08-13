"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/utils/server";

export type ActionResult = { error?: string; deleted?: number };

/** 可批量清理的表 */
const KINDS = {
  daily_metrics: "身体记录",
  meal_logs: "饮食记录",
  workout_logs: "训练记录",
} as const;

export type DataKind = keyof typeof KINDS;

function str(v: FormDataEntryValue | null): string {
  return (v?.toString() ?? "").trim();
}

/**
 * 删除某一天的记录。
 * kinds 不传则删掉这天全部三类; 传了就只删指定的那几类。
 */
export async function deleteDay(formData: FormData): Promise<ActionResult> {
  const { supabase, userId } = await getCurrentUser();
  const date = str(formData.get("date"));
  if (!date) return { error: "缺少日期" };

  const picked = formData
    .getAll("kinds")
    .map((v) => v.toString())
    .filter((k): k is DataKind => k in KINDS);
  const targets = picked.length ? picked : (Object.keys(KINDS) as DataKind[]);

  let deleted = 0;
  for (const t of targets) {
    const { error, count } = await supabase
      .from(t)
      .delete({ count: "exact" })
      .eq("user_id", userId)
      .eq("date", date);
    if (error) return { error: `${KINDS[t]}删除失败: ${error.message}` };
    deleted += count ?? 0;
  }

  revalidatePath("/data");
  revalidatePath("/");
  revalidatePath("/body");
  revalidatePath("/meals");
  revalidatePath("/workouts");
  return { deleted };
}

/** 删除单条记录 (数据管理页里逐条清理用) */
export async function deleteOne(formData: FormData): Promise<ActionResult> {
  const { supabase } = await getCurrentUser();
  const kind = str(formData.get("kind")) as DataKind;
  const id = str(formData.get("id"));
  if (!id || !(kind in KINDS)) return { error: "参数不合法" };

  const { error } = await supabase.from(kind).delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/data");
  revalidatePath("/");
  revalidatePath("/body");
  revalidatePath("/meals");
  revalidatePath("/workouts");
  return { deleted: 1 };
}

/** 删除一条 AI 分析报告 */
export async function deleteAnalysis(formData: FormData): Promise<ActionResult> {
  const { supabase } = await getCurrentUser();
  const id = str(formData.get("id"));
  if (!id) return { error: "缺少 ID" };
  const { error } = await supabase.from("ai_analyses").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/data");
  revalidatePath("/analysis");
  return { deleted: 1 };
}
