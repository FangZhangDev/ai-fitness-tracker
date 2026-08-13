// ============================================================================
// 数据库 TypeScript 类型定义
// 与 supabase/migrations/0001_init_schema.sql 一一对应
// 注意: 数据行类型用 `type` 别名而非 `interface`, 否则不满足 Supabase 的
//       Record<string, unknown> 约束, 会导致表类型推断为 never。
// ============================================================================

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export type ActivityLevel =
  | "sedentary"
  | "light"
  | "moderate"
  | "active"
  | "very_active";

// ---- profiles ----
export type Profile = {
  id: string; // = auth.users.id
  height_cm: number | null;
  current_weight_kg: number | null;
  target_weight_kg: number | null;
  goal: string | null;
  activity_level: ActivityLevel | null;
  created_at: string;
  updated_at: string;
};

export type ProfileUpdate = Partial<Omit<Profile, "id" | "created_at" | "updated_at">>;

// ---- daily_metrics ----
export type DailyMetric = {
  id: string;
  user_id: string;
  date: string; // ISO date yyyy-mm-dd
  weight_kg: number | null;
  body_fat_pct: number | null;
  waist_cm: number | null;
  sleep_hours: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type DailyMetricInsert = Omit<DailyMetric, "id" | "created_at" | "updated_at">;
export type DailyMetricUpdate = Partial<Omit<DailyMetric, "id" | "user_id" | "created_at" | "updated_at">>;

// ---- meal_logs ----
export type MealLog = {
  id: string;
  user_id: string;
  date: string;
  meal_type: MealType;
  description: string;
  // AI 分析结果
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  ai_raw: Json | null;
  analyzed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MealLogInsert = Omit<
  MealLog,
  "id" | "created_at" | "updated_at" | "ai_raw" | "analyzed_at" | "calories" | "protein_g" | "carbs_g" | "fat_g"
> & {
  calories?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  ai_raw?: Json | null;
  analyzed_at?: string | null;
};
export type MealLogUpdate = Partial<Omit<MealLog, "id" | "user_id" | "created_at" | "updated_at">>;

// ---- workout_logs ----
export type WorkoutLog = {
  id: string;
  user_id: string;
  date: string;
  workout_day: string | null;
  exercise: string;
  weight_kg: number | null;
  sets: number | null;
  reps: number | null;
  rir: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkoutLogInsert = Omit<WorkoutLog, "id" | "created_at" | "updated_at">;
export type WorkoutLogUpdate = Partial<Omit<WorkoutLog, "id" | "user_id" | "created_at" | "updated_at">>;

// ---- ai_analyses ----
export type AiAnalysis = {
  id: string;
  user_id: string;
  period_start: string;
  period_end: string;
  report: AiAnalysisReport;
  created_at: string;
};

// AI 综合分析报告结构 (由 AI 生成, 见 lib/ai/analyze.ts)
export type AiAnalysisReport = {
  period: { start: string; end: string; days: number };
  summary: string; // 一句话总结
  metrics: {
    weight_change_kg: number | null; // 体重变化
    waist_change_cm: number | null; // 腰围变化
    avg_daily_calories: number | null;
    avg_daily_protein_g: number | null;
    workout_sessions: number;
  };
  assessments: {
    muscle_gain_rate: { status: "ok" | "slow" | "fast" | "unknown"; detail: string };
    calorie_adjustment: { status: "increase" | "decrease" | "maintain" | "unknown"; detail: string };
    training_adjustment: { status: "adjust" | "maintain" | "unknown"; detail: string };
    recovery: { status: "ok" | "poor" | "unknown"; detail: string };
  };
  recommendations: string[]; // 具体建议列表
  raw_context?: Json; // 喂给 AI 的上下文摘要 (可选)
};

// ---- 视图类型 ----
export type ExercisePR = {
  user_id: string;
  exercise: string;
  max_weight_kg: number | null;
  estimated_1rm_kg: number | null;
  last_achieved_date: string;
};

export type DailyNutrition = {
  user_id: string;
  date: string;
  total_calories: number;
  total_protein_g: number;
  total_carbs_g: number;
  total_fat_g: number;
  unanalyzed_count: number;
};

// ---- Supabase Database schema 映射 (用于 createClient 泛型) ----
export type Database = {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Partial<Profile>; Update: ProfileUpdate; Relationships: [] };
      daily_metrics: { Row: DailyMetric; Insert: DailyMetricInsert; Update: DailyMetricUpdate; Relationships: [] };
      meal_logs: { Row: MealLog; Insert: MealLogInsert; Update: MealLogUpdate; Relationships: [] };
      workout_logs: { Row: WorkoutLog; Insert: WorkoutLogInsert; Update: WorkoutLogUpdate; Relationships: [] };
      ai_analyses: { Row: AiAnalysis; Insert: Omit<AiAnalysis, "id" | "created_at">; Update: Partial<AiAnalysis>; Relationships: [] };
    };
    Views: {
      v_exercise_pr: { Row: ExercisePR; Relationships: [] };
      v_daily_nutrition: { Row: DailyNutrition; Relationships: [] };
    };
    Functions: Record<string, never>;
    Enums: { meal_type: MealType; activity_level: ActivityLevel };
    CompositeTypes: Record<string, never>;
  };
};
