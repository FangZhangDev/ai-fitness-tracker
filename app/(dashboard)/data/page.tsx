import { getCurrentUser } from "@/lib/utils/server";
import { SectionTitle } from "@/components/ui";
import DataManager, { type DayGroup } from "@/components/data-manager";
import type { DailyMetric, MealLog, WorkoutLog } from "@/lib/types/database";

export const dynamic = "force-dynamic";

/** 一次最多回看多少天, 避免记录多了以后页面过长 */
const DAYS_LIMIT = 60;

export default async function DataPage() {
  const { supabase } = await getCurrentUser();

  const [metrics, meals, workouts] = await Promise.all([
    supabase.from("daily_metrics").select("*").order("date", { ascending: false }).limit(300),
    supabase.from("meal_logs").select("*").order("date", { ascending: false }).limit(500),
    supabase.from("workout_logs").select("*").order("date", { ascending: false }).limit(800),
  ]);

  // 按日期归拢成一天一组
  const byDate = new Map<string, DayGroup>();
  const bucket = (date: string) => {
    let g = byDate.get(date);
    if (!g) {
      g = { date, metrics: [], meals: [], workouts: [] };
      byDate.set(date, g);
    }
    return g;
  };
  for (const m of (metrics.data ?? []) as DailyMetric[]) bucket(m.date).metrics.push(m);
  for (const m of (meals.data ?? []) as MealLog[]) bucket(m.date).meals.push(m);
  for (const w of (workouts.data ?? []) as WorkoutLog[]) bucket(w.date).workouts.push(w);

  const days = [...byDate.values()]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, DAYS_LIMIT);

  return (
    <div className="space-y-4">
      <SectionTitle
        title="数据管理"
        desc={`把每天的身体、饮食、训练记录放在一起，方便检查和清理。最多显示最近 ${DAYS_LIMIT} 天。`}
      />
      <DataManager days={days} />
      <p className="text-xs text-neutral-400">
        删除不可撤销。担心误删的话，先去「数据导出」下载一份备份。
      </p>
    </div>
  );
}
