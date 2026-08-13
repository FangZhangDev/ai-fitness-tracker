import { getCurrentUser } from "@/lib/utils/server";
import { daysAgoISO } from "@/lib/utils/date";
import { SectionTitle, Card } from "@/components/ui";
import DailyMetricsManager from "@/components/daily-metrics-manager";
import WeightTrendChart from "@/components/charts/weight-trend-chart";

export const dynamic = "force-dynamic";

export default async function BodyPage() {
  const { supabase } = await getCurrentUser();

  const [list, trend] = await Promise.all([
    supabase.from("daily_metrics").select("*").order("date", { ascending: false }).limit(60),
    supabase
      .from("daily_metrics")
      .select("date,weight_kg,body_fat_pct,waist_cm")
      .gte("date", daysAgoISO(29))
      .order("date", { ascending: true }),
  ]);

  return (
    <div className="space-y-4">
      <SectionTitle title="身体记录" desc="每日体重、体脂、腰围、睡眠" />
      <Card className="p-4">
        <div className="mb-2 text-sm font-medium">体重趋势（近30天）</div>
        {trend.data && trend.data.length > 0 ? (
          <WeightTrendChart data={trend.data} />
        ) : (
          <div className="py-8 text-center text-sm text-neutral-400">记录后将自动生成趋势图</div>
        )}
      </Card>
      <DailyMetricsManager list={list.data ?? []} />
    </div>
  );
}
