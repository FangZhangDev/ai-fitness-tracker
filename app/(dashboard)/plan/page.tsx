import { getCurrentUser } from "@/lib/utils/server";
import { SectionTitle } from "@/components/ui";
import PlanManager from "@/components/plan-manager";
import PlanCreator from "@/components/plan-creator";
import PlanEditor from "@/components/plan-editor";
import type { PlanExercise } from "@/lib/types/database";

export const dynamic = "force-dynamic";
// 粘贴导入与 AI 生成都是同步 Server Action, 计划文本较长时耗时明显
export const maxDuration = 60;

export default async function PlanPage() {
  const { supabase } = await getCurrentUser();

  const { data: plans } = await supabase
    .from("workout_plans")
    .select("*")
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: false });

  const list = plans ?? [];
  const active = list.find((p) => p.is_active) ?? null;

  // 所有计划的训练日, 一次取回: 既用于列表上的计数, 也用于编辑区
  const { data: allDays } = await supabase
    .from("plan_days")
    .select("*")
    .in("plan_id", list.map((p) => p.id))
    .order("weekday");

  const days = allDays ?? [];
  const { data: allExercises } = await supabase
    .from("plan_exercises")
    .select("*")
    .in("day_id", days.map((d) => d.id))
    .order("sort_order");

  const exercises = allExercises ?? [];

  // 每套计划的训练日数与动作数
  const counts: Record<string, { days: number; exercises: number }> = {};
  for (const p of list) {
    const myDays = days.filter((d) => d.plan_id === p.id);
    const myDayIds = new Set(myDays.map((d) => d.id));
    counts[p.id] = {
      days: myDays.length,
      exercises: exercises.filter((e) => myDayIds.has(e.day_id)).length,
    };
  }

  const activeDays = active ? days.filter((d) => d.plan_id === active.id) : [];
  const exercisesByDay: Record<string, PlanExercise[]> = {};
  for (const d of activeDays) {
    exercisesByDay[d.id] = exercises.filter((e) => e.day_id === d.id);
  }

  return (
    <div className="space-y-6">
      <div>
        <SectionTitle
          title="训练计划"
          desc="可以存多套计划随时切换：换健身房、过年回家建一套新的，回来一键切回原来那套。"
        />
        <PlanManager plans={list} counts={counts} />
      </div>

      <div>
        <SectionTitle title="新建计划" desc="粘贴现成的计划让 AI 解析，或让 AI 结合你的数据直接编排。" />
        <PlanCreator />
      </div>

      {active && (
        <div>
          <SectionTitle
            title={`编辑「${active.name}」`}
            desc="改坏了不好恢复的话，建议先在上面「复制」一份再改副本。"
          />
          <PlanEditor planId={active.id} days={activeDays} exercisesByDay={exercisesByDay} />
        </div>
      )}
    </div>
  );
}
