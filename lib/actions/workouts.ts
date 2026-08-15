"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/utils/server";
import type { WorkoutLogInsert } from "@/lib/types/database";

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

/**
 * 手动添加训练。
 *
 * 表单上仍然保留「组数」一栏 —— 补记昨天的训练时, 逐组敲四遍相同数字很烦。
 * 这里按组数展开成 N 行, 组号接在该动作当天已有的组之后 (手表可能已经记过几组)。
 * 想让某一组跟别的组不一样, 存完在列表里单独改那一组。
 */
export async function createWorkout(prev: unknown, formData: FormData): Promise<ActionResult> {
  const { supabase, userId } = await getCurrentUser();
  const date = str(formData.get("date"));
  const exercise = str(formData.get("exercise"));
  if (!date) return { error: "请选择日期" };
  if (!exercise) return { error: "请输入动作名称" };

  const sets = Math.min(Math.max(int(formData.get("sets")) ?? 1, 1), 20);
  const isWarmup = formData.get("is_warmup") !== null;

  // 接着已有的组号往下排, 免得撞 unique(user_id, date, exercise, set_index)
  const { data: last } = await supabase
    .from("workout_logs")
    .select("set_index")
    .eq("date", date)
    .eq("exercise", exercise)
    .order("set_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  const from = (last?.set_index ?? 0) + 1;

  const notes = str(formData.get("notes")) || null;
  const rows: WorkoutLogInsert[] = [];
  for (let i = 0; i < sets; i++) {
    rows.push({
      user_id: userId,
      date,
      workout_day: str(formData.get("workout_day")) || null,
      exercise,
      set_index: from + i,
      weight_kg: num(formData.get("weight_kg")),
      reps: int(formData.get("reps")),
      rir: int(formData.get("rir")),
      is_warmup: isWarmup,
      rest_sec: null,
      performed_at: null,
      // 备注只挂在第一组上, 同一句话抄 N 遍纯属噪音
      notes: i === 0 ? notes : null,
    });
  }

  const { error } = await supabase.from("workout_logs").insert(rows);
  if (error) return { error: error.message };
  revalidatePath("/workouts");
  revalidatePath("/");
  return {};
}

/** 编辑单独一组 */
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
      reps: int(formData.get("reps")),
      rir: int(formData.get("rir")),
      is_warmup: formData.get("is_warmup") !== null,
      notes: str(formData.get("notes")) || null,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/workouts");
  revalidatePath("/");
  return {};
}

/** 删除单独一组。组号故意不重排 —— 重排会让「第 3 组」在历史里指向别的数据 */
export async function deleteWorkout(formData: FormData): Promise<ActionResult> {
  const { supabase } = await getCurrentUser();
  const id = str(formData.get("id"));
  const { error } = await supabase.from("workout_logs").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/workouts");
  revalidatePath("/");
  return {};
}

/** 删掉某天某个动作的全部组 —— 按组之后一组组点删太费事 */
export async function deleteWorkoutSession(formData: FormData): Promise<ActionResult> {
  const { supabase, userId } = await getCurrentUser();
  const date = str(formData.get("date"));
  const exercise = str(formData.get("exercise"));
  if (!date || !exercise) return { error: "缺少日期或动作" };
  const { error } = await supabase
    .from("workout_logs")
    .delete()
    .eq("user_id", userId)
    .eq("date", date)
    .eq("exercise", exercise);
  if (error) return { error: error.message };
  revalidatePath("/workouts");
  revalidatePath("/");
  return {};
}
