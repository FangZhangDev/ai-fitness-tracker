import { SectionTitle, Card } from "@/components/ui";

const TABLES = [
  { key: "daily_metrics", label: "身体记录" },
  { key: "meal_logs", label: "饮食记录" },
  { key: "workout_logs", label: "训练记录" },
  { key: "ai_analyses", label: "AI 分析报告" },
];

const FORMATS = [
  { key: "csv", label: "CSV" },
  { key: "excel", label: "Excel" },
  { key: "json", label: "JSON" },
] as const;

export default function ExportPage() {
  return (
    <div className="space-y-4">
      <SectionTitle title="数据导出" desc="导出为 CSV / Excel / JSON，便于备份或交给其他 AI 分析" />
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-100 bg-neutral-50 text-left text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-800/50">
              <th className="px-4 py-2 font-medium">数据表</th>
              <th className="px-4 py-2 font-medium">导出格式</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {TABLES.map((t) => (
              <tr key={t.key}>
                <td className="px-4 py-3 font-medium">{t.label}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    {FORMATS.map((f) => (
                      <a
                        key={f.key}
                        href={`/api/export?table=${t.key}&format=${f.key}`}
                        className="rounded-md border border-neutral-200 px-3 py-1 text-xs text-neutral-600 transition hover:border-indigo-400 hover:text-indigo-600 dark:border-neutral-700 dark:text-neutral-300"
                      >
                        {f.label}
                      </a>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-neutral-400">
        提示：导出需要已登录。文件以 UTF-8 编码（CSV 含 BOM，Excel 可直接打开中文）。
      </p>
    </div>
  );
}
