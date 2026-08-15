import { getCurrentUser } from "@/lib/utils/server";
import { daysAgoISO } from "@/lib/utils/date";
import { r2 } from "@/lib/utils/pr";
import { SectionTitle, Card, EmptyState } from "@/components/ui";
import WorkoutsManager from "@/components/workouts-manager";
import StrengthChartSelector from "@/components/strength-chart-selector";
import TodayPlanLogger from "@/components/today-plan-logger";
import type { ExerciseLast, PlanDay, PlanExercise, Weekday } from "@/lib/types/database";

export const dynamic = "force-dynamic";

/** 今天是周几 (1=周一 ... 7=周日); JS 的 getDay() 里周日是 0, 这里换算成 ISO */
function todayWeekday(): Weekday {
  const d = new Date().getDay();
  return (d === 0 ? 7 : d) as Weekday;
}

export default async function WorkoutsPage() {
  const { supabase } = await getCurrentUser();
  const weekday = todayWeekday();

  const [list, prs, recent, activePlan, lastLogs] = await Promise.all([
    // 一行一组之后 100 行只够看两三次训练, 拉宽到 400 组 (约两个月)
    supabase
      .from("workout_logs")
      .select("*")
      .order("date", { ascending: false })
      .order("exercise", { ascending: true })
      .order("set_index", { ascending: true })
      .limit(400),
    supabase.from("v_exercise_pr").select("*").order("exercise", { ascending: true }),
    // 力量曲线读汇总视图: 直接画原始组会把一天的 4 组画成 4 个重叠的点
    supabase
      .from("v_exercise_sessions")
      .select("date,exercise,top_weight_kg,best_1rm_kg")
      .gte("date", daysAgoISO(89))
      .order("date", { ascending: true }),
    supabase.from("workout_plans").select("id").eq("is_active", true).maybeSingle(),
    supabase.from("v_exercise_last").select("*"),
  ]);

  // 取出启用计划里对应今天的训练日与动作
  let day: PlanDay | null = null;
  let planExercises: PlanExercise[] = [];
  if (activePlan.data) {
    const { data: d } = await supabase
      .from("plan_days")
      .select("*")
      .eq("plan_id", activePlan.data.id)
      .eq("weekday", weekday)
      .maybeSingle();
    day = d ?? null;
    if (day) {
      const { data: ex } = await supabase
        .from("plan_exercises")
        .select("*")
        .eq("day_id", day.id)
        .order("sort_order");
      planExercises = ex ?? [];
    }
  }

  const lastByExercise: Record<string, ExerciseLast> = {};
  for (const l of lastLogs.data ?? []) lastByExercise[l.exercise] = l;

  return (
    <div className="space-y-4">
      <SectionTitle title="训练记录" desc="按当天计划快速记录，自动追踪 PR 与力量增长" />

      <TodayPlanLogger
        weekday={weekday}
        day={day}
        exercises={planExercises}
        lastByExercise={lastByExercise}
        hasActivePlan={!!activePlan.data}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-3 text-sm font-medium">力量增长曲线（近90天）</div>
          <StrengthChartSelector logs={recent.data ?? []} />
        </Card>

        <Card className="p-4">
          <div className="mb-3 text-sm font-medium">各动作 PR</div>
          {prs.data && prs.data.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {prs.data.map((pr) => (
                <li key={pr.exercise} className="flex items-center justify-between">
                  <span>{pr.exercise}</span>
                  <span className="tabular-nums text-neutral-500">
                    最大 {r2(pr.max_weight_kg)}kg · 1RM {r2(pr.estimated_1rm_kg)}kg
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="暂无 PR 数据" hint="记录训练后自动计算" />
          )}
        </Card>
      </div>

      <WorkoutsManager list={list.data ?? []} />
    </div>
  );
}
