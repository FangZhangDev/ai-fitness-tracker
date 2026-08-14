// 饮食营养分析: 自然语言描述 → 估算 calories / protein / carbs / fat
import { chatJSON } from "@/lib/ai/client";
import type { MealType } from "@/lib/types/database";

/** 餐次槽位: 全天描述里通常写着「早饭：… 午饭：…」, 据此把每项食物归位 */
export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack" | "other";

export const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐",
  snack: "加餐",
  other: "其它",
};

const SLOTS = Object.keys(SLOT_LABEL) as MealSlot[];

/** 逐项明细里的一条食物 */
export type NutritionItem = {
  name: string;
  /** 归属餐次; 描述里没写清就是 other(如单独列在最后的蛋白粉、补剂) */
  slot: MealSlot;
  /** AI 假设的份量, 如 "150g (3个)" —— 估得离谱时一眼能看出是份量假设错了 */
  grams: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

export type NutritionEstimate = {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  items: NutritionItem[];
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
 * 输出: 逐项明细 + 合计
 *
 * ── 为什么一定要逐项 ────────────────────────────────────────────────
 * 早先只要一个合计数, 实测系统性偏低约 30%。同一段全天描述:
 *     只要合计   -> 2050 / 2100 / 2140 kcal (三次三个数)
 *     强制逐项   -> 2639 kcal, 且每一项单看都合理
 * 原因不是模型不知道猪脚饭多少卡, 而是直接输出聚合数字时它给的是「整体印象」,
 * 会往「一天大概两千卡」这个先验上回归, 根本没走「逐项赋值再相加」这条路。
 * 逼它先列明细, 加法才真的发生。
 *
 * 合计以明细之和为准, 不用模型自报的 total —— 万一两者不一致, 相加的那个才可信。
 */
export async function estimateNutrition(
  description: string,
  mealType: MealType,
): Promise<NutritionEstimate> {
  const system = `你是一名营养师。根据用户描述的食物, 估算热量(kcal)与三大宏量营养素(克)。

必须先把描述里提到的【每一项】食物单独列出来并各自估值, 再给出合计。
只返回 JSON, 格式:
{"items":[{"name":string,"slot":"breakfast"|"lunch"|"dinner"|"snack"|"other",
           "grams":string,"calories":number,"protein_g":number,"carbs_g":number,"fat_g":number}],
 "calories":number,"protein_g":number,"carbs_g":number,"fat_g":number}

估算要点:
- slot 按描述里的分段归位: 「早饭/早餐」->breakfast, 「午饭/中午」->lunch,
  「晚饭/晚餐」->dinner, 「加餐/训练后/夜宵/零食」->snack;
  描述里没说清属于哪一餐的(如单独列在最后的蛋白粉、补剂)填 other
- 以常见中式饮食份量为基准; grams 写出你假设的份量(如 "400g (1份)")
- 不要漏项, 也不要合并成「早餐」这种笼统条目; 描述里出现几样就列几样
- 外卖/餐馆菜(如猪脚饭、鸡腿饭)通常用油多、分量大, 按实际餐馆份量估, 不要按家常清淡份量估
- 鸡蛋约 70kcal/个, 蛋白 6g
- 补剂按实际营养计: 肌酸、维生素、水、黑咖啡、无糖茶一律 0 kcal / 0 宏量;
  蛋白粉按蛋白含量折算(常见乳清约每 33g 含 24g 蛋白, 约 120kcal), 不要把总重当蛋白量
- 数值四舍五入到整数(卡路里)或一位小数(宏量)
- 若餐次是「全天」, 说明这是用户一整天吃的所有东西, 描述里可能按早/午/晚
  分段, 也可能只是流水账。请把所有提到的食物累加, 给出【全天总量】,
  不要只算其中一餐`;

  const user = `餐次: ${MEAL_LABEL[mealType]}\n食物描述: ${description}`;

  // temperature 0: 同一段描述应当给同一个结果, 否则点两次「重分析」得两个数
  //
  // ?? {} 不是多余的: "null" 是合法 JSON, JSON.parse 后就是 null,
  // 直接读 json.items 会抛 TypeError。模型偶尔真会吐这个。
  const raw = await chatJSON(system, user, 0);
  const json = (raw && typeof raw === "object" ? raw : {}) as Partial<NutritionEstimate>;

  const num = (v: unknown, min: number, max: number) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.min(max, Math.max(min, n));
  };

  const items: NutritionItem[] = Array.isArray(json.items)
    ? json.items.slice(0, 60).map((it) => ({
        name: String(it?.name ?? "").slice(0, 40) || "未命名",
        slot: (SLOTS as string[]).includes(String(it?.slot)) ? (it.slot as MealSlot) : "other",
        grams: String(it?.grams ?? "").slice(0, 24),
        calories: Math.round(num(it?.calories, 0, 5000)),
        protein_g: num(it?.protein_g, 0, 500),
        carbs_g: num(it?.carbs_g, 0, 500),
        fat_g: num(it?.fat_g, 0, 500),
      }))
    : [];

  // 合计以明细之和为准; 模型没给明细时(不该发生)才回落到它自报的合计
  const sum = items.reduce(
    (a, it) => ({
      calories: a.calories + it.calories,
      protein_g: a.protein_g + it.protein_g,
      carbs_g: a.carbs_g + it.carbs_g,
      fat_g: a.fat_g + it.fat_g,
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );
  const total = items.length ? sum : json;

  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    calories: Math.round(num(total.calories, 0, 10000)),
    protein_g: round1(num(total.protein_g, 0, 1000)),
    carbs_g: round1(num(total.carbs_g, 0, 1000)),
    fat_g: round1(num(total.fat_g, 0, 1000)),
    items,
  };
}
