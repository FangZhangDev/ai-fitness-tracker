// 饮食营养的类型与常量 (不含任何运行时依赖)
//
// 单独成一个文件的原因: 这些类型被客户端组件(components/meals-manager)直接引用,
// 而 nutrition.ts 本体 import 了 lib/ai/client.ts(内含服务端配置读取)。
// 类型放在本体里, 客户端打包时就会把整条服务端链路拖进浏览器包, 构建直接失败。
// 规矩: 客户端要用的类型/常量 -> 放这里; 要跑 AI -> 只能走 server action。
export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack" | "other";

export const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐",
  snack: "加餐",
  other: "其它",
};

/** 逐项明细里的一条食物 */
export type NutritionItem = {
  name: string;
  /** 归属餐次; 描述里没写清就是 other(如单独列在最后的蛋白粉、补剂) */
  slot: MealSlot;
  /** AI 假设的份量, 如 "150g (3个)" -- 估得离谱时一眼能看出是份量假设错了 */
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
