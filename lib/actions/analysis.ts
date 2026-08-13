"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/utils/server";
import { analyzePeriod, type AnalysisContext } from "@/lib/ai/analyze";
import { daysAgoISO } from "@/lib/utils/date";
import type { AiAnalysisReport } from "@/lib/types/database";

export type AnalysisResult = { error?: string; report?: AiAnalysisReport };

/** 分析最近 N 天 (默认 7) */
export async function runAnalysis(prev: unknown, formData: FormData): Promise<AnalysisResult> {
  const { supabase, userId } = await getCurrentUser();
  const days = Math.max(1, Math.min(90, Number(formData.get("days")) || 7));
  const end = new Date();
  const startStr = daysAgoISO(days - 1);
  const endStr = end.toISOString().slice(0, 10);

  // 并行拉取数据
  const [profile, metrics, nutrition, workouts] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).single(),
    supabase
      .from("daily_metrics")
      .select("date,weight_kg,body_fat_pct,waist_cm,sleep_hours")
      .gte("date", startStr)
      .lte("date", endStr)
      .order("date", { ascending: true }),
    supabase
      .from("v_daily_nutrition")
      .select("date,total_calories,total_protein_g,total_carbs_g,total_fat_g")
      .gte("date", startStr)
      .lte("date", endStr)
      .order("date", { ascending: true }),
    supabase
      .from("workout_logs")
      .select("date,exercise,weight_kg,sets,reps,rir")
      .gte("date", startStr)
      .lte("date", endStr)
      .order("date", { ascending: true }),
  ]);

  const ctx: AnalysisContext = {
    period_start: startStr,
    period_end: endStr,
    days,
    profile: profile.data || null,
    metrics: metrics.data || [],
    nutrition: nutrition.data || [],
    workouts: workouts.data || [],
  };

  let report: AiAnalysisReport;
  try {
    report = await analyzePeriod(ctx);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "AI 分析失败" };
  }

  // 留档
  await supabase.from("ai_analyses").insert({
    user_id: userId,
    period_start: startStr,
    period_end: endStr,
    report,
  });

  revalidatePath("/analysis");
  return { report };
}
