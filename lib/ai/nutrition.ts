// 饮食营养分析: 自然语言描述 → 估算 calories / protein / carbs / fat
import { chatJSON } from "@/lib/ai/client";
import type { MealType } from "@/lib/types/database";

export type NutritionEstimate = {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

const MEAL_LABEL: Record<MealType, string> = {
  all_day: "全天(一整天所有进食)",
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐",
  snack: "加餐",
};

/**
 * 用 AI 估算一餐的营养成分。
 * 输入: 自然语言描述 (如 "三个鸡蛋, 一个肉包, 一碗豆浆")
 * 输出: 估算的卡路里与三大宏量营养素 (克)
 */
export async function estimateNutrition(
  description: string,
  mealType: MealType,
): Promise<NutritionEstimate> {
  const system = `你是一名营养师。根据用户描述的食物, 估算总卡路里(kcal)与三大宏量营养素(克)。
只返回 JSON, 格式: {"calories": number, "protein_g": number, "carbs_g": number, "fat_g": number}
估算要点:
- 以常见中式饮食份量为基准
- 鸡蛋约 70kcal/个, 蛋白 6g
- 数值四舍五入到整数(卡路里)或一位小数(宏量)
- 若描述模糊, 给出合理中位估算
- 若餐次是「全天」, 说明这是用户一整天吃的所有东西, 描述里可能按早/午/晚
  分段, 也可能只是流水账。请把所有提到的食物累加, 给出【全天总量】,
  不要只算其中一餐`;

  const user = `餐次: ${MEAL_LABEL[mealType]}\n食物描述: ${description}`;

  const json = (await chatJSON(system, user)) as Partial<NutritionEstimate>;

  const clamp = (v: unknown, min: number, max: number) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.min(max, Math.max(min, n));
  };

  return {
    calories: Math.round(clamp(json.calories, 0, 10000)),
    protein_g: clamp(json.protein_g, 0, 1000),
    carbs_g: clamp(json.carbs_g, 0, 1000),
    fat_g: clamp(json.fat_g, 0, 1000),
  };
}
