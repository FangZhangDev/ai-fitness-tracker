"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/utils/server";

export type ActionResult = { error?: string };

function num(v: FormDataEntryValue | null): number | null {
  const s = v?.toString().trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function str(v: FormDataEntryValue | null): string {
  return (v?.toString() ?? "").trim() || "";
}

export async function createDailyMetric(prev: unknown, formData: FormData): Promise<ActionResult> {
  const { supabase, userId } = await getCurrentUser();
  const date = str(formData.get("date"));
  if (!date) return { error: "请选择日期" };
  const { error } = await supabase.from("daily_metrics").insert({
    user_id: userId,
    date,
    weight_kg: num(formData.get("weight_kg")),
    body_fat_pct: num(formData.get("body_fat_pct")),
    waist_cm: num(formData.get("waist_cm")),
    sleep_hours: num(formData.get("sleep_hours")),
    notes: str(formData.get("notes")),
  });
  if (error) return { error: mapError(error) };
  revalidatePath("/body");
  revalidatePath("/");
  return {};
}

export async function updateDailyMetric(prev: unknown, formData: FormData): Promise<ActionResult> {
  const { supabase } = await getCurrentUser();
  const id = str(formData.get("id"));
  const { error } = await supabase
    .from("daily_metrics")
    .update({
      date: str(formData.get("date")),
      weight_kg: num(formData.get("weight_kg")),
      body_fat_pct: num(formData.get("body_fat_pct")),
      waist_cm: num(formData.get("waist_cm")),
      sleep_hours: num(formData.get("sleep_hours")),
      notes: str(formData.get("notes")),
    })
    .eq("id", id);
  if (error) return { error: mapError(error) };
  revalidatePath("/body");
  revalidatePath("/");
  return {};
}

export async function deleteDailyMetric(formData: FormData): Promise<ActionResult> {
  const { supabase } = await getCurrentUser();
  const id = str(formData.get("id"));
  const { error } = await supabase.from("daily_metrics").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/body");
  revalidatePath("/");
  return {};
}

// 23505 = 唯一约束冲突 (同一天重复)
function mapError(e: { code?: string; message: string }): string {
  if (e.code === "23505") return "该日期已有记录, 请编辑而非新增";
  return e.message;
}
