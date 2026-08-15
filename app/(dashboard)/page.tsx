import Link from "next/link";
import { getCurrentUser } from "@/lib/utils/server";
import { daysAgoISO, todayISO, fmtDate } from "@/lib/utils/date";
import { r1, r2 } from "@/lib/utils/pr";
import { Card, Stat, SectionTitle, EmptyState } from "@/components/ui";
import WeightTrendChart from "@/components/charts/weight-trend-chart";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { supabase, userId } = await getCurrentUser();

  const [profile, latestMetric, todayNutrition, recentMetrics, recentWorkouts, latestAnalysis] =
    await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).single(),
      supabase
        .from("daily_metrics")
        .select("*")
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("v_daily_nutrition")
        .select("*")
        .eq("date", todayISO())
        .maybeSingle(),
      supabase
        .from("daily_metrics")
        .select("date,weight_kg,body_fat_pct,waist_cm")
        .gte("date", daysAgoISO(13))
        .order("date", { ascending: true }),
      // 读汇总视图而不是原始组: 一天一个动作一条, 既够数训练天数, 也够列近期训练
      supabase
        .from("v_exercise_sessions")
        .select("date,exercise,sets,top_weight_kg,total_reps,best_1rm_kg")
        .gte("date", daysAgoISO(6))
        .order("date", { ascending: false }),
      supabase
        .from("ai_analyses")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const p = profile.data;
  const weight = latestMetric.data?.weight_kg ?? p?.current_weight_kg ?? null;
  const workoutDays = new Set(recentWorkouts.data?.map((w) => w.date)).size;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="概览"
        desc={p ? `目标：${p.goal || "未设定"}` : undefined}
        action={
          <Link href="/analysis" className="btn btn-primary">
            AI 分析
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="当前体重"
          value={r2(weight)}
          unit="kg"
          // 没设目标就不显示第二行, 不要留一个孤零零的破折号
          sub={p?.target_weight_kg ? `目标 ${r2(p.target_weight_kg)} kg` : undefined}
        />
        <Stat label="今日热量" value={todayNutrition.data?.total_calories ?? "—"} unit="kcal" />
        <Stat label="今日蛋白" value={r1(todayNutrition.data?.total_protein_g)} unit="g" />
        <Stat label="近7天训练" value={workoutDays} unit="天" sub="有训练记录的天数" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-3 text-sm font-medium">体重趋势（近14天）</div>
          {recentMetrics.data && recentMetrics.data.length > 0 ? (
            <WeightTrendChart data={recentMetrics.data} />
          ) : (
            <EmptyState title="暂无身体记录" hint="去「身体」页面记录今日体重" action={<Link href="/body" className="btn btn-ghost border border-neutral-200 text-xs dark:border-neutral-800">去记录</Link>} />
          )}
        </Card>

        <Card className="p-4">
          <div className="mb-3 text-sm font-medium">近期训练</div>
          {recentWorkouts.data && recentWorkouts.data.length > 0 ? (
            <ul className="space-y-2">
              {recentWorkouts.data.slice(0, 6).map((w, i) => (
                <li key={i} className="flex items-center justify-between text-sm">
                  <span className="truncate">
                    <span className="text-neutral-400">{fmtDate(w.date)}</span> {w.exercise}
                  </span>
                  <span className="tabular-nums text-neutral-500">
                    {r2(w.top_weight_kg)}kg × {w.sets}组 <span className="text-neutral-400">(1RM≈{r2(w.best_1rm_kg)})</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="暂无训练记录" hint="去「训练」页面记录今日训练" action={<Link href="/workouts" className="btn btn-ghost border border-neutral-200 text-xs dark:border-neutral-800">去记录</Link>} />
          )}
        </Card>
      </div>

      {latestAnalysis.data && (
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-medium">最近 AI 分析</div>
            <Link href="/analysis" className="text-xs text-indigo-600">查看全部 →</Link>
          </div>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            {latestAnalysis.data.report?.summary}
          </p>
        </Card>
      )}
    </div>
  );
}
