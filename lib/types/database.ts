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

/** all_day = 一次记录一整天吃的, 交给 AI 估算全天总量 (默认) */
export type MealType = "all_day" | "breakfast" | "lunch" | "dinner" | "snack";

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

// ---- 训练计划 (见 supabase/migrations/0002_workout_plans.sql) ----

/** 1=周一 ... 7=周日, 与 date-fns 的 ISO weekday 一致 */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const WEEKDAY_LABEL: Record<Weekday, string> = {
  1: "周一",
  2: "周二",
  3: "周三",
  4: "周四",
  5: "周五",
  6: "周六",
  7: "周日",
};

export type WorkoutPlan = {
  id: string;
  user_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type PlanDay = {
  id: string;
  plan_id: string;
  user_id: string;
  weekday: Weekday;
  title: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type PlanExercise = {
  id: string;
  day_id: string;
  user_id: string;
  exercise: string;
  target_sets: number | null;
  rep_min: number | null;
  rep_max: number | null;
  rir_min: number | null;
  rir_max: number | null;
  rest: string | null;
  cues: string | null;
  equipment: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type PlanExerciseUpdate = Partial<
  Omit<PlanExercise, "id" | "user_id" | "day_id" | "created_at" | "updated_at">
>;

/** AI 解析计划文本后的中间结构 (尚未落库, 供用户在前端确认) */
export type ParsedPlan = {
  name: string;
  days: Array<{
    weekday: Weekday;
    title: string;
    exercises: Array<{
      exercise: string;
      target_sets: number | null;
      rep_min: number | null;
      rep_max: number | null;
      rir_min: number | null;
      rir_max: number | null;
      rest: string | null;
      cues: string | null;
      equipment: string | null;
    }>;
  }>;
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

/** 每个动作最近一次记录, 用于从计划快速记录时预填上次重量 */
export type ExerciseLast = {
  user_id: string;
  exercise: string;
  last_date: string;
  last_weight_kg: number | null;
  last_sets: number | null;
  last_reps: number | null;
  last_rir: number | null;
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
      workout_plans: { Row: WorkoutPlan; Insert: Omit<WorkoutPlan, "id" | "created_at" | "updated_at">; Update: Partial<WorkoutPlan>; Relationships: [] };
      plan_days: { Row: PlanDay; Insert: Omit<PlanDay, "id" | "created_at" | "updated_at">; Update: Partial<PlanDay>; Relationships: [] };
      plan_exercises: { Row: PlanExercise; Insert: Omit<PlanExercise, "id" | "created_at" | "updated_at">; Update: PlanExerciseUpdate; Relationships: [] };
    };
    Views: {
      v_exercise_pr: { Row: ExercisePR; Relationships: [] };
      v_daily_nutrition: { Row: DailyNutrition; Relationships: [] };
      v_exercise_last: { Row: ExerciseLast; Relationships: [] };
    };
    Functions: {
      // 原子地切换启用中的计划, 见 0002 迁移
      activate_plan: { Args: { p_plan_id: string }; Returns: undefined };
    };
    Enums: { meal_type: MealType; activity_level: ActivityLevel };
    CompositeTypes: Record<string, never>;
  };
};
