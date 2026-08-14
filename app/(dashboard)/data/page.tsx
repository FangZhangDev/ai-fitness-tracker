import { getCurrentUser } from "@/lib/utils/server";
import { SectionTitle } from "@/components/ui";
import DataManager, { type DayGroup } from "@/components/data-manager";
import DataFilter from "@/components/data-filter";
import { resolveRange, type RangeKey } from "@/lib/utils/date";
import type { DataKind } from "@/lib/actions/data";
import type { DailyMetric, MealLog, WorkoutLog } from "@/lib/types/database";

export const dynamic = "force-dynamic";

const ALL_KINDS: DataKind[] = ["daily_metrics", "meal_logs", "workout_logs"];
const VALID_RANGES: RangeKey[] = ["7d", "30d", "month", "3m", "year", "all", "custom"];

/**
 * 单表最多取多少行。
 * 范围本身已经收敛了数据量, 这个上限只是兜底 —— 选「全部」且记录攒了几年时,
 * 不至于一次把整库拉进内存。
 */
const ROW_LIMIT = 2000;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function DataPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase } = await getCurrentUser();
  const sp = await searchParams;

  // ---- 解析筛选条件 (全部来自 URL, 刷新/后退都能保住视图) ----
  const rawRange = one(sp.range) as RangeKey | undefined;
  const range: RangeKey =
    rawRange && VALID_RANGES.includes(rawRange) ? rawRange : "30d";
  const { from, to } = resolveRange(range, one(sp.from), one(sp.to));

  const rawKinds = sp.kind
    ? (Array.isArray(sp.kind) ? sp.kind : [sp.kind]).filter((k): k is DataKind =>
        (ALL_KINDS as string[]).includes(k)
      )
    : [];
  const kinds: DataKind[] = rawKinds.length ? rawKinds : ALL_KINDS;

  // ---- 按范围取数; 没勾的类型直接不查, 省一次往返 ----
  const q = (kind: DataKind) =>
    supabase
      .from(kind)
      .select("*")
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: false })
      .limit(ROW_LIMIT);

  const [metrics, meals, workouts] = await Promise.all([
    kinds.includes("daily_metrics") ? q("daily_metrics") : Promise.resolve({ data: [] }),
    kinds.includes("meal_logs") ? q("meal_logs") : Promise.resolve({ data: [] }),
    kinds.includes("workout_logs") ? q("workout_logs") : Promise.resolve({ data: [] }),
  ]);

  // ---- 按日期归拢成一天一组 ----
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

  const days = [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  const total = days.reduce(
    (n, d) => n + d.metrics.length + d.meals.length + d.workouts.length,
    0
  );

  return (
    <div className="space-y-4">
      <SectionTitle
        title="数据管理"
        desc="按时间范围和类型挑出记录，勾选后批量删除；也可以整天清空或单条删除。"
      />

      <DataFilter
        range={range}
        // 「全部」的下界是个占位日期, 不该塞进日期输入框里当默认值
        from={from === "1970-01-01" ? "" : from}
        to={to}
        kinds={kinds}
        total={total}
      />

      {/* key 让筛选一变就重建组件, 免得旧的勾选残留到新结果上 */}
      <DataManager key={`${range}-${from}-${to}-${kinds.join(",")}`} days={days} />

      <p className="text-xs text-neutral-400">
        删除不可撤销。担心误删的话，先去「数据导出」下载一份备份。
      </p>
    </div>
  );
}
