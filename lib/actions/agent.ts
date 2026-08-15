"use server";

// ============================================================================
// AI 教练改动的撤销, 与删除请求的确认执行
// ============================================================================
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/utils/server";

export type ActionResult = { error?: string };

type MutationTable = "plan_days" | "plan_exercises" | "workout_plans";

function refresh() {
  revalidatePath("/plan");
  revalidatePath("/workouts");
  revalidatePath("/analysis");
  revalidatePath("/");
}

/**
 * 撤销一整轮 AI 改动。
 *
 * 三种情况各自的退法 (见 supabase/migrations/0010 的说明):
 *   before 为空 -> 新增的行 -> 删掉
 *   after  为空 -> 删掉的行 -> 原样插回去, 连 id 一起
 *   两者都有    -> 改过的行 -> 写回 before
 *
 * **必须按 seq 倒序**。同一轮里若先建了训练日再往里加动作, 正序退会先删训练日,
 * 外键级联把动作一并带走, 后面那条删动作的记录就落空了 (行已经不在);
 * 倒序退则是先删动作再删训练日, 每一步都干净。
 * 删除方向同理: 记账时子行在前、父行在后, 倒序重放就成了先插父行再插子行。
 */
export async function undoTurn(formData: FormData): Promise<ActionResult> {
  const { supabase, userId } = await getCurrentUser();
  const turnId = (formData.get("turn_id")?.toString() ?? "").trim();
  if (!turnId) return { error: "缺少 turn_id" };

  const { data: rows, error } = await supabase
    .from("agent_mutations")
    .select("*")
    .eq("turn_id", turnId)
    .eq("user_id", userId)
    .is("undone_at", null)
    .order("seq", { ascending: false });

  if (error) return { error: error.message };
  if (!rows?.length) return { error: "这轮改动已经撤销过了" };

  const failed: string[] = [];

  for (const m of rows) {
    const table = m.table_name as MutationTable;
    const before = m.before as Record<string, unknown> | null;

    if (!before) {
      // 新增的行 -> 删掉
      const { error: e } = await supabase.from(table).delete().eq("id", m.row_id);
      if (e) failed.push(`${table}: ${e.message}`);
    } else {
      // 改过或删掉的行 -> 原样写回。
      // upsert 而不是 update: 前者两种情况通吃 —— 行还在就覆盖, 行没了就按
      // 原 id 插回来。id 一并还原是有意的, plan_exercises.id 被手表端引用着。
      const { error: e } = await supabase
        .from(table)
        .upsert(before as never, { onConflict: "id" });
      if (e) failed.push(`${table}: ${e.message}`);
    }
  }

  // 部分失败也要把成功的那些标记掉, 否则再点一次撤销会把成功的部分重做一遍
  await supabase
    .from("agent_mutations")
    .update({ undone_at: new Date().toISOString() })
    .eq("turn_id", turnId)
    .eq("user_id", userId)
    .is("undone_at", null);

  refresh();
  return failed.length ? { error: `部分改动没能退回: ${failed.join("; ")}` } : {};
}

/**
 * 最近一轮还没撤销的 AI 改动。
 *
 * 撤销入口不应该只活在聊天框里: 会话是客户端状态, 刷新/换设备就没了,
 * 但 turn_id 和快照一直在库上。chatbox 挂载时调这个, 把撤销条恢复出来 --
 * 哪怕对话丢了, 「撤回 AI 上一轮改动」的入口永远在。
 */
export async function latestUndoableTurn(): Promise<{
  turnId: string;
  mutationCount: number;
  createdAt: string;
} | null> {
  const { supabase, userId } = await getCurrentUser();

  const { data: latest } = await supabase
    .from("agent_mutations")
    .select("turn_id, created_at")
    .eq("user_id", userId)
    .is("undone_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const turnId = latest?.[0]?.turn_id;
  if (!turnId) return null;

  const { count } = await supabase
    .from("agent_mutations")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("turn_id", turnId)
    .is("undone_at", null);

  return { turnId, mutationCount: count ?? 0, createdAt: latest[0].created_at };
}

/**
 * 执行一条被挂起的删除 (用户在确认卡片上点了确认)。
 *
 * 删除同样记账, 所以删完照样能撤销 —— 确认只是多一道心理关卡,
 * 不是「删了就没了」。
 */
export async function confirmDelete(formData: FormData): Promise<ActionResult> {
  const { supabase, userId } = await getCurrentUser();
  const kind = formData.get("kind")?.toString();
  const id = (formData.get("id")?.toString() ?? "").trim();
  if (!id) return { error: "缺少 id" };

  const turnId = randomUUID();
  const rows: Array<{
    table_name: MutationTable;
    row_id: string;
    before: Record<string, unknown>;
  }> = [];

  if (kind === "plan_exercise") {
    const { data, error } = await supabase
      .from("plan_exercises")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) return { error: error.message };
    if (!data) return { error: "这个动作已经不在了" };
    rows.push({ table_name: "plan_exercises", row_id: id, before: data });
  } else if (kind === "plan_day") {
    const { data: day, error } = await supabase
      .from("plan_days")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) return { error: error.message };
    if (!day) return { error: "这个训练日已经不在了" };

    // ⚠️ 关键: 训练日下面的动作由外键 on delete cascade 一起删掉, 级联发生在
    // 数据库内部, 不会自己留下记录。不在这里逐条抄一遍, 撤销时训练日会回来、
    // 动作却永远回不来了。
    //
    // 子行记在前、父行记在后, 因为撤销是倒序重放 —— 这样退的时候先插回训练日,
    // 再插回动作, 外键才立得住。
    const { data: exs } = await supabase.from("plan_exercises").select("*").eq("day_id", id);
    for (const e of exs ?? []) {
      rows.push({ table_name: "plan_exercises", row_id: e.id, before: e });
    }
    rows.push({ table_name: "plan_days", row_id: id, before: day });
  } else {
    return { error: "不支持的删除类型" };
  }

  // 先记账再删。反过来的话, 删成功但记账失败就等于数据没了还退不回去。
  const { error: logErr } = await supabase.from("agent_mutations").insert(
    rows.map((r, seq) => ({
      user_id: userId,
      turn_id: turnId,
      seq,
      table_name: r.table_name,
      row_id: r.row_id,
      before: r.before,
      after: null,
    })),
  );
  if (logErr) return { error: `没能记下撤销信息, 已中止删除: ${logErr.message}` };

  const table = kind === "plan_day" ? "plan_days" : "plan_exercises";
  const { error: delErr } = await supabase.from(table).delete().eq("id", id);
  if (delErr) {
    // 删失败就把刚记的账清掉, 免得留下一条指向「其实没删」的撤销记录
    await supabase.from("agent_mutations").delete().eq("turn_id", turnId);
    return { error: delErr.message };
  }

  refresh();
  return {};
}
