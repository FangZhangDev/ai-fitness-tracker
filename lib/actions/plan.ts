"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/utils/server";
import { parsePlanText, generatePlan } from "@/lib/ai/plan";
import type { ParsedPlan, Weekday } from "@/lib/types/database";

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
      rest: e.rest,
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
  const { supabase, userId } = await getCurrentUser();
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
          rest: e.rest,
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
      rest: str(formData.get("rest")) || null,
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
    rest: str(formData.get("rest")) || null,
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

export async function updatePlanDay(prev: unknown, formData: FormData): Promise<ActionResult> {
  const { supabase } = await getCurrentUser();
  const id = str(formData.get("id"));
  const title = str(formData.get("title"));
  if (!id || !title) return { error: "请填写训练日主题" };
  const { error } = await supabase
    .from("plan_days")
    .update({ title: title.slice(0, 200) })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/plan");
  revalidatePath("/workouts");
  return {};
}

// ============================================================================
// 从计划快速记录: 把今天计划里填了重量的动作一次性写入 workout_logs
// ============================================================================

export async function logFromPlan(prev: unknown, formData: FormData): Promise<ActionResult & { saved?: number }> {
  const { supabase, userId } = await getCurrentUser();
  const date = str(formData.get("date"));
  const workoutDay = str(formData.get("workout_day")) || null;
  if (!date) return { error: "缺少日期" };

  // 表单里每个动作一组字段, 用 ids[] 串起来
  const ids = formData.getAll("ids").map((v) => v.toString());
  const rows = ids
    .map((id) => ({
      user_id: userId,
      date,
      workout_day: workoutDay,
      exercise: str(formData.get(`exercise_${id}`)),
      weight_kg: num(formData.get(`weight_${id}`)),
      sets: int(formData.get(`sets_${id}`)),
      reps: int(formData.get(`reps_${id}`)),
      rir: int(formData.get(`rir_${id}`)),
      notes: null,
    }))
    // 只保存真正练了的: 有动作名, 且重量/组数/次数至少填了一项
    .filter(
      (r) =>
        r.exercise &&
        (r.weight_kg !== null || r.sets !== null || r.reps !== null),
    );

  if (!rows.length) return { error: "还没填任何数据, 至少填一个动作的重量或组次" };

  const { error } = await supabase.from("workout_logs").insert(rows);
  if (error) return { error: error.message };

  revalidatePath("/workouts");
  revalidatePath("/");
  return { saved: rows.length };
}
