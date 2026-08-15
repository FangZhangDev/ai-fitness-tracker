// AI 综合分析: 汇总近 N 天数据 → 结构化增肌分析报告
import { chatJSON } from "@/lib/ai/client";
import type { AiAnalysisReport } from "@/lib/types/database";
import { WEIGHT_CONVENTION, WEIGHT_CAVEATS } from "@/lib/constants/weight-convention";

export interface AnalysisContext {
  period_start: string;
  period_end: string;
  days: number;
  profile: {
    height_cm: number | null;
    current_weight_kg: number | null;
    target_weight_kg: number | null;
    goal: string | null;
  } | null;
  // 每日身体指标 (按日期升序)
  metrics: Array<{
    date: string;
    weight_kg: number | null;
    body_fat_pct: number | null;
    waist_cm: number | null;
    sleep_hours: number | null;
  }>;
  // 每日营养汇总
  nutrition: Array<{
    date: string;
    total_calories: number;
    total_protein_g: number;
    total_carbs_g: number;
    total_fat_g: number;
  }>;
  // 训练记录: 一次训练一个动作一条 (视图 v_exercise_sessions)。
  // 数据库里是一行一组, 但 90 天的原始组能有上千行 —— 聚合之后 token 不涨,
  // 而且 volume/avg_rir/dropped 这些恰恰是模型判断训练质量要看的东西。
  workouts: Array<{
    date: string;
    exercise: string;
    sets: number;
    top_weight_kg: number | null;
    total_reps: number | null;
    volume_kg: number | null;
    avg_rir: number | null;
    dropped: boolean;
  }>;
}

/**
 * 调用 AI 生成结构化分析报告。
 * 输出严格符合 AiAnalysisReport 结构。
 */
export async function analyzePeriod(ctx: AnalysisContext): Promise<AiAnalysisReport> {
  const system = `你是一名专业的增肌/体能教练。根据用户近期的身体指标、饮食与训练数据, 给出结构化分析。
返回 JSON, 严格遵循如下结构:
{
  "period": { "start": string, "end": string, "days": number },
  "summary": string,                    // 一句话总结本周情况
  "metrics": {
    "weight_change_kg": number | null,  // 期末-期初体重差
    "waist_change_cm": number | null,
    "avg_daily_calories": number | null,
    "avg_daily_protein_g": number | null,
    "workout_sessions": number          // 训练天数
  },
  "assessments": {
    "muscle_gain_rate": { "status": "ok"|"slow"|"fast"|"unknown", "detail": string },
    "calorie_adjustment": { "status": "increase"|"decrease"|"maintain"|"unknown", "detail": string },
    "training_adjustment": { "status": "adjust"|"maintain"|"unknown", "detail": string },
    "recovery": { "status": "ok"|"poor"|"unknown", "detail": string }
  },
  "recommendations": [string]           // 3-5 条具体可执行建议
}
要点:
- 增肌期理想增重约 0.25-0.5kg/周; 过快易囤脂, 过慢则热量不足
- 蛋白摄入建议 1.6-2.2g/kg 体重
- 综合体重/腰围/蛋白/训练量/RIR 判断
- 训练量看 volume_kg 的走势; dropped=true 表示那次最后一组掉了重量, 偶尔出现正常, 连续出现多半是恢复不足
- 建议要具体、可执行, 不要空话

${WEIGHT_CONVENTION}

${WEIGHT_CAVEATS}`;

  const user = `用户档案: ${JSON.stringify(ctx.profile || {})}
分析区间: ${ctx.period_start} ~ ${ctx.period_end} (共 ${ctx.days} 天)

每日身体指标 (升序):
${JSON.stringify(ctx.metrics)}

每日营养汇总:
${JSON.stringify(ctx.nutrition)}

训练记录 (一次训练一个动作一条; sets=工作组数, volume_kg=容量, dropped=最后一组比最重那组轻):
${JSON.stringify(ctx.workouts)}`;

  const json = (await chatJSON(system, user)) as AiAnalysisReport;

  // 兜底: 保证 period 字段
  json.period = {
    start: ctx.period_start,
    end: ctx.period_end,
    days: ctx.days,
  };
  return json;
}
