// ============================================================================
// AI 教练的工具集
//
// 工具就是 lib/actions/ 里那些 server action 的「给模型用」的版本 —— 业务规则
// 一致, 但有三处刻意的不同:
//
//   1. 收 JSON 而不是 FormData。模型吐的是对象, 中间再转一道 FormData 只是
//      为了复用而复用, 反而把「哪些字段可空」这件事藏起来了。
//   2. 每一次写库都往 ctx.mutations 里记一条行级快照, 供整轮撤销
//      (见 supabase/migrations/0010)。
//   3. 加动作、加训练日都是**复数**的。Vercel Hobby 给整个请求 60 秒,
//      「周六加 4 个动作」若拆成 4 次工具调用就是 4 个来回, 批量后 2 轮就完事。
//
// 第一期的写权限只覆盖【当前启用的那套计划】。所有拿 day_id / exercise_id
// 的写操作都先过 assertActiveDay / assertActiveExercise —— RLS 只保证「是你的行」,
// 保证不了「是你正在用的那套计划的行」, 这层得自己把。
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { Database, PlanDay, PlanExerciseUpdate, Weekday } from "@/lib/types/database";
import { WEEKDAY_LABEL } from "@/lib/types/database";
import { todayISO, daysAgoISO } from "@/lib/utils/date";
import { parseRestSec } from "@/lib/utils/rest";

type DB = SupabaseClient<Database>;

/** 一条行级快照, 轮次结束时批量写入 agent_mutations */
export type MutationRow = {
  table_name: "plan_days" | "plan_exercises" | "workout_plans";
  row_id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

/** 被挂起、等用户点确认的删除请求 */
export type PendingDelete = {
  kind: "plan_exercise" | "plan_day";
  id: string;
  /** 给用户看的一句话, 如 "周三的「绳索下压」" */
  label: string;
  /** 连带影响, 如 "这个训练日下面的 6 个动作会一起删掉" */
  cascade?: string;
};

export type ToolCtx = {
  supabase: DB;
  userId: string;
  /** 是否允许写 (只读模式下写工具压根不注入, 这里是第二道闸) */
  canWrite: boolean;
  mutations: MutationRow[];
  pendingDeletes: PendingDelete[];
};

// ---------------------------------------------------------------------------
// 记账
// ---------------------------------------------------------------------------

function record(
  ctx: ToolCtx,
  table: MutationRow["table_name"],
  rowId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
) {
  ctx.mutations.push({ table_name: table, row_id: rowId, before, after });
}

// ---------------------------------------------------------------------------
// 入参规整 —— 模型给的数只能当「建议值」, 越界、字符串数字、写错字段名都见过
// (lib/ai/plan.ts 的 normalizePlan 踩过同一批坑, 规则保持一致)
// ---------------------------------------------------------------------------

function clampInt(v: unknown, min: number, max: number): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

function text(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s === "undefined" || s === "null" || s === "—" || s === "-") return null;
  return s.slice(0, max);
}

/** 只填了一端时用同值补齐; 顺序颠倒时交换 */
function orderPair(a: number | null, b: number | null): [number | null, number | null] {
  if (a === null && b === null) return [null, null];
  if (a === null) return [b, b];
  if (b === null) return [a, a];
  return a <= b ? [a, b] : [b, a];
}

type ExerciseInput = {
  exercise: string;
  target_sets: number | null;
  rep_min: number | null;
  rep_max: number | null;
  rir_min: number | null;
  rir_max: number | null;
  rest_sec: number | null;
  cues: string | null;
  equipment: string | null;
};

/** 模型给的一个动作 → 可直接落库的行; 动作名为空返回 null (整条丢弃) */
function normalizeExercise(raw: unknown): ExerciseInput | null {
  const e = (raw ?? {}) as Record<string, unknown>;
  const exercise = text(e.exercise, 100);
  if (!exercise) return null;
  const [rep_min, rep_max] = orderPair(clampInt(e.rep_min, 0, 100), clampInt(e.rep_max, 0, 100));
  const [rir_min, rir_max] = orderPair(clampInt(e.rir_min, 0, 10), clampInt(e.rir_max, 0, 10));
  // rest_sec 声明是数字, 但模型常回 "120" 或 "2-3分钟"; 与计划解析用同一个解析器
  const rest =
    typeof e.rest_sec === "number"
      ? clampInt(e.rest_sec, 0, 3600)
      : parseRestSec(text(e.rest_sec) ?? text(e.rest));
  return {
    exercise,
    target_sets: clampInt(e.target_sets, 0, 20),
    rep_min,
    rep_max,
    rir_min,
    rir_max,
    rest_sec: rest,
    cues: text(e.cues, 500),
    equipment: text(e.equipment, 100),
  };
}

// ---------------------------------------------------------------------------
// 权限边界: 只能动当前启用的那套计划
// ---------------------------------------------------------------------------

async function activePlan(ctx: ToolCtx) {
  const { data } = await ctx.supabase
    .from("workout_plans")
    .select("id,name")
    .eq("is_active", true)
    .maybeSingle();
  return data;
}

/** 校验 day 属于当前启用计划; 不通过时返回给模型看的错误文案 */
async function assertActiveDay(ctx: ToolCtx, dayId: string) {
  const { data } = await ctx.supabase
    .from("plan_days")
    .select("id,plan_id,weekday,title,sort_order,workout_plans!inner(is_active)")
    .eq("id", dayId)
    .maybeSingle();
  if (!data) return { error: "找不到这个训练日, 请先调用 get_plan 拿到正确的 day_id" };
  const plan = data.workout_plans as unknown as { is_active: boolean } | null;
  if (!plan?.is_active) {
    return { error: "这个训练日不属于当前启用的计划。第一期只允许修改启用中的计划" };
  }
  return { day: data };
}

async function assertActiveExercise(ctx: ToolCtx, exId: string) {
  const { data } = await ctx.supabase
    .from("plan_exercises")
    .select("*, plan_days!inner(id,weekday,title,plan_id,workout_plans!inner(is_active))")
    .eq("id", exId)
    .maybeSingle();
  if (!data) return { error: "找不到这个动作, 请先调用 get_plan 拿到正确的 exercise_id" };
  const day = data.plan_days as unknown as {
    weekday: number;
    title: string;
    workout_plans: { is_active: boolean };
  };
  if (!day?.workout_plans?.is_active) {
    return { error: "这个动作不属于当前启用的计划。第一期只允许修改启用中的计划" };
  }
  return { row: data, day };
}

/** 落库前把关联字段剥掉 —— 上面两个查询用 !inner 带出了嵌套对象, 不能写回表里 */
function bareRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "plan_days" || k === "workout_plans") continue;
    out[k] = v;
  }
  return out;
}

// ============================================================================
// 工具定义 (发给模型的 schema)
// ============================================================================

const EXERCISE_ITEM = {
  type: "object" as const,
  properties: {
    exercise: { type: "string", description: "动作名称。能对上历史记录里的写法就必须沿用原名" },
    target_sets: { type: ["integer", "null"], description: "工作组数, 一般 2-4" },
    rep_min: { type: ["integer", "null"], description: "次数下限" },
    rep_max: { type: ["integer", "null"], description: "次数上限" },
    rir_min: { type: ["integer", "null"], description: "RIR 下限, 复合动作 2-3, 孤立动作 1-2" },
    rir_max: { type: ["integer", "null"], description: "RIR 上限" },
    rest_sec: { type: ["integer", "null"], description: "组间休息秒数, 复合 120-180, 孤立 60-90" },
    cues: { type: ["string", "null"], description: "动作要点, 要具体, 不要空话" },
    equipment: { type: ["string", "null"], description: "器材" },
  },
  required: ["exercise"],
};

/** 只读工具: 任何模式下都注入 */
const READ_TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_today",
      description:
        "获取今天的日期、周几, 以及今天按计划该练什么、实际已经记录了什么。任何跟「今天」有关的问题都先调这个。",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_plan",
      description:
        "读取当前启用的完整训练计划, 含每个训练日的 day_id 与每个动作的 exercise_id。要修改计划就必须先调它拿 id, 不许凭空猜 id。",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "query_workouts",
      description:
        "查实际训练记录 (一次训练一个动作一条汇总)。用来判断训练量走势、某个动作练得怎么样。",
      parameters: {
        type: "object",
        properties: {
          days: { type: "integer", description: "往前查多少天, 1-180, 默认 28" },
          exercise: { type: ["string", "null"], description: "只看某个动作, 传动作名; 不传则全部" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_prs",
      description:
        "查每个动作的历史最大重量与估算 1RM。给动作定重量、或需要知道用户练过哪些动作时调它。",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "query_metrics",
      description: "查每日身体记录: 体重、体脂、腰围、睡眠。",
      parameters: {
        type: "object",
        properties: { days: { type: "integer", description: "往前查多少天, 1-180, 默认 28" } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_nutrition",
      description: "查每日饮食汇总: 热量与三大宏量营养素。",
      parameters: {
        type: "object",
        properties: { days: { type: "integer", description: "往前查多少天, 1-180, 默认 14" } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_trend",
      description:
        "按月聚合的长期趋势: 每月训练天数/组数/容量/最大重量, 以及体重、体脂、腰围、日均热量蛋白质。「最近几个月/一年/两年变化怎么样」「有没有进步」这类跨大时间段的问题用它, 不要用 query_workouts 查大范围明细 (会被 400 行截断)。",
      parameters: {
        type: "object",
        properties: {
          months: { type: "integer", description: "往前聚合多少个月, 1-36, 默认 12" },
          exercise: {
            type: ["string", "null"],
            description: "只看某个动作的趋势 (它的每月最大重量/1RM/容量); 不传则全部动作合计",
          },
        },
        required: [],
      },
    },
  },
];

/** 写工具: 只在允许写时注入 */
const WRITE_TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "add_plan_day",
      description:
        "给当前计划新增一个训练日, 可以顺带把动作一次性加进去。注意一套计划里同一个周几只能有一个训练日 —— 那天已经有了就改用 add_plan_exercises 往里加动作。",
      parameters: {
        type: "object",
        properties: {
          weekday: { type: "integer", description: "1=周一 ... 7=周日" },
          title: { type: "string", description: "训练日主题, 如 「胸 + 三头」" },
          exercises: { type: "array", items: EXERCISE_ITEM, description: "该日的动作, 按训练顺序排" },
        },
        required: ["weekday", "title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_plan_exercises",
      description:
        "往某个已有训练日追加动作 (加到末尾)。一次把要加的动作全传进来, 不要一个一个调。",
      parameters: {
        type: "object",
        properties: {
          day_id: { type: "string", description: "来自 get_plan 的 day_id" },
          exercises: { type: "array", items: EXERCISE_ITEM },
        },
        required: ["day_id", "exercises"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_plan_exercise",
      description: "修改计划里某个动作的参数。只传要改的字段, 没传的保持原样。",
      parameters: {
        type: "object",
        properties: {
          exercise_id: { type: "string", description: "来自 get_plan 的 exercise_id" },
          ...EXERCISE_ITEM.properties,
        },
        required: ["exercise_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_plan_day",
      description: "改训练日的主题, 或把它挪到另一个周几。",
      parameters: {
        type: "object",
        properties: {
          day_id: { type: "string" },
          title: { type: ["string", "null"], description: "新主题; 不改就别传" },
          weekday: { type: ["integer", "null"], description: "挪到周几 1-7; 不挪就别传" },
        },
        required: ["day_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "move_plan_exercise",
      description: "调整动作在训练日里的先后顺序, 与相邻动作交换位置。",
      parameters: {
        type: "object",
        properties: {
          exercise_id: { type: "string" },
          direction: { type: "string", enum: ["up", "down"], description: "up=往前挪, down=往后挪" },
        },
        required: ["exercise_id", "direction"],
      },
    },
  },
];

/**
 * 删除工具: 不直接执行, 只登记成「待用户确认」。
 *
 * 撤销机制其实能无损还原删掉的行, 技术上不做确认也退得回来。做确认是因为
 * 删除在心理上和加东西不是一回事 —— 看到「已帮你删了 6 个动作 [撤销]」的
 * 第一反应是心慌, 而不是「行, 撤销就好」。
 */
const DELETE_TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "request_delete_plan_exercise",
      description:
        "请求删除计划里的某个动作。这不会立刻删除, 而是弹给用户确认。调用后要在回复里说明你建议删它的理由。",
      parameters: {
        type: "object",
        properties: { exercise_id: { type: "string" } },
        required: ["exercise_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_delete_plan_day",
      description:
        "请求删除整个训练日 (它下面的动作会一起没掉)。这不会立刻删除, 而是弹给用户确认。",
      parameters: {
        type: "object",
        properties: { day_id: { type: "string" } },
        required: ["day_id"],
      },
    },
  },
];

export function toolsFor(canWrite: boolean): ChatCompletionTool[] {
  return canWrite ? [...READ_TOOLS, ...WRITE_TOOLS, ...DELETE_TOOLS] : READ_TOOLS;
}

// ============================================================================
// 执行
// ============================================================================

/**
 * 跑一个工具, 返回喂回给模型的 JSON 字符串。
 *
 * 这里**从不抛异常**: 工具失败不是流程终止, 是给模型的下一条输入。
 * 「周六已经有训练日了」这种错误回喂过去, 它下一轮就会自己改走 add_plan_exercises。
 * 抛出去反而把这次自我纠正的机会掐掉了。
 */
export async function runTool(ctx: ToolCtx, name: string, argsJson: string): Promise<string> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJson || "{}") as Record<string, unknown>;
  } catch {
    return json({ error: "参数不是合法 JSON, 请重新调用" });
  }

  try {
    switch (name) {
      case "get_today":
        return await getToday(ctx);
      case "get_plan":
        return await getPlan(ctx);
      case "query_workouts":
        return await queryWorkouts(ctx, args);
      case "get_prs":
        return await getPrs(ctx);
      case "query_metrics":
        return await queryMetrics(ctx, args);
      case "query_nutrition":
        return await queryNutrition(ctx, args);
      case "get_trend":
        return await getTrend(ctx, args);

      case "add_plan_day":
        return await guardWrite(ctx, () => addPlanDay(ctx, args));
      case "add_plan_exercises":
        return await guardWrite(ctx, () => addPlanExercises(ctx, args));
      case "update_plan_exercise":
        return await guardWrite(ctx, () => updatePlanExercise(ctx, args));
      case "update_plan_day":
        return await guardWrite(ctx, () => updatePlanDay(ctx, args));
      case "move_plan_exercise":
        return await guardWrite(ctx, () => movePlanExercise(ctx, args));

      case "request_delete_plan_exercise":
        return await guardWrite(ctx, () => requestDeleteExercise(ctx, args));
      case "request_delete_plan_day":
        return await guardWrite(ctx, () => requestDeleteDay(ctx, args));

      default:
        return json({ error: `未知工具 ${name}` });
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "工具执行失败" });
  }
}

function json(v: unknown): string {
  return JSON.stringify(v);
}

/** 只读模式下写工具本来就不该被注入; 万一模型硬编出来一个, 这里挡住 */
async function guardWrite(ctx: ToolCtx, fn: () => Promise<string>): Promise<string> {
  if (!ctx.canWrite) {
    return json({ error: "当前是只读模式, 你不能修改数据。把建议说给用户, 让他自己改。" });
  }
  return fn();
}

// ---- 读 ----------------------------------------------------------------

async function getToday(ctx: ToolCtx): Promise<string> {
  const date = todayISO();
  // getDay(): 0=周日; 数据库口径是 1=周一...7=周日
  const jsDay = new Date().getDay();
  const weekday = (jsDay === 0 ? 7 : jsDay) as Weekday;

  const plan = await activePlan(ctx);
  let today: unknown = null;
  if (plan) {
    const { data: day } = await ctx.supabase
      .from("plan_days")
      .select("id,title,weekday")
      .eq("plan_id", plan.id)
      .eq("weekday", weekday)
      .maybeSingle();
    if (day) {
      const { data: exs } = await ctx.supabase
        .from("plan_exercises")
        .select("id,exercise,target_sets,rep_min,rep_max,rir_min,rir_max,rest_sec")
        .eq("day_id", day.id)
        .order("sort_order");
      today = { day_id: day.id, title: day.title, exercises: exs ?? [] };
    }
  }

  const { data: logged } = await ctx.supabase
    .from("v_exercise_sessions")
    .select("exercise,sets,top_weight_kg,total_reps,volume_kg,avg_rir")
    .eq("date", date);

  return json({
    date,
    weekday,
    weekday_label: WEEKDAY_LABEL[weekday],
    active_plan: plan ? { id: plan.id, name: plan.name } : null,
    today_plan: today ?? "今天在计划里是休息日",
    logged_today: logged ?? [],
  });
}

async function getPlan(ctx: ToolCtx): Promise<string> {
  const plan = await activePlan(ctx);
  if (!plan) return json({ error: "还没有启用中的计划, 用户需要先在「训练计划」页建一套" });

  const { data: days } = await ctx.supabase
    .from("plan_days")
    .select("id,weekday,title")
    .eq("plan_id", plan.id)
    .order("weekday");

  const dayIds = (days ?? []).map((d) => d.id);
  const { data: exs } = dayIds.length
    ? await ctx.supabase
        .from("plan_exercises")
        .select("id,day_id,exercise,target_sets,rep_min,rep_max,rir_min,rir_max,rest_sec,cues,equipment,sort_order")
        .in("day_id", dayIds)
        .order("sort_order")
    : { data: [] };

  return json({
    plan_id: plan.id,
    plan_name: plan.name,
    days: (days ?? []).map((d) => ({
      day_id: d.id,
      weekday: d.weekday,
      weekday_label: WEEKDAY_LABEL[d.weekday as Weekday],
      title: d.title,
      // 明确列字段而不是展开整行: day_id / sort_order 对模型没用, 反而占 token,
      // 而 exercise_id 这个名字比裸 id 更难被它跟 day_id 搞混
      exercises: (exs ?? [])
        .filter((e) => e.day_id === d.id)
        .map((e) => ({
          exercise_id: e.id,
          exercise: e.exercise,
          target_sets: e.target_sets,
          rep_min: e.rep_min,
          rep_max: e.rep_max,
          rir_min: e.rir_min,
          rir_max: e.rir_max,
          rest_sec: e.rest_sec,
          cues: e.cues,
          equipment: e.equipment,
        })),
    })),
  });
}

function daysArg(args: Record<string, unknown>, dflt: number): number {
  return clampInt(args.days, 1, 180) ?? dflt;
}

async function queryWorkouts(ctx: ToolCtx, args: Record<string, unknown>): Promise<string> {
  const days = daysArg(args, 28);
  const exercise = text(args.exercise, 100);
  let q = ctx.supabase
    .from("v_exercise_sessions")
    .select("date,exercise,sets,top_weight_kg,total_reps,volume_kg,avg_rir,dropped")
    .gte("date", daysAgoISO(days - 1))
    .order("date", { ascending: true });
  if (exercise) q = q.eq("exercise", exercise);
  // 401 是为了探测截断: 全量 180 天不带过滤可能有上千行, 一次性回喂会
  // 撑爆上下文。截断时明说, 让模型自己加过滤或改用 get_trend。
  const { data, error } = await q.limit(401);
  if (error) return json({ error: error.message });
  const truncated = (data?.length ?? 0) > 400;
  return json({
    days,
    count: Math.min(data?.length ?? 0, 400),
    ...(truncated ? { note: "结果超过 400 行已截断。请加 exercise 过滤、缩短天数, 或改用 get_trend 看月度聚合。" } : {}),
    sessions: (data ?? []).slice(0, 400),
  });
}

async function getPrs(ctx: ToolCtx): Promise<string> {
  const { data, error } = await ctx.supabase
    .from("v_exercise_pr")
    .select("exercise,max_weight_kg,estimated_1rm_kg,last_achieved_date")
    .order("estimated_1rm_kg", { ascending: false })
    .limit(60);
  if (error) return json({ error: error.message });
  return json({ exercises: data ?? [] });
}

async function queryMetrics(ctx: ToolCtx, args: Record<string, unknown>): Promise<string> {
  const days = daysArg(args, 28);
  const { data, error } = await ctx.supabase
    .from("daily_metrics")
    .select("date,weight_kg,body_fat_pct,waist_cm,sleep_hours")
    .gte("date", daysAgoISO(days - 1))
    .order("date", { ascending: true });
  if (error) return json({ error: error.message });
  return json({ days, metrics: data ?? [] });
}

async function queryNutrition(ctx: ToolCtx, args: Record<string, unknown>): Promise<string> {
  const days = daysArg(args, 14);
  const { data, error } = await ctx.supabase
    .from("v_daily_nutrition")
    .select("date,total_calories,total_protein_g,total_carbs_g,total_fat_g,unanalyzed_count")
    .gte("date", daysAgoISO(days - 1))
    .order("date", { ascending: true });
  if (error) return json({ error: error.message });
  return json({ days, nutrition: data ?? [] });
}

// ---------------------------------------------------------------------------
// 长期趋势 (按月聚合) -- 「这一年变化怎么样」的专用通道
//
// 不放开 query_workouts 的 180 天上限, 而是单独做聚合: 原始明细一年上千行,
// 直接回喂会撑爆上下文和 60s 预算; 按月聚合后无论查多少年, 回喂行数恒定
// (最多 36 个月)。聚合在服务端 JS 里做 -- 一年的明细拉到服务器也就 ~1000 行,
// 毫秒级, 不值得为它单写一个数据库函数。
// ---------------------------------------------------------------------------
async function getTrend(ctx: ToolCtx, args: Record<string, unknown>): Promise<string> {
  const months = clampInt(args.months, 1, 36) ?? 12;
  const exercise = text(args.exercise, 100);
  // months*31 天略宽于 N 个自然月, 聚合桶按 date 的 YYYY-MM 归位, 多拉几天
  // 只会让最早的月份数据稍多几天, 不影响整体走势
  const since = daysAgoISO(months * 31 - 1);

  const [sessRes, metRes, nutRes] = await Promise.all([
    ctx.supabase
      .from("v_exercise_sessions")
      .select("date,exercise,sets,top_weight_kg,best_1rm_kg,volume_kg")
      .gte("date", since),
    ctx.supabase
      .from("daily_metrics")
      .select("date,weight_kg,body_fat_pct,waist_cm")
      .gte("date", since),
    ctx.supabase
      .from("v_daily_nutrition")
      .select("date,total_calories,total_protein_g")
      .gte("date", since),
  ]);
  if (sessRes.error) return json({ error: sessRes.error.message });

  type WBucket = {
    month: string;
    days: Set<string>;
    sets: number;
    volume: number;
    top: number;
    best1rm: number;
  };
  const wb = new Map<string, WBucket>();
  const wOf = (m: string) =>
    wb.get(m) ?? { month: m, days: new Set(), sets: 0, volume: 0, top: 0, best1rm: 0 };

  for (const s of sessRes.data ?? []) {
    if (exercise && s.exercise !== exercise) continue;
    const m = s.date.slice(0, 7);
    const b = wOf(m);
    b.days.add(s.date);
    b.sets += s.sets ?? 0;
    b.volume += s.volume_kg ?? 0;
    b.top = Math.max(b.top, s.top_weight_kg ?? 0);
    b.best1rm = Math.max(b.best1rm, s.best_1rm_kg ?? 0);
    wb.set(m, b);
  }

  // 通用月均: 值可能为 null(那天没记), 只对有数据的算平均
  const monthlyAvg = (
    rows: Array<Record<string, unknown>> | null,
    field: string,
  ): Map<string, { sum: number; n: number }> => {
    const acc = new Map<string, { sum: number; n: number }>();
    for (const r of rows ?? []) {
      const v = r[field];
      if (typeof v !== "number") continue;
      const m = String(r.date).slice(0, 7);
      const cur = acc.get(m) ?? { sum: 0, n: 0 };
      cur.sum += v;
      cur.n += 1;
      acc.set(m, cur);
    }
    return acc;
  };
  const avgOf = (acc: Map<string, { sum: number; n: number }>, m: string) =>
    acc.has(m) ? Math.round((acc.get(m)!.sum / acc.get(m)!.n) * 10) / 10 : null;

  const monthsList = [...wb.keys()].sort();
  // 身体/饮食的月份并进训练的月份轴; 只有身体数据没训练的月份也保留,
  // 否则停训期(通常正是该聊的时期)在趋势里消失
  for (const src of [metRes.data, nutRes.data]) {
    for (const r of (src ?? []) as Array<Record<string, unknown>>) {
      monthsList.push(String(r.date).slice(0, 7));
    }
  }
  const allMonths = [...new Set(monthsList)].sort();

  const weightAcc = monthlyAvg(metRes.data, "weight_kg");
  const fatAcc = monthlyAvg(metRes.data, "body_fat_pct");
  const waistAcc = monthlyAvg(metRes.data, "waist_cm");
  const kcalAcc = monthlyAvg(nutRes.data, "total_calories");
  const proteinAcc = monthlyAvg(nutRes.data, "total_protein_g");

  return json({
    months: allMonths.length,
    exercise: exercise || "全部动作",
    workouts: allMonths.map((m) => {
      const b = wb.get(m);
      return {
        month: m,
        训练天数: b?.days.size ?? 0,
        总组数: b?.sets ?? 0,
        总容量kg: b ? Math.round(b.volume) : 0,
        最大重量kg: b?.top || null,
        最好1rm_kg: b?.best1rm || null,
      };
    }),
    body: allMonths.map((m) => ({
      month: m,
      体重kg: avgOf(weightAcc, m),
      体脂pct: avgOf(fatAcc, m),
      腰围cm: avgOf(waistAcc, m),
    })),
    nutrition: allMonths.map((m) => ({
      month: m,
      日均热量: avgOf(kcalAcc, m),
      日均蛋白质g: avgOf(proteinAcc, m),
    })),
    note: "按自然月聚合; 体重/热量是当月日均。中文字段名是给模型看的, 方便它直接引用。",
  });
}

// ---- 写 ----------------------------------------------------------------

async function addPlanDay(ctx: ToolCtx, args: Record<string, unknown>): Promise<string> {
  const plan = await activePlan(ctx);
  if (!plan) return json({ error: "还没有启用中的计划" });

  const weekdayNum = clampInt(args.weekday, 1, 7);
  const title = text(args.title, 200);
  if (weekdayNum === null) return json({ error: "weekday 必须是 1-7" });
  if (!title) return json({ error: "必须给训练日一个主题" });
  // clampInt 已经把范围收在 1-7, 这里只是把静态类型对上 Weekday
  const weekday = weekdayNum as Weekday;

  const { data: last } = await ctx.supabase
    .from("plan_days")
    .select("sort_order")
    .eq("plan_id", plan.id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: day, error } = await ctx.supabase
    .from("plan_days")
    .insert({
      plan_id: plan.id,
      user_id: ctx.userId,
      weekday,
      title,
      sort_order: (last?.sort_order ?? -1) + 1,
    })
    .select("*")
    .single();

  if (error || !day) {
    // 23505 = 撞上 unique(plan_id, weekday)。原样翻译成人话回喂给模型,
    // 它下一轮就知道该改走 add_plan_exercises 了
    if (error?.code === "23505") {
      const { data: exist } = await ctx.supabase
        .from("plan_days")
        .select("id,title")
        .eq("plan_id", plan.id)
        .eq("weekday", weekday)
        .maybeSingle();
      return json({
        error: `${WEEKDAY_LABEL[weekday]}已经有训练日了「${exist?.title ?? ""}」, 不能再建。要加动作请用 add_plan_exercises。`,
        existing_day_id: exist?.id ?? null,
      });
    }
    return json({ error: error?.message || "创建训练日失败" });
  }

  record(ctx, "plan_days", day.id, null, day);

  // 顺带把动作加进去 (同一次调用里完成, 省一个来回)
  const added = await insertExercises(ctx, day.id, args.exercises, 0);

  return json({
    ok: true,
    day_id: day.id,
    weekday,
    title,
    added_exercises: added.names,
    ...(added.error ? { exercise_error: added.error } : {}),
  });
}

async function addPlanExercises(ctx: ToolCtx, args: Record<string, unknown>): Promise<string> {
  const dayId = text(args.day_id, 64);
  if (!dayId) return json({ error: "缺少 day_id" });
  const chk = await assertActiveDay(ctx, dayId);
  if ("error" in chk) return json(chk);

  const { data: last } = await ctx.supabase
    .from("plan_exercises")
    .select("sort_order")
    .eq("day_id", dayId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const added = await insertExercises(ctx, dayId, args.exercises, (last?.sort_order ?? -1) + 1);
  if (added.error) return json({ error: added.error });
  if (!added.names.length) return json({ error: "exercises 是空的, 没有可加的动作" });

  return json({
    ok: true,
    day: `${WEEKDAY_LABEL[chk.day.weekday as Weekday]} ${chk.day.title}`,
    added_exercises: added.names,
  });
}

/** 批量插入动作并逐条记账; 返回加进去的动作名 */
async function insertExercises(
  ctx: ToolCtx,
  dayId: string,
  raw: unknown,
  startOrder: number,
): Promise<{ names: string[]; error?: string }> {
  const list = (Array.isArray(raw) ? raw : [])
    .map(normalizeExercise)
    .filter((e): e is ExerciseInput => e !== null)
    .slice(0, 20);
  if (!list.length) return { names: [] };

  const { data, error } = await ctx.supabase
    .from("plan_exercises")
    .insert(
      list.map((e, i) => ({
        day_id: dayId,
        user_id: ctx.userId,
        ...e,
        sort_order: startOrder + i,
      })),
    )
    .select("*");
  if (error) return { names: [], error: error.message };

  for (const row of data ?? []) record(ctx, "plan_exercises", row.id, null, row);
  return { names: (data ?? []).map((r) => r.exercise) };
}

async function updatePlanExercise(ctx: ToolCtx, args: Record<string, unknown>): Promise<string> {
  const id = text(args.exercise_id, 64);
  if (!id) return json({ error: "缺少 exercise_id" });
  const chk = await assertActiveExercise(ctx, id);
  if ("error" in chk) return json(chk);

  const before = bareRow(chk.row as unknown as Record<string, unknown>);

  // 只改传了的字段。注意不能用 normalizeExercise —— 那个会把没传的字段
  // 一律填成 null, 等于把用户原来填好的 cues、rest_sec 悄悄清掉。
  const patch: PlanExerciseUpdate = {};
  const name = text(args.exercise, 100);
  if (name) patch.exercise = name;
  if ("target_sets" in args) patch.target_sets = clampInt(args.target_sets, 0, 20);
  if ("rest_sec" in args) {
    patch.rest_sec =
      typeof args.rest_sec === "number"
        ? clampInt(args.rest_sec, 0, 3600)
        : parseRestSec(text(args.rest_sec));
  }
  if ("cues" in args) patch.cues = text(args.cues, 500);
  if ("equipment" in args) patch.equipment = text(args.equipment, 100);
  if ("rep_min" in args || "rep_max" in args) {
    const [lo, hi] = orderPair(
      "rep_min" in args ? clampInt(args.rep_min, 0, 100) : (before.rep_min as number | null),
      "rep_max" in args ? clampInt(args.rep_max, 0, 100) : (before.rep_max as number | null),
    );
    patch.rep_min = lo;
    patch.rep_max = hi;
  }
  if ("rir_min" in args || "rir_max" in args) {
    const [lo, hi] = orderPair(
      "rir_min" in args ? clampInt(args.rir_min, 0, 10) : (before.rir_min as number | null),
      "rir_max" in args ? clampInt(args.rir_max, 0, 10) : (before.rir_max as number | null),
    );
    patch.rir_min = lo;
    patch.rir_max = hi;
  }

  if (!Object.keys(patch).length) return json({ error: "没有要改的字段" });

  const { data, error } = await ctx.supabase
    .from("plan_exercises")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) return json({ error: error?.message || "修改失败" });

  record(ctx, "plan_exercises", id, before, data);
  return json({ ok: true, exercise: data.exercise, changed: Object.keys(patch) });
}

async function updatePlanDay(ctx: ToolCtx, args: Record<string, unknown>): Promise<string> {
  const id = text(args.day_id, 64);
  if (!id) return json({ error: "缺少 day_id" });
  const chk = await assertActiveDay(ctx, id);
  if ("error" in chk) return json(chk);

  const before = bareRow(chk.day as unknown as Record<string, unknown>);
  const patch: Partial<PlanDay> = {};
  const title = text(args.title, 200);
  if (title) patch.title = title;
  if (args.weekday !== undefined && args.weekday !== null) {
    const w = clampInt(args.weekday, 1, 7);
    if (w === null) return json({ error: "weekday 必须是 1-7" });
    patch.weekday = w as Weekday;
  }
  if (!Object.keys(patch).length) return json({ error: "没有要改的字段" });

  const { data, error } = await ctx.supabase
    .from("plan_days")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) {
    if (error?.code === "23505" && patch.weekday) {
      return json({ error: `${WEEKDAY_LABEL[patch.weekday]}已经有别的训练日了, 挪不过去` });
    }
    return json({ error: error?.message || "修改失败" });
  }

  record(ctx, "plan_days", id, before, data);
  return json({ ok: true, title: data.title, weekday: data.weekday });
}

async function movePlanExercise(ctx: ToolCtx, args: Record<string, unknown>): Promise<string> {
  const id = text(args.exercise_id, 64);
  const dir = args.direction === "up" ? -1 : args.direction === "down" ? 1 : null;
  if (!id) return json({ error: "缺少 exercise_id" });
  if (dir === null) return json({ error: "direction 必须是 up 或 down" });

  const chk = await assertActiveExercise(ctx, id);
  if ("error" in chk) return json(chk);
  const cur = chk.row;

  const { data: neighbor } = await ctx.supabase
    .from("plan_exercises")
    .select("id,sort_order,exercise")
    .eq("day_id", cur.day_id)
    [dir === -1 ? "lt" : "gt"]("sort_order", cur.sort_order)
    .order("sort_order", { ascending: dir === 1 })
    .limit(1)
    .maybeSingle();
  if (!neighbor) return json({ ok: true, note: "已经在首位或末位, 没有移动" });

  // 两行都要记账, 撤销时逆序写回就能复原
  const { data: a } = await ctx.supabase
    .from("plan_exercises")
    .update({ sort_order: neighbor.sort_order })
    .eq("id", cur.id)
    .select("*")
    .single();
  if (a) record(ctx, "plan_exercises", cur.id, { ...bareRow(cur as unknown as Record<string, unknown>) }, a);

  const { data: b } = await ctx.supabase
    .from("plan_exercises")
    .update({ sort_order: cur.sort_order })
    .eq("id", neighbor.id)
    .select("*")
    .single();
  if (b) record(ctx, "plan_exercises", neighbor.id, { ...neighbor, sort_order: neighbor.sort_order }, b);

  return json({ ok: true, moved: cur.exercise, swapped_with: neighbor.exercise });
}

// ---- 删除: 只登记, 不执行 ------------------------------------------------

async function requestDeleteExercise(ctx: ToolCtx, args: Record<string, unknown>): Promise<string> {
  const id = text(args.exercise_id, 64);
  if (!id) return json({ error: "缺少 exercise_id" });
  const chk = await assertActiveExercise(ctx, id);
  if ("error" in chk) return json(chk);

  ctx.pendingDeletes.push({
    kind: "plan_exercise",
    id,
    label: `${WEEKDAY_LABEL[chk.day.weekday as Weekday]}的「${chk.row.exercise}」`,
  });
  return json({
    ok: true,
    status: "等待用户确认",
    note: "已经把删除请求摆到用户面前了。你现在要做的是在回复里说明为什么建议删它, 不要假装已经删掉。",
  });
}

async function requestDeleteDay(ctx: ToolCtx, args: Record<string, unknown>): Promise<string> {
  const id = text(args.day_id, 64);
  if (!id) return json({ error: "缺少 day_id" });
  const chk = await assertActiveDay(ctx, id);
  if ("error" in chk) return json(chk);

  const { count } = await ctx.supabase
    .from("plan_exercises")
    .select("id", { count: "exact", head: true })
    .eq("day_id", id);

  ctx.pendingDeletes.push({
    kind: "plan_day",
    id,
    label: `${WEEKDAY_LABEL[chk.day.weekday as Weekday]}「${chk.day.title}」`,
    cascade: count ? `这个训练日下面的 ${count} 个动作会一起删掉` : undefined,
  });
  return json({
    ok: true,
    status: "等待用户确认",
    exercises_affected: count ?? 0,
    note: "已经把删除请求摆到用户面前了。在回复里说明理由, 不要假装已经删掉。",
  });
}
