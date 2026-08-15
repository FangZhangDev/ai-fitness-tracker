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
/** 记录来源: 网页手动录入 / 手表上打勾。由 0007 迁移引入, 历史数据一律为 web */
export type LogSource = "web" | "watch";

/**
 * 一行 = 某天某动作的第 set_index 组 (0008 起)。
 * 原来一行代表整个动作、组数存在 sets 列里, 掉重量那组根本写不进去。
 */
export type WorkoutLog = {
  id: string;
  user_id: string;
  date: string;
  workout_day: string | null;
  exercise: string;
  /** 同一天同一动作内的组号, 1 起 */
  set_index: number;
  weight_kg: number | null;
  reps: number | null;
  rir: number | null;
  /** 热身组: 不计入容量、PR 与平均 RIR */
  is_warmup: boolean;
  /** 这一组做完之后休息了多久 (手表计时器写入) */
  rest_sec: number | null;
  /** 这一组做完的时刻 (手表写入; 网页录入的历史数据为空) */
  performed_at: string | null;
  notes: string | null;
  source: LogSource;
  created_at: string;
  updated_at: string;
};

// source 由数据库默认值 'web' 兜底, 网页写入不必显式传;
// is_warmup 同理 (默认 false), set_index 默认 1
export type WorkoutLogInsert = Omit<
  WorkoutLog,
  "id" | "created_at" | "updated_at" | "source" | "is_warmup" | "set_index"
> & {
  source?: LogSource;
  is_warmup?: boolean;
  set_index?: number;
};
export type WorkoutLogUpdate = Partial<Omit<WorkoutLog, "id" | "user_id" | "created_at" | "updated_at">>;

/**
 * 一次训练里某个动作的汇总 (视图 v_exercise_sessions)。
 * 按组存下来之后, 直接画原始行会把一天的 4 组画成 4 个重叠的点,
 * 喂给 AI 的行数也要翻好几倍, 所以聚合这一层是必要的。
 */
export type ExerciseSession = {
  user_id: string;
  date: string;
  exercise: string;
  workout_day: string | null;
  /** 工作组数 (不含热身) */
  sets: number;
  warmup_sets: number;
  top_weight_kg: number | null;
  /** 这次训练最好的一组折算的 1RM (Epley) */
  best_1rm_kg: number | null;
  total_reps: number | null;
  volume_kg: number | null;
  avg_rir: number | null;
  rest_total_sec: number | null;
  /** 最后一个工作组比当天最重的那组轻 —— 力竭减重的信号 */
  dropped: boolean;
};

// ---- meal_templates (见 supabase/migrations/0007) ----
/**
 * 「常吃套餐」: 日常饮食其实是几个固定组合轮着来, 存下来一点即填。
 * 只存描述文本, 不存营养值 —— 营养由 AI 在提交时按当天实际描述重新估算。
 */
export type MealTemplate = {
  id: string;
  user_id: string;
  name: string;
  description: string;
  meal_type: MealType;
  sort_order: number;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MealTemplateInsert = Omit<
  MealTemplate,
  "id" | "created_at" | "updated_at" | "sort_order" | "use_count" | "last_used_at"
> & {
  sort_order?: number;
  use_count?: number;
  last_used_at?: string | null;
};

export type MealTemplateUpdate = Partial<
  Omit<MealTemplate, "id" | "user_id" | "created_at" | "updated_at">
>;

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
  /** 人看的自由文本, 如 "2-3分钟" */
  rest: string | null;
  /** 手表倒计时用的秒数; 空则手表按 90 秒兜底 (0008 起) */
  rest_sec: number | null;
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

// ---- 手表配对 (0004) ----
export type WatchDeviceRow = {
  id: string;
  user_id: string;
  token_hash: string; // sha256(token), 明文 token 只在兑换时返回一次
  name: string;
  created_at: string;
  last_seen_at: string | null;
};

export type WatchPairingCodeRow = {
  code: string;
  user_id: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
};

/** watch_get_today 的返回结构 (手表端消费) */
export type WatchTodayExercise = {
  id: string;
  exercise: string;
  target_sets: number | null;
  rep_min: number | null;
  rep_max: number | null;
  rir_min: number | null;
  rir_max: number | null;
  rest: string | null;
  cues: string | null;
  equipment: string | null;
  // 历史最大重量与最好 1RM (0005 迁移新增)，手表用 max_weight_kg 作为预填默认值
  max_weight_kg: number | null;
  best_1rm_kg: number | null;
  last_weight_kg: number | null;
  last_sets: number | null;
  last_reps: number | null;
  last_rir: number | null;
  done: boolean;
  done_weight_kg: number | null;
  done_sets: number | null;
  done_reps: number | null;
  done_rir: number | null;
};

export type WatchTodayPayload = {
  date: string;
  weekday: number;
  title: string | null;
  exercises: WatchTodayExercise[];
  done_count: number;
  total_count: number;
};

// ---- Supabase Database schema 映射 (用于 createClient 泛型) ----
export type Database = {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Partial<Profile>; Update: ProfileUpdate; Relationships: [] };
      daily_metrics: { Row: DailyMetric; Insert: DailyMetricInsert; Update: DailyMetricUpdate; Relationships: [] };
      meal_logs: { Row: MealLog; Insert: MealLogInsert; Update: MealLogUpdate; Relationships: [] };
      workout_logs: { Row: WorkoutLog; Insert: WorkoutLogInsert; Update: WorkoutLogUpdate; Relationships: [] };
      meal_templates: { Row: MealTemplate; Insert: MealTemplateInsert; Update: MealTemplateUpdate; Relationships: [] };
      ai_analyses: { Row: AiAnalysis; Insert: Omit<AiAnalysis, "id" | "created_at">; Update: Partial<AiAnalysis>; Relationships: [] };
      workout_plans: { Row: WorkoutPlan; Insert: Omit<WorkoutPlan, "id" | "created_at" | "updated_at">; Update: Partial<WorkoutPlan>; Relationships: [] };
      plan_days: { Row: PlanDay; Insert: Omit<PlanDay, "id" | "created_at" | "updated_at">; Update: Partial<PlanDay>; Relationships: [] };
      plan_exercises: { Row: PlanExercise; Insert: Omit<PlanExercise, "id" | "created_at" | "updated_at">; Update: PlanExerciseUpdate; Relationships: [] };
      watch_devices: { Row: WatchDeviceRow; Insert: Omit<WatchDeviceRow, "id" | "created_at">; Update: Partial<WatchDeviceRow>; Relationships: [] };
      watch_pairing_codes: { Row: WatchPairingCodeRow; Insert: WatchPairingCodeRow; Update: Partial<WatchPairingCodeRow>; Relationships: [] };
    };
    Views: {
      v_exercise_pr: { Row: ExercisePR; Relationships: [] };
      v_daily_nutrition: { Row: DailyNutrition; Relationships: [] };
      v_exercise_last: { Row: ExerciseLast; Relationships: [] };
      v_exercise_sessions: { Row: ExerciseSession; Relationships: [] };
    };
    Functions: {
      // 原子地切换启用中的计划, 见 0002 迁移
      activate_plan: { Args: { p_plan_id: string }; Returns: undefined };
      // 常吃套餐用过一次: 计数 +1 并记时间, 见 0007 迁移
      touch_meal_template: { Args: { p_id: string }; Returns: undefined };
      // 手表配对与数据接口, 见 0004 迁移
      watch_create_pairing_code: {
        Args: Record<string, never>;
        Returns: { code: string; expires_at: string }[];
      };
      watch_redeem_pairing_code: { Args: { p_code: string }; Returns: string };
      watch_get_today: {
        Args: { p_token: string; p_weekday?: number | null };
        Returns: WatchTodayPayload;
      };
      watch_submit_logs: {
        Args: { p_token: string; p_logs: Json };
        Returns: { ok: boolean; written: number };
      };
    };
    Enums: { meal_type: MealType; activity_level: ActivityLevel };
    CompositeTypes: Record<string, never>;
  };
};
