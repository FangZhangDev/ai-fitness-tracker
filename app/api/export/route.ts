// 数据导出接口
//   单表:   GET /api/export?table=X&format=csv|excel|json
//   全量包: GET /api/export?bundle=md|zip|json
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/utils/server";
import { toCSV, toExcel, toJSON, type Row } from "@/lib/utils/export";
import {
  buildMarkdownBundle,
  buildZipBundle,
  buildJsonBundle,
  type BundleData,
} from "@/lib/utils/export-bundle";

// 导出 Excel 与全量包都要在内存中拼装, 数据量大时较慢
export const maxDuration = 30;

const TABLES = {
  daily_metrics: "daily_metrics",
  meal_logs: "meal_logs",
  workout_logs: "workout_logs",
  ai_analyses: "ai_analyses",
} as const;

type TableName = keyof typeof TABLES;

export async function GET(request: NextRequest) {
  // 中间件的 matcher 排除了 /api, 所以这里是未登录请求的第一道关。
  // getCurrentUser 未登录时会抛, 不接住的话整个请求变成 500 —— 既误导人
  // (看着像服务挂了), 也在日志里刷无谓的异常。明确回 401。
  let auth: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    auth = await getCurrentUser();
  } catch {
    return new Response("未登录，请先登录后再导出", {
      status: 401,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const { supabase, userId } = auth;
  const { searchParams } = new URL(request.url);
  const bundle = searchParams.get("bundle") as "md" | "zip" | "json" | null;
  const table = searchParams.get("table") as TableName | null;
  const format = (searchParams.get("format") || "csv") as "csv" | "excel" | "json";

  // ---- 全量导出包 ----
  if (bundle) {
    if (!["md", "zip", "json"].includes(bundle)) {
      return NextResponse.json({ error: "无效的导出包类型" }, { status: 400 });
    }
    const data = await collectAll(supabase, userId);
    const exportedAt = new Date().toISOString().replace("T", " ").slice(0, 19);
    const stamp = new Date().toISOString().slice(0, 10);

    if (bundle === "md") {
      return new NextResponse(buildMarkdownBundle(data, exportedAt), {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="fitness_export_${stamp}.md"`,
        },
      });
    }
    if (bundle === "json") {
      return new NextResponse(buildJsonBundle(data, exportedAt), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="fitness_export_${stamp}.json"`,
        },
      });
    }
    const zipBuf = await buildZipBundle(data, exportedAt);
    return new NextResponse(new Uint8Array(zipBuf), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="fitness_export_${stamp}.zip"`,
      },
    });
  }

  if (!table || !(table in TABLES)) {
    return NextResponse.json({ error: "无效的表名" }, { status: 400 });
  }

  const { data, error } = await supabase.from(table).select("*").order("date", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows: Row[] = (data as Row[]) || [];
  const filename = `${table}_${new Date().toISOString().slice(0, 10)}`;

  if (format === "csv") {
    return new NextResponse(toCSV(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}.csv"`,
      },
    });
  }
  if (format === "json") {
    return new NextResponse(toJSON(rows), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}.json"`,
      },
    });
  }
  // excel
  const buf = await toExcel(rows, table);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
    },
  });
}

// ---------------------------------------------------------------------------
// 汇总全部数据 (供全量导出包使用)
// ---------------------------------------------------------------------------
type SupabaseClient = Awaited<ReturnType<typeof getCurrentUser>>["supabase"];

async function collectAll(supabase: SupabaseClient, userId: string): Promise<BundleData> {
  const [profile, metrics, meals, workouts, analyses, prs, nutrition, plans] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("daily_metrics").select("*").order("date", { ascending: true }),
    supabase.from("meal_logs").select("*").order("date", { ascending: true }),
    supabase.from("workout_logs").select("*").order("date", { ascending: true }),
    supabase.from("ai_analyses").select("*").order("created_at", { ascending: false }),
    supabase.from("v_exercise_pr").select("*").order("exercise"),
    supabase.from("v_daily_nutrition").select("*").order("date", { ascending: true }),
    supabase.from("workout_plans").select("*").order("is_active", { ascending: false }),
  ]);

  const planList = plans.data ?? [];
  const { data: days } = await supabase
    .from("plan_days")
    .select("*")
    .in("plan_id", planList.map((p) => p.id))
    .order("weekday");
  const dayList = days ?? [];
  const { data: exercises } = await supabase
    .from("plan_exercises")
    .select("*")
    .in("day_id", dayList.map((d) => d.id))
    .order("sort_order");
  const exList = exercises ?? [];

  return {
    profile: (profile.data as Row) ?? null,
    dailyMetrics: (metrics.data as Row[]) ?? [],
    mealLogs: (meals.data as Row[]) ?? [],
    workoutLogs: (workouts.data as Row[]) ?? [],
    aiAnalyses: (analyses.data as Row[]) ?? [],
    exercisePR: (prs.data as Row[]) ?? [],
    dailyNutrition: (nutrition.data as Row[]) ?? [],
    plans: planList.map((p) => ({
      name: p.name,
      is_active: p.is_active,
      days: dayList
        .filter((d) => d.plan_id === p.id)
        .map((d) => ({
          weekday: d.weekday,
          title: d.title,
          exercises: exList.filter((e) => e.day_id === d.id) as Row[],
        })),
    })),
  };
}
