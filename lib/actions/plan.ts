"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/utils/server";
import { parsePlanText, generatePlan } from "@/lib/ai/plan";
import { WEEKDAY_LABEL } from "@/lib/types/database";
import type { ParsedPlan, Weekday, WorkoutLogInsert } from "@/lib/types/database";

export type ActionResult = { error?: string };
export type ParseResult = { error?: string; plan?: ParsedPlan };

function str(v: FormDataEntryValue | null): string {
  return (v?.toString() ?? "").trim();
}
function num(v: FormDataEntryValue | null): number | null {
  const s = str(v);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function int(v: FormDataEntryValue | null): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n);
}

// ============================================================================
// 解析 / 生成 — 只返回结构化结果供前端预览, 用户确认后才调 savePlan 落库
// ============================================================================

/** 粘贴文本 → AI 解析成计划 (不落库) */
export async function parsePlan(prev: unknown, formData: FormData): Promise<ParseResult> {
  await getCurrentUser(); // 仅校验登录
  const text = str(formData.get("text"));
  if (!text) return { error: "请先粘贴计划内容" };
  if (text.length > 20000) return { error: "内容过长, 请分批导入" };
  try {
    const plan = await parsePlanText(text);
    if (!plan.days.length) return { error: "没能从文本里识别出训练日, 换个格式再试试" };
    return { plan };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "AI 解析失败" };
  }
}

/** 让 AI 结合身体数据与历史训练生成一份新计划 (不落库) */
export async function aiGeneratePlan(prev: unknown, formData: FormData): Promise<ParseResult> {
  const { supabase, userId } = await getCurrentUser();

  const weekdays = formData
    .getAll("weekdays")
    .map((v) => Number(v.toString()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
  if (!weekdays.length) return { error: "请至少选择一个训练日" };

  const [profileRes, prRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("height_cm,current_weight_kg,target_weight_kg,goal")
      .eq("id", userId)
      .single(),
    supabase
      .from("v_exercise_pr")
      .select("exercise,max_weight_kg,estimated_1rm_kg")
      .order("estimated_1rm_kg", { ascending: false })
      .limit(30),
  ]);

  try {
    const plan = await generatePlan({
      request: str(formData.get("request")),
      weekdays,
      equipment: str(formData.get("equipment")),
      profile: profileRes.data ?? null,
      recentExercises: prRes.data ?? [],
    });
    if (!plan.days.length) return { error: "AI 没有生成有效的训练日, 请补充更多信息后重试" };
    return { plan };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "AI 生成失败" };
  }
}

// ============================================================================
// 落库
// ============================================================================

/**
 * 保存一份计划 (来自解析或生成的预览结果)。
 * 新计划默认设为启用中, 原来启用的会被切下来。
 */
export async function savePlan(plan: ParsedPlan, name?: string): Promise<ActionResult & { planId?: string }> {
  const { supabase, userId } = await getCurrentUser();
  if (!plan?.days?.length) return { error: "计划内容为空" };

  const { data: created, error: planErr } = await supabase
    .from("workout_plans")
    .insert({ user_id: userId, name: (name || plan.name).slice(0, 100), is_active: false })
    .select("id")
    .single();
  if (planErr || !created) return { error: planErr?.message || "创建计划失败" };

  const { data: days, error: dayErr } = await supabase
    .from("plan_days")
    .insert(
      plan.days.map((d, i) => ({
        plan_id: created.id,
        user_id: userId,
        weekday: d.weekday,
        title: d.title.slice(0, 200),
        sort_order: i,
      })),
    )
    .select("id,weekday");
  if (dayErr || !days) return { error: dayErr?.message || "创建训练日失败" };

  const dayIdByWeekday = new Map(days.map((d) => [d.weekday, d.id]));
  const rows = plan.days.flatMap((d) => {
    const dayId = dayIdByWeekday.get(d.weekday);
    if (!dayId) return [];
    return d.exercises.map((e, i) => ({
      day_id: dayId,
      user_id: userId,
      exercise: e.exercise.slice(0, 100),
      target_sets: e.target_sets,
      rep_min: e.rep_min,
      rep_max: e.rep_max,
      rir_min: e.rir_min,
      rir_max: e.rir_max,
      rest_sec: e.rest_sec,
      cues: e.cues,
      equipment: e.equipment,
      sort_order: i,
    }));
  });
  if (rows.length) {
    const { error: exErr } = await supabase.from("plan_exercises").insert(rows);
    if (exErr) return { error: exErr.message };
  }

  // 落库成功后再启用, 避免中途失败留下一个半截的启用计划
  await supabase.rpc("activate_plan", { p_plan_id: created.id });

  revalidatePath("/plan");
  revalidatePath("/workouts");
  revalidatePath("/");
  return { planId: created.id };
}

// ============================================================================
// 计划管理: 切换 / 复制 / 重命名 / 删除
// ============================================================================

/** 切换启用中的计划 (假期结束切回原计划就用这个) */
export async function activatePlan(formData: FormData): Promise<ActionResult> {
  const { supabase } = await getCurrentUser();
  const id = str(formData.get("id"));
  if (!id) return { error: "缺少计划 ID" };
  const { error } = await supabase.rpc("activate_plan", { p_plan_id: id });
  if (error) return { error: error.message };
  revalidatePath("/plan");
  revalidatePath("/workouts");
  revalidatePath("/");
  return {};
}

/**
 * 复制一份计划。
 * 想调整计划又怕改坏时, 先复制再改副本, 原计划保持原样, 随时可以切回去。
 */
export async function duplicatePlan(formData: FormData): Promise<ActionResult> {
  // 只要 supabase 就够: 下面的查询由 RLS 限定在自己的数据上, 不需要显式 userId
  const { supabase } = await getCurrentUser();
  const id = str(formData.get("id"));
  if (!id) return { error: "缺少计划 ID" };

  const { data: src, error: srcErr } = await supabase
    .from("workout_plans")
    .select("name")
    .eq("id", id)
    .single();
  if (srcErr || !src) return { error: srcErr?.message || "找不到原计划" };

  const { data: days, error: daysErr } = await supabase
    .from("plan_days")
    .select("id,weekday,title,sort_order")
    .eq("plan_id", id)
    .order("weekday");
  if (daysErr) return { error: daysErr.message };

  const { data: exercises, error: exErr } = await supabase
    .from("plan_exercises")
    .select("*")
    .in("day_id", (days ?? []).map((d) => d.id));
  if (exErr) return { error: exErr.message };

  const plan: ParsedPlan = {
    name: `${src.name} (副本)`,
    days: (days ?? []).map((d) => ({
      weekday: d.weekday as Weekday,
      title: d.title,
      exercises: (exercises ?? [])
        .filter((e) => e.day_id === d.id)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((e) => ({
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
  };

  const res = await savePlan(plan);
  return res.error ? { error: res.error } : {};
}

export async function renamePlan(formData: FormData): Promise<ActionResult> {
  const { supabase } = await getCurrentUser();
  const id = str(formData.get("id"));
  const name = str(formData.get("name"));
  if (!id || !name) return { error: "请填写计划名称" };
  const { error } = await supabase
    .from("workout_plans")
    .update({ name: name.slice(0, 100) })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/plan");
  return {};
}

/** 删除计划 (级联删掉它的训练日与动作; 已记录的 workout_logs 不受影响) */
export async function deletePlan(formData: FormData): Promise<ActionResult> {
  const { supabase } = await getCurrentUser();
  const id = str(formData.get("id"));
  if (!id) return { error: "缺少计划 ID" };
  const { error } = await supabase.from("workout_plans").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/plan");
  revalidatePath("/workouts");
  return {};
}

// ============================================================================
// 计划内容编辑
// ============================================================================

export async function updatePlanExercise(prev: unknown, formData: FormData): Promise<ActionResult> {
  const { supabase } = await getCurrentUser();
  const id = str(formData.get("id"));
  const exercise = str(formData.get("exercise"));
  if (!id) return { error: "缺少动作 ID" };
  if (!exercise) return { error: "请填写动作名称" };
  const { error } = await supabase
    .from("plan_exercises")
    .update({
      exercise,
      target_sets: int(formData.get("target_sets")),
      rep_min: int(formData.get("rep_min")),
      rep_max: int(formData.get("rep_max")),
      rir_min: int(formData.get("rir_min")),
      rir_max: int(formData.get("rir_max")),
      rest_sec: int(formData.get("rest_sec")),
      cues: str(formData.get("cues")) || null,
      equipment: str(formData.get("equipment")) || null,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/plan");
  revalidatePath("/workouts");
  return {};
}

export async function addPlanExercise(prev: unknown, formData: FormData): Promise<ActionResult> {
  const { supabase, userId } = await getCurrentUser();
  const dayId = str(formData.get("day_id"));
  const exercise = str(formData.get("exercise"));
  if (!dayId) return { error: "缺少训练日 ID" };
  if (!exercise) return { error: "请填写动作名称" };

  // 追加到末尾
  const { data: last } = await supabase
    .from("plan_exercises")
    .select("sort_order")
    .eq("day_id", dayId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("plan_exercises").insert({
    day_id: dayId,
    user_id: userId,
    exercise,
    target_sets: int(formData.get("target_sets")),
    rep_min: int(formData.get("rep_min")),
    rep_max: int(formData.get("rep_max")),
    rir_min: int(formData.get("rir_min")),
    rir_max: int(formData.get("rir_max")),
    rest_sec: int(formData.get("rest_sec")),
    cues: str(formData.get("cues")) || null,
    equipment: str(formData.get("equipment")) || null,
    sort_order: (last?.sort_order ?? -1) + 1,
  });
  if (error) return { error: error.message };
  revalidatePath("/plan");
  revalidatePath("/workouts");
  return {};
}

export async function deletePlanExercise(formData: FormData): Promise<ActionResult> {
  const { supabase } = await getCurrentUser();
  const id = str(formData.get("id"));
  if (!id) return { error: "缺少动作 ID" };
  const { error } = await supabase.from("plan_exercises").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/plan");
  revalidatePath("/workouts");
  return {};
}

/** 调整动作顺序 (dir: -1 上移, 1 下移) — 与相邻动作交换 sort_order */
export async function movePlanExercise(formData: FormData): Promise<ActionResult> {
  const { supabase } = await getCurrentUser();
  const id = str(formData.get("id"));
  const dir = int(formData.get("dir"));
  if (!id || (dir !== -1 && dir !== 1)) return { error: "参数不合法" };

  const { data: cur, error: curErr } = await supabase
    .from("plan_exercises")
    .select("id,day_id,sort_order")
    .eq("id", id)
    .single();
  if (curErr || !cur) return { error: curErr?.message || "找不到该动作" };

  const { data: neighbor } = await supabase
    .from("plan_exercises")
    .select("id,sort_order")
    .eq("day_id", cur.day_id)
    [dir === -1 ? "lt" : "gt"]("sort_order", cur.sort_order)
    .order("sort_order", { ascending: dir === 1 })
    .limit(1)
    .maybeSingle();
  if (!neighbor) return {}; // 已在首/末位, 静默忽略

  await supabase.from("plan_exercises").update({ sort_order: neighbor.sort_order }).eq("id", cur.id);
  await supabase.from("plan_exercises").update({ sort_order: cur.sort_order }).eq("id", neighbor.id);

  revalidatePath("/plan");
  revalidatePath("/workouts");
  return {};
}

/** 校验周几入参; 返回 null 表示不合法 */
function weekday(v: FormDataEntryValue | null): Weekday | null {
  const n = int(v);
  return n !== null && n >= 1 && n <= 7 ? (n as Weekday) : null;
}

/**
 * 0002 给 plan_days 加了 unique (plan_id, weekday) —— 一套计划里同一个周几只能有一条。
 * 撞上时数据库回 23505, 直接把原始报错甩给用户看不懂, 这里翻译成人话。
 */
function dayConflictMessage(code: string | undefined, w: Weekday): string | null {
  return code === "23505" ? `这套计划的${WEEKDAY_LABEL[w]}已经有训练日了` : null;
}

/** 改训练日: 主题, 以及排到周几 */
export async function updatePlanDay(prev: unknown, formData: FormData): Promise<ActionResult> {
  const { supabase } = await getCurrentUser();
  const id = str(formData.get("id"));
  const title = str(formData.get("title"));
  if (!id || !title) return { error: "请填写训练日主题" };

  // weekday 是可选字段: 没传就只改主题, 别把已有的周几冲掉
  const patch: { title: string; weekday?: Weekday } = { title: title.slice(0, 200) };
  if (formData.has("weekday")) {
    const w = weekday(formData.get("weekday"));
    if (w === null) return { error: "请选择周几" };
    patch.weekday = w;
  }

  const { error } = await supabase.from("plan_days").update(patch).eq("id", id);
  if (error) {
    return {
      error:
        (patch.weekday && dayConflictMessage(error.code, patch.weekday)) || error.message,
    };
  }
  revalidatePath("/plan");
  revalidatePath("/workouts");
  revalidatePath("/");
  return {};
}

/** 给计划加一个训练日 (比如原来只练周一三五, 现在想加个周六) */
export async function addPlanDay(prev: unknown, formData: FormData): Promise<ActionResult> {
  const { supabase, userId } = await getCurrentUser();
  const planId = str(formData.get("plan_id"));
  const w = weekday(formData.get("weekday"));
  const title = str(formData.get("title"));
  if (!planId) return { error: "缺少计划 ID" };
  if (w === null) return { error: "请选择周几" };
  if (!title) return { error: "请填写训练日主题" };

  // 追加到末尾 (页面按 weekday 排序展示, sort_order 只是保持与 savePlan 一致)
  const { data: last } = await supabase
    .from("plan_days")
    .select("sort_order")
    .eq("plan_id", planId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("plan_days").insert({
    plan_id: planId,
    user_id: userId,
    weekday: w,
    title: title.slice(0, 200),
    sort_order: (last?.sort_order ?? -1) + 1,
  });
  if (error) return { error: dayConflictMessage(error.code, w) || error.message };

  revalidatePath("/plan");
  revalidatePath("/workouts");
  revalidatePath("/");
  return {};
}

/** 删除训练日 (它下面的动作会跟着级联删掉; 已记录的 workout_logs 不受影响) */
export async function deletePlanDay(formData: FormData): Promise<ActionResult> {
  const { supabase } = await getCurrentUser();
  const id = str(formData.get("id"));
  if (!id) return { error: "缺少训练日 ID" };
  const { error } = await supabase.from("plan_days").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/plan");
  revalidatePath("/workouts");
  revalidatePath("/");
  return {};
}

// ============================================================================
// 从计划快速记录: 把今天计划里填了的动作一次性写入 workout_logs
//
// 表单两种模式 (每个动作各自选, 见 components/today-plan-logger.tsx):
//   整体  mode_{id} 不是 "sets" —— 填一次重量/组数/次数, 展开成 N 组相同数据
//   逐组  mode_{id} === "sets"  —— 每组各填各的, 掉重量那组才记得下来
//
// 写入用 upsert 而不是 insert: 一天里可能先在手表上记了两组, 回头又在网页保存,
// 旧代码那样直接 insert 会插出重复行 (按组之后更会直接撞 unique)。
// 同一动作若原来记了更多组, 多出来的尾巴一并删掉, 保证"保存后就是屏幕上这些组"。
// ============================================================================

export async function logFromPlan(prev: unknown, formData: FormData): Promise<ActionResult & { saved?: number }> {
  const { supabase, userId } = await getCurrentUser();
  const date = str(formData.get("date"));
  const workoutDay = str(formData.get("workout_day")) || null;
  if (!date) return { error: "缺少日期" };

  const ids = formData.getAll("ids").map((v) => v.toString());
  const rows: WorkoutLogInsert[] = [];
  // 每个动作实际写了几组, 用来把多余的旧组裁掉
  const setCountByExercise = new Map<string, number>();

  for (const id of ids) {
    const exercise = str(formData.get(`exercise_${id}`));
    if (!exercise) continue;

    const base = { user_id: userId, date, workout_day: workoutDay, exercise, notes: null };
    const before = rows.length;

    if (str(formData.get(`mode_${id}`)) === "sets") {
      const n = int(formData.get(`setcount_${id}`)) ?? 0;
      for (let i = 1; i <= n; i++) {
        const weight = num(formData.get(`sw_${id}_${i}`));
        const reps = int(formData.get(`sr_${id}_${i}`));
        const rir = int(formData.get(`srir_${id}_${i}`));
        // 整组留空 = 这组没做, 跳过 (中间跳过一组时后面的组号会往前挪, 不留空洞)
        if (weight === null && reps === null) continue;
        rows.push({
          ...base,
          set_index: rows.length - before + 1,
          weight_kg: weight,
          reps,
          rir,
          is_warmup: str(formData.get(`swarm_${id}_${i}`)) === "1",
          rest_sec: null,
          performed_at: null,
        });
      }
    } else {
      const weight = num(formData.get(`weight_${id}`));
      const reps = int(formData.get(`reps_${id}`));
      const rir = int(formData.get(`rir_${id}`));
      const sets = int(formData.get(`sets_${id}`));
      // 只保存真正练了的: 重量/组数/次数至少填了一项
      if (weight === null && reps === null && sets === null) continue;
      for (let i = 1; i <= Math.max(sets ?? 1, 1); i++) {
        rows.push({
          ...base,
          set_index: i,
          weight_kg: weight,
          reps,
          rir,
          is_warmup: false,
          rest_sec: null,
          performed_at: null,
        });
      }
    }

    if (rows.length > before) setCountByExercise.set(exercise, rows.length - before);
  }

  if (!rows.length) return { error: "还没填任何数据, 至少填一个动作的重量或组次" };

  const { error } = await supabase
    .from("workout_logs")
    .upsert(rows, { onConflict: "user_id,date,exercise,set_index" });
  if (error) return { error: error.message };

  // 裁掉这次没写到的尾巴 (上次记了 4 组, 这次只记 3 组)
  for (const [exercise, n] of setCountByExercise) {
    await supabase
      .from("workout_logs")
      .delete()
      .eq("user_id", userId)
      .eq("date", date)
      .eq("exercise", exercise)
      .gt("set_index", n);
  }

  revalidatePath("/workouts");
  revalidatePath("/");
  return { saved: rows.length };
}
