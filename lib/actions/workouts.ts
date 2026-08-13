"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/utils/server";

export type ActionResult = { error?: string };

function str(v: FormDataEntryValue | null): string {
  return (v?.toString() ?? "").trim() || "";
}
function num(v: FormDataEntryValue | null): number | null {
  const s = v?.toString().trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function int(v: FormDataEntryValue | null): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n);
}

export async function createWorkout(prev: unknown, formData: FormData): Promise<ActionResult> {
  const { supabase, userId } = await getCurrentUser();
  const date = str(formData.get("date"));
  const exercise = str(formData.get("exercise"));
  if (!date) return { error: "请选择日期" };
  if (!exercise) return { error: "请输入动作名称" };
  const { error } = await supabase.from("workout_logs").insert({
    user_id: userId,
    date,
    workout_day: str(formData.get("workout_day")) || null,
    exercise,
    weight_kg: num(formData.get("weight_kg")),
    sets: int(formData.get("sets")),
    reps: int(formData.get("reps")),
    rir: int(formData.get("rir")),
    notes: str(formData.get("notes")),
  });
  if (error) return { error: error.message };
  revalidatePath("/workouts");
  revalidatePath("/");
  return {};
}

export async function updateWorkout(prev: unknown, formData: FormData): Promise<ActionResult> {
  const { supabase } = await getCurrentUser();
  const id = str(formData.get("id"));
  const { error } = await supabase
    .from("workout_logs")
    .update({
      date: str(formData.get("date")),
      workout_day: str(formData.get("workout_day")) || null,
      exercise: str(formData.get("exercise")),
      weight_kg: num(formData.get("weight_kg")),
      sets: int(formData.get("sets")),
      reps: int(formData.get("reps")),
      rir: int(formData.get("rir")),
      notes: str(formData.get("notes")),
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/workouts");
  revalidatePath("/");
  return {};
}

export async function deleteWorkout(formData: FormData): Promise<ActionResult> {
  const { supabase } = await getCurrentUser();
  const id = str(formData.get("id"));
  const { error } = await supabase.from("workout_logs").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/workouts");
  revalidatePath("/");
  return {};
}
