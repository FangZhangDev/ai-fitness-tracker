"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parsePlan, aiGeneratePlan, savePlan } from "@/lib/actions/plan";
import { WEEKDAY_LABEL, type ParsedPlan, type Weekday } from "@/lib/types/database";
import { Card, Field } from "@/components/ui";

const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];

/**
 * 新建计划: 粘贴现成计划让 AI 解析, 或让 AI 结合身体数据与历史训练生成。
 * 两种方式都先出预览, 用户确认后才落库。
 */
export default function PlanCreator() {
  const [tab, setTab] = useState<"import" | "generate">("import");
  const [preview, setPreview] = useState<ParsedPlan | null>(null);

  return (
    <Card className="p-4">
      <div className="mb-4 flex gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-800">
        <TabBtn active={tab === "import"} onClick={() => { setTab("import"); setPreview(null); }}>
          粘贴导入
        </TabBtn>
        <TabBtn active={tab === "generate"} onClick={() => { setTab("generate"); setPreview(null); }}>
          让 AI 生成
        </TabBtn>
      </div>

      {preview ? (
        <PlanPreview plan={preview} onCancel={() => setPreview(null)} />
      ) : tab === "import" ? (
        <ImportForm onParsed={setPreview} />
      ) : (
        <GenerateForm onParsed={setPreview} />
      )}
    </Card>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-md px-3 py-1.5 text-sm transition ${
        active
          ? "bg-white font-medium shadow-sm dark:bg-neutral-950"
          : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// 粘贴导入
// ---------------------------------------------------------------------------
function ImportForm({ onParsed }: { onParsed: (p: ParsedPlan) => void }) {
  const [state, formAction, pending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const res = await parsePlan(prev, fd);
      if (res.plan) onParsed(res.plan);
      return res;
    },
    undefined,
  );

  return (
    <form action={formAction} className="space-y-3">
      <Field
        label="粘贴你的训练计划"
        hint="Markdown 表格、纯文本列表都行。也可以把 ChatGPT / Claude 给你的回复整段粘进来——多余的分析文字会被自动忽略，只提取计划部分。"
      >
        <textarea
          name="text"
          rows={10}
          required
          className="input font-mono text-xs"
          placeholder={`**周一：上肢 A，上胸 + 背厚 + 肩**

| 动作 | 组 × 次 | RIR | 休息 | 要点 | 器材 |
| --- | --- | --- | --- | --- | --- |
| 上斜推胸训练器 | 3 × 8–10 | 2 | 2–3分钟 | 上胸优先，肩胛后收下沉 | 上斜卧推训练器 |
...`}
        />
      </Field>
      <div className="flex items-center gap-3">
        <button disabled={pending} className="btn btn-primary">
          {pending ? "AI 解析中…" : "解析成计划"}
        </button>
        {state?.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// AI 生成
// ---------------------------------------------------------------------------
function GenerateForm({ onParsed }: { onParsed: (p: ParsedPlan) => void }) {
  const [state, formAction, pending] = useActionState(
    async (prev: unknown, fd: FormData) => {
      const res = await aiGeneratePlan(prev, fd);
      if (res.plan) onParsed(res.plan);
      return res;
    },
    undefined,
  );

  return (
    <form action={formAction} className="space-y-3">
      <Field label="打算哪几天练" hint="AI 只会在勾选的日子上排训练">
        <div className="mt-1 flex flex-wrap gap-1.5">
          {WEEKDAYS.map((d) => (
            <label
              key={d}
              className="cursor-pointer select-none rounded-lg border border-neutral-200 px-3 py-1.5 text-sm has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50 has-[:checked]:font-medium has-[:checked]:text-indigo-700 dark:border-neutral-700 dark:has-[:checked]:bg-indigo-950 dark:has-[:checked]:text-indigo-300"
            >
              <input type="checkbox" name="weekdays" value={d} className="sr-only" />
              {WEEKDAY_LABEL[d]}
            </label>
          ))}
        </div>
      </Field>

      <Field label="场地有什么器材" hint="写得越具体，AI 排的动作越能真的做得出来">
        <textarea
          name="equipment"
          rows={3}
          className="input"
          placeholder="哑铃 2.5-40kg、史密斯机、龙门架、高位下拉、坐姿划船、哈克深蹲机…"
        />
      </Field>

      <Field label="补充说明" hint="换场地、周期长度、想强化的部位、伤病避让等">
        <textarea
          name="request"
          rows={3}
          className="input"
          placeholder="过年回家两周，小区健身房只有哑铃和一台史密斯机，想保持住现在的围度，肩膀有点不舒服避开过顶推。"
        />
      </Field>

      <div className="flex items-center gap-3">
        <button disabled={pending} className="btn btn-primary">
          {pending ? "AI 编排中…" : "生成计划"}
        </button>
        {state?.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
      <p className="text-xs text-neutral-400">
        AI 会读取你的身高体重目标和历史动作成绩，尽量沿用你练过的动作；换了场地则挑功能相近的替代。
      </p>
    </form>
  );
}

// ---------------------------------------------------------------------------
// 预览与确认
// ---------------------------------------------------------------------------
function PlanPreview({ plan, onCancel }: { plan: ParsedPlan; onCancel: () => void }) {
  const [name, setName] = useState(plan.name);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const total = plan.days.reduce((s, d) => s + d.exercises.length, 0);

  function confirm() {
    setErr(null);
    start(async () => {
      const res = await savePlan(plan, name);
      if (res.error) setErr(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
        识别出 {plan.days.length} 个训练日、{total} 个动作。确认无误后保存，保存后会自动设为启用中。
      </div>

      <Field label="计划名称">
        <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
      </Field>

      <div className="space-y-3">
        {plan.days.map((d) => (
          <div key={d.weekday} className="rounded-lg border border-neutral-200 dark:border-neutral-800">
            <div className="border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
              <span className="font-medium">{WEEKDAY_LABEL[d.weekday]}</span>
              <span className="ml-2 text-sm text-neutral-500">{d.title}</span>
            </div>
            <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {d.exercises.map((e, i) => (
                <div key={i} className="px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <span className="font-medium">{e.exercise}</span>
                    <span className="tabular-nums text-neutral-500">{fmtSetsReps(e)}</span>
                    {e.rir_min !== null && (
                      <span className="text-neutral-400">RIR {fmtRange(e.rir_min, e.rir_max)}</span>
                    )}
                    {e.rest && <span className="text-neutral-400">休息 {e.rest}</span>}
                    {e.equipment && <span className="text-neutral-400">· {e.equipment}</span>}
                  </div>
                  {e.cues && <div className="mt-0.5 text-xs text-neutral-400">{e.cues}</div>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button onClick={confirm} disabled={pending} className="btn btn-primary">
          {pending ? "保存中…" : "确认保存并启用"}
        </button>
        <button onClick={onCancel} type="button" className="btn btn-ghost border border-neutral-200 dark:border-neutral-800">
          重新来过
        </button>
        {err && <span className="text-sm text-red-600">{err}</span>}
      </div>
    </div>
  );
}

export function fmtRange(min: number | null, max: number | null): string {
  if (min === null && max === null) return "—";
  if (min === null) return `${max}`;
  if (max === null || max === min) return `${min}`;
  return `${min}-${max}`;
}

export function fmtSetsReps(e: {
  target_sets: number | null;
  rep_min: number | null;
  rep_max: number | null;
}): string {
  const sets = e.target_sets !== null ? `${e.target_sets} 组` : "";
  const reps = e.rep_min !== null ? `× ${fmtRange(e.rep_min, e.rep_max)} 次` : "";
  return [sets, reps].filter(Boolean).join(" ") || "—";
}
