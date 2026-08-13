"use client";

import { useActionState } from "react";
import { runAnalysis } from "@/lib/actions/analysis";
import type { AiAnalysis, AiAnalysisReport } from "@/lib/types/database";
import { r1, r2 } from "@/lib/utils/pr";
import { Card, EmptyState, Badge } from "@/components/ui";

const STATUS_COLOR: Record<string, "green" | "red" | "amber" | "neutral"> = {
  ok: "green",
  maintain: "green",
  increase: "amber",
  decrease: "amber",
  adjust: "amber",
  slow: "amber",
  fast: "red",
  poor: "red",
  unknown: "neutral",
};

export default function AnalysisRunner({ latest }: { latest: AiAnalysis | null }) {
  const [state, formAction, pending] = useActionState(runAnalysis, undefined);
  const report: AiAnalysisReport | undefined = state?.report ?? latest?.report;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">AI 综合分析</div>
            <div className="text-xs text-neutral-500">读取近 N 天的身体、饮食、训练数据，生成增肌进度评估与建议</div>
          </div>
          <form action={formAction}>
            <input type="hidden" name="days" value={7} />
            <button disabled={pending} className="btn btn-primary">
              {pending ? "AI 分析中（约10秒）..." : "分析最近 7 天"}
            </button>
          </form>
        </div>
        {state?.error && (
          <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-300">
            {state.error}
          </div>
        )}
      </Card>

      {report ? <ReportView report={report} created={latest?.created_at} /> : (
        <EmptyState title="还没有分析报告" hint="点击上方按钮生成第一份分析" />
      )}
    </div>
  );
}

function ReportView({ report, created }: { report: AiAnalysisReport; created?: string }) {
  const a = report.assessments;
  return (
    <>
      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-medium">分析摘要</div>
          {created && <span className="text-xs text-neutral-400">{new Date(created).toLocaleString("zh-CN")}</span>}
        </div>
        <p className="text-sm text-neutral-700 dark:text-neutral-200">{report.summary}</p>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
          <Metric label="体重变化" value={`${r2(report.metrics.weight_change_kg)} kg`} />
          <Metric label="腰围变化" value={`${r2(report.metrics.waist_change_cm)} cm`} />
          <Metric label="日均热量" value={report.metrics.avg_daily_calories ?? "—"} />
          <Metric label="日均蛋白" value={`${r1(report.metrics.avg_daily_protein_g)} g`} />
          <Metric label="训练天数" value={report.metrics.workout_sessions} />
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <AssessCard title="增肌速度" a={a.muscle_gain_rate} />
        <AssessCard title="热量调整" a={a.calorie_adjustment} />
        <AssessCard title="训练调整" a={a.training_adjustment} />
        <AssessCard title="恢复建议" a={a.recovery} />
      </div>

      <Card className="p-4">
        <div className="mb-2 text-sm font-medium">具体建议</div>
        <ul className="list-inside list-disc space-y-1.5 text-sm text-neutral-700 dark:text-neutral-200">
          {report.recommendations?.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      </Card>
    </>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-neutral-50 p-2 dark:bg-neutral-800/50">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-0.5 font-medium tabular-nums">{value}</div>
    </div>
  );
}

function AssessCard({ title, a }: { title: string; a: { status: string; detail: string } }) {
  return (
    <Card className="p-4">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-sm font-medium">{title}</span>
        <Badge color={STATUS_COLOR[a.status] || "neutral"}>{a.status}</Badge>
      </div>
      <p className="text-sm text-neutral-600 dark:text-neutral-300">{a.detail}</p>
    </Card>
  );
}
