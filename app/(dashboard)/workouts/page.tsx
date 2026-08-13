import { getCurrentUser } from "@/lib/utils/server";
import { daysAgoISO } from "@/lib/utils/date";
import { r2 } from "@/lib/utils/pr";
import { SectionTitle, Card, EmptyState } from "@/components/ui";
import WorkoutsManager from "@/components/workouts-manager";
import StrengthChartSelector from "@/components/strength-chart-selector";

export const dynamic = "force-dynamic";

export default async function WorkoutsPage() {
  const { supabase } = await getCurrentUser();

  const [list, prs, recent] = await Promise.all([
    supabase.from("workout_logs").select("*").order("date", { ascending: false }).limit(100),
    supabase.from("v_exercise_pr").select("*").order("exercise", { ascending: true }),
    supabase
      .from("workout_logs")
      .select("date,exercise,weight_kg,reps")
      .gte("date", daysAgoISO(89))
      .order("date", { ascending: true }),
  ]);

  return (
    <div className="space-y-4">
      <SectionTitle title="训练记录" desc="记录每次训练，自动追踪 PR 与力量增长" />

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
