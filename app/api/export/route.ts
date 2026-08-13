// 数据导出接口: GET /api/export?table=X&format=csv|excel|json
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/utils/server";
import { toCSV, toExcel, toJSON, type Row } from "@/lib/utils/export";

const TABLES = {
  daily_metrics: "daily_metrics",
  meal_logs: "meal_logs",
  workout_logs: "workout_logs",
  ai_analyses: "ai_analyses",
} as const;

type TableName = keyof typeof TABLES;

export async function GET(request: NextRequest) {
  const { supabase } = await getCurrentUser();
  const { searchParams } = new URL(request.url);
  const table = searchParams.get("table") as TableName | null;
  const format = (searchParams.get("format") || "csv") as "csv" | "excel" | "json";

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
