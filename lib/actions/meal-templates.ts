"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/utils/server";
import type { MealType } from "@/lib/types/database";

export type ActionResult = { error?: string };

function str(v: FormDataEntryValue | null): string {
  return (v?.toString() ?? "").trim();
}

/** 一个人能有多少种「常吃」? 给个上限, 免得列表长到没法用 */
const MAX_TEMPLATES = 20;

/**
 * 存一个常吃套餐。
 * 名字留空时用描述的前 12 个字兜底 —— 不该为了起名把人卡住。
 */
export async function createMealTemplate(
  prev: unknown,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, userId } = await getCurrentUser();
  const description = str(formData.get("description"));
  if (!description) return { error: "描述为空，先在输入框里写点东西" };

  const name = str(formData.get("name")) || description.slice(0, 12);
  const mealType = (str(formData.get("meal_type")) || "all_day") as MealType;

  const { count } = await supabase
    .from("meal_templates")
    .select("id", { count: "exact", head: true });
  if ((count ?? 0) >= MAX_TEMPLATES) {
    return { error: `最多存 ${MAX_TEMPLATES} 个，先删掉几个不常用的` };
  }

  const { error } = await supabase.from("meal_templates").insert({
    user_id: userId,
    name,
    description,
    meal_type: mealType,
  });
  if (error) return { error: error.message };
  revalidatePath("/meals");
  return {};
}

export async function updateMealTemplate(formData: FormData): Promise<ActionResult> {
  const { supabase } = await getCurrentUser();
  const id = str(formData.get("id"));
  const name = str(formData.get("name"));
  const description = str(formData.get("description"));
  if (!id) return { error: "缺少 id" };
  if (!name) return { error: "名字不能为空" };
  if (!description) return { error: "描述不能为空" };

  const { error } = await supabase
    .from("meal_templates")
    .update({ name, description })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/meals");
  return {};
}

export async function deleteMealTemplate(formData: FormData): Promise<ActionResult> {
  const { supabase } = await getCurrentUser();
  const id = str(formData.get("id"));
  const { error } = await supabase.from("meal_templates").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/meals");
  return {};
}

/**
 * 用了一次: 计数 +1 并记时间, 常用的会排到前面。
 * 纯统计, 失败了也不该打断用户填表, 所以不返回错误。
 */
export async function touchMealTemplate(id: string): Promise<void> {
  if (!id) return;
  const { supabase } = await getCurrentUser();
  await supabase.rpc("touch_meal_template", { p_id: id });
}
