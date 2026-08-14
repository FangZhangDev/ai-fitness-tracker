"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/utils/server";
import { estimateNutrition } from "@/lib/ai/nutrition";
import type { MealType, Json } from "@/lib/types/database";

export type ActionResult = { error?: string };

function str(v: FormDataEntryValue | null): string {
  return (v?.toString() ?? "").trim() || "";
}

// 必须与 lib/types/database.ts 的 MealType 及 0003 迁移的 CHECK 约束保持一致。
// all_day 是表单默认值, 漏掉它会导致默认提交直接被判「餐次无效」。
const MEAL_TYPES: MealType[] = ["all_day", "breakfast", "lunch", "dinner", "snack"];

/**
 * 新增饮食记录: 用户只填自然语言描述, 自动调 AI 估算营养并回填。
 */
export async function createMeal(prev: unknown, formData: FormData): Promise<ActionResult> {
  const { supabase, userId } = await getCurrentUser();
  const date = str(formData.get("date"));
  const mealType = str(formData.get("meal_type")) as MealType;
  const description = str(formData.get("description"));
  if (!date) return { error: "请选择日期" };
  if (!description) return { error: "请输入食物描述" };
  if (!MEAL_TYPES.includes(mealType)) return { error: "餐次无效" };

  // 调 AI 估算营养 (失败不阻断, 仅记录描述)
  let nutrition: { calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null } = {
    calories: null,
    protein_g: null,
    carbs_g: null,
    fat_g: null,
  };
  let aiRaw: Json | null = null;
  let analyzedAt: string | null = null;
  try {
    const est = await estimateNutrition(description, mealType);
    nutrition = {
      calories: est.calories,
      protein_g: est.protein_g,
      carbs_g: est.carbs_g,
      fat_g: est.fat_g,
    };
    aiRaw = est;
    analyzedAt = new Date().toISOString();
  } catch {
    // AI 调用失败, 仍保存描述, 等待后续重新分析
  }

  const { error } = await supabase.from("meal_logs").insert({
    user_id: userId,
    date,
    meal_type: mealType,
    description,
    ...nutrition,
    ai_raw: aiRaw,
    analyzed_at: analyzedAt,
  });
  if (error) return { error: error.message };
  revalidatePath("/meals");
  revalidatePath("/");
  return {};
}

/** 重新分析某条饮食 (重新调 AI 估算营养) */
export async function reanalyzeMeal(formData: FormData): Promise<ActionResult> {
  const { supabase } = await getCurrentUser();
  const id = str(formData.get("id"));
  const description = str(formData.get("description"));
  const mealType = str(formData.get("meal_type")) as MealType;
  if (!description) return { error: "描述为空" };

  try {
    const est = await estimateNutrition(description, mealType);
    const { error } = await supabase
      .from("meal_logs")
      .update({
        calories: est.calories,
        protein_g: est.protein_g,
        carbs_g: est.carbs_g,
        fat_g: est.fat_g,
        ai_raw: est,
        analyzed_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) return { error: error.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "AI 分析失败" };
  }
  revalidatePath("/meals");
  revalidatePath("/");
  return {};
}

export async function updateMeal(prev: unknown, formData: FormData): Promise<ActionResult> {
  const { supabase } = await getCurrentUser();
  const id = str(formData.get("id"));
  const { error } = await supabase
    .from("meal_logs")
    .update({
      date: str(formData.get("date")),
      meal_type: str(formData.get("meal_type")) as MealType,
      description: str(formData.get("description")),
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/meals");
  revalidatePath("/");
  return {};
}

export async function deleteMeal(formData: FormData): Promise<ActionResult> {
  const { supabase } = await getCurrentUser();
  const id = str(formData.get("id"));
  const { error } = await supabase.from("meal_logs").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/meals");
  revalidatePath("/");
  return {};
}
