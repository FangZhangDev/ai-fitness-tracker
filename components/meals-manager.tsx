"use client";

import { useActionState, useRef, useState } from "react";
import { createMeal, reanalyzeMeal, deleteMeal } from "@/lib/actions/meals";
import {
  createMealTemplate,
  updateMealTemplate,
  deleteMealTemplate,
  touchMealTemplate,
} from "@/lib/actions/meal-templates";
import { todayISO, fmtDateLong } from "@/lib/utils/date";
import { r1 } from "@/lib/utils/pr";
import type { MealLog, MealTemplate } from "@/lib/types/database";
import { SLOT_LABEL, type MealSlot, type NutritionItem } from "@/lib/ai/nutrition";
import { Card, Field, EmptyState, Badge, MEAL_TYPE_LABEL, runAction } from "@/components/ui";

/**
 * 从 ai_raw 里取逐项明细。
 * 老记录(改成逐项之前存的)没有 items, 返回空数组, 界面就不显示明细。
 */
function itemsOf(raw: unknown): NutritionItem[] {
  if (!raw || typeof raw !== "object") return [];
  const list = (raw as { items?: unknown }).items;
  return Array.isArray(list) ? (list as NutritionItem[]) : [];
}

/** 取最近可套用的「全天」饮食: 排除今天, 每天只留一条, 最多 7 条 */
function pickRecent(list: MealLog[]): MealLog[] {
  const today = todayISO();
  const seen = new Set<string>();
  const out: MealLog[] = [];
  for (const m of list) {
    if (m.meal_type !== "all_day" || m.date === today) continue;
    if (!m.description.trim() || seen.has(m.date)) continue;
    seen.add(m.date);
    out.push(m);
    if (out.length >= 7) break;
  }
  return out;
}

export default function MealsManager({
  list,
  templates = [],
}: {
  list: MealLog[];
  templates?: MealTemplate[];
}) {
  const [state, formAction, pending] = useActionState(createMeal, undefined);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const typeRef = useRef<HTMLSelectElement>(null);
  const [savingTpl, setSavingTpl] = useState(false);
  const [managing, setManaging] = useState(false);
  const [tplName, setTplName] = useState("");
  const [tplErr, setTplErr] = useState<string | null>(null);
  const [tplBusy, setTplBusy] = useState(false);
  // list 已按日期倒序, 直接顺着取即可
  const recent = pickRecent(list);

  /** 把选中的文本填进输入框, 光标落到末尾便于接着改 */
  function fill(text: string) {
    const el = descRef.current;
    if (!el) return;
    el.value = text;
    el.focus();
    el.setSelectionRange(text.length, text.length);
  }

  /**
   * 用一个常吃套餐: 填入 + 记一次使用(纯统计, 失败不打扰用户)。
   * 名字别以 use 开头 —— react-hooks 的 lint 会把它当成自定义 Hook。
   */
  function applyTemplate(t: MealTemplate) {
    fill(t.description);
    void touchMealTemplate(t.id);
  }

  /**
   * 把当前输入框里的描述存成模板。
   * 不用 <form> 是因为描述在主表单的 textarea 里, HTML 不允许表单嵌套,
   * 直接读 ref 再自己拼 FormData 最省事。
   */
  async function saveTemplate() {
    const desc = descRef.current?.value.trim() ?? "";
    if (!desc) {
      setTplErr("上面的输入框还是空的");
      return;
    }
    setTplBusy(true);
    const fd = new FormData();
    fd.set("name", tplName);
    fd.set("description", desc);
    fd.set("meal_type", typeRef.current?.value ?? "all_day");
    const res = await createMealTemplate(undefined, fd);
    setTplBusy(false);
    if (res?.error) {
      setTplErr(res.error);
      return;
    }
    setTplErr(null);
    setTplName("");
    setSavingTpl(false);
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="mb-2 text-sm text-neutral-500">
          💡 用自然语言描述就行，AI 会自动估算卡路里与三大营养素。
          默认「全天」——把今天吃的一次性写完最省事，不用一餐餐分开录。
        </div>
        <form action={formAction} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="日期">
              <input name="date" type="date" defaultValue={todayISO()} className="input" required />
            </Field>
            <Field label="餐次" hint="想单独记某一餐再改这里">
              <select ref={typeRef} name="meal_type" defaultValue="all_day" className="input">
                {Object.entries(MEAL_TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </Field>
            <div className="col-span-2">
              <Field label="吃了什么">
                {/* 常吃套餐: 日常饮食其实是几个固定组合轮着来, 比翻最近某天更准 */}
                {templates.length > 0 && (
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="shrink-0 text-xs text-neutral-400">常吃：</span>
                    {templates.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => applyTemplate(t)}
                        title={t.description}
                        className="max-w-[16rem] truncate rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 transition hover:border-indigo-400 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-300 dark:hover:border-indigo-600"
                      >
                        {t.name}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setManaging((v) => !v)}
                      className="shrink-0 text-xs text-neutral-400 underline-offset-2 hover:underline"
                    >
                      {managing ? "收起" : "管理"}
                    </button>
                  </div>
                )}

                {/* 管理面板: 改名、改内容、删除。
                    这里绝不能用 <form> —— 整块都在主表单(创建饮食)内部, HTML 不允许
                    表单嵌套, 浏览器会把内层 form 拆掉: 按钮变成主表单的提交按钮,
                    而 name="description" 还会排在主表单的 textarea 前面被 get() 优先取到。
                    一律用 type="button" + 手工拼 FormData 调 action。 */}
                {managing && templates.length > 0 && (
                  <div className="mb-2 space-y-1.5 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
                    {templates.map((t) => (
                      <TemplateRow key={t.id} tpl={t} />
                    ))}
                    <p className="text-xs text-neutral-400">
                      用得多的会自动排前面。营养值不存进模板——每次提交都按当天实际描述重新估算。
                    </p>
                  </div>
                )}

                {/* 套用最近某天: 补充手段, 应对「昨天吃的还行, 今天照抄」 */}
                {recent.length > 0 && (
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="shrink-0 text-xs text-neutral-400">套用最近：</span>
                    {recent.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => fill(m.description)}
                        title={m.description}
                        className="max-w-[16rem] truncate rounded-full border border-neutral-200 px-2.5 py-1 text-xs text-neutral-600 transition hover:border-indigo-400 hover:text-indigo-600 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-indigo-500 dark:hover:text-indigo-400"
                      >
                        {m.date.slice(5)} · {m.description}
                      </button>
                    ))}
                  </div>
                )}
                <textarea
                  ref={descRef}
                  name="description"
                  rows={3}
                  className="input"
                  placeholder="早上三个鸡蛋一个肉包一碗豆浆，中午两碗米饭一份红烧肉一份青菜，下午一个苹果一杯蛋白粉，晚上一碗面条加两个荷包蛋"
                  required
                />
                {/* 存成模板: 名字留空就拿描述前 12 字兜底, 不为了起名把人卡住 */}
                {savingTpl ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <input
                      value={tplName}
                      onChange={(e) => setTplName(e.target.value)}
                      placeholder="起个名，留空就取描述前 12 字"
                      className="input w-56 px-2 py-1 text-xs"
                    />
                    <button
                      type="button"
                      onClick={saveTemplate}
                      disabled={tplBusy}
                      className="btn btn-primary px-2 py-1 text-xs"
                    >
                      {tplBusy ? "保存中…" : "保存"}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setSavingTpl(false); setTplErr(null); }}
                      className="btn btn-ghost px-2 py-1 text-xs"
                    >
                      取消
                    </button>
                    {tplErr && <span className="text-xs text-red-600">{tplErr}</span>}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSavingTpl(true)}
                    className="mt-1.5 text-xs text-neutral-400 underline-offset-2 hover:text-indigo-600 hover:underline"
                  >
                    ★ 把上面这段存为常吃套餐
                  </button>
                )}
              </Field>
            </div>
          </div>
          {state?.error && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-300">{state.error}</div>
          )}
          <button disabled={pending} className="btn btn-primary">
            {pending ? "AI 分析中..." : "+ 添加并分析"}
          </button>
        </form>
      </Card>

      {list.length === 0 ? (
        <EmptyState title="暂无饮食记录" hint="在上方描述今天的饮食" />
      ) : (
        <Card className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {list.map((m) => (
            <div key={m.id} className="p-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium tabular-nums">{fmtDateLong(m.date)}</span>
                <Badge color="indigo">{MEAL_TYPE_LABEL[m.meal_type]}</Badge>
                {m.analyzed_at ? <Badge color="green">已分析</Badge> : <Badge color="amber">待分析</Badge>}
                <div className="ml-auto flex gap-1">
                  <form action={async (fd) => { await runAction(reanalyzeMeal(fd)); }}>
                    <input type="hidden" name="id" value={m.id} />
                    <input type="hidden" name="description" value={m.description} />
                    <input type="hidden" name="meal_type" value={m.meal_type} />
                    <button className="btn btn-ghost px-2 py-1 text-xs">重分析</button>
                  </form>
                  <form action={async (fd) => { await runAction(deleteMeal(fd)); }}>
                    <input type="hidden" name="id" value={m.id} />
                    <button className="btn btn-danger px-2 py-1 text-xs">删除</button>
                  </form>
                </div>
              </div>
              <div className="mt-1 text-sm">{m.description}</div>
              {m.analyzed_at && (
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs tabular-nums text-neutral-500">
                  <span>热量 <b className="text-neutral-700 dark:text-neutral-200">{m.calories}</b> kcal</span>
                  <span>蛋白 <b className="text-neutral-700 dark:text-neutral-200">{r1(m.protein_g)}</b> g</span>
                  <span>碳水 <b className="text-neutral-700 dark:text-neutral-200">{r1(m.carbs_g)}</b> g</span>
                  <span>脂肪 <b className="text-neutral-700 dark:text-neutral-200">{r1(m.fat_g)}</b> g</span>
                </div>
              )}

              {/* 逐项明细: 估得离谱时能当场看出是哪一项、按什么份量算的 */}
              <MealItems items={itemsOf(m.ai_raw)} />
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

/**
 * AI 的逐项明细, 按餐次分组并给出每餐小计。
 * 老记录(没有 items)整块不渲染; 更老的记录有 items 但没有 slot, 会全落在「其它」。
 */
const SLOT_ORDER: MealSlot[] = ["breakfast", "lunch", "snack", "dinner", "other"];

function MealItems({ items }: { items: NutritionItem[] }) {
  if (!items.length) return null;

  const groups = SLOT_ORDER.map((slot) => ({
    slot,
    rows: items.filter((it) => (it.slot ?? "other") === slot),
  })).filter((g) => g.rows.length > 0);

  const subtotal = (rows: NutritionItem[]) =>
    rows.reduce(
      (a, it) => ({
        c: a.c + (it.calories || 0),
        p: a.p + (it.protein_g || 0),
      }),
      { c: 0, p: 0 },
    );

  return (
    <details className="mt-1.5">
      <summary className="cursor-pointer text-xs text-neutral-400 hover:text-indigo-600">
        明细（{groups.length > 1 ? `${groups.length} 餐 · ` : ""}
        {items.length} 项）
      </summary>
      <div className="mt-1 overflow-x-auto">
        <table className="w-full min-w-[28rem] text-xs tabular-nums">
          <thead className="text-neutral-400">
            <tr>
              <th className="py-0.5 text-left font-normal">食物</th>
              <th className="py-0.5 text-left font-normal">AI 假设份量</th>
              <th className="py-0.5 text-right font-normal">kcal</th>
              <th className="py-0.5 text-right font-normal">蛋白</th>
              <th className="py-0.5 text-right font-normal">碳水</th>
              <th className="py-0.5 text-right font-normal">脂肪</th>
            </tr>
          </thead>
          {groups.map((g) => {
            const st = subtotal(g.rows);
            return (
              <tbody key={g.slot} className="text-neutral-600 dark:text-neutral-300">
                <tr className="border-t border-neutral-200 dark:border-neutral-700">
                  <td colSpan={2} className="py-0.5 font-medium text-neutral-500">
                    {SLOT_LABEL[g.slot]}
                  </td>
                  <td className="py-0.5 text-right text-neutral-400">{st.c}</td>
                  <td className="py-0.5 text-right text-neutral-400">{r1(st.p)}</td>
                  <td colSpan={2} />
                </tr>
                {g.rows.map((it, i) => (
                  <tr key={i}>
                    <td className="py-0.5 pr-2 pl-3">{it.name}</td>
                    <td className="py-0.5 pr-2 text-neutral-400">{it.grams}</td>
                    <td className="py-0.5 text-right">{it.calories}</td>
                    <td className="py-0.5 text-right">{r1(it.protein_g)}</td>
                    <td className="py-0.5 text-right">{r1(it.carbs_g)}</td>
                    <td className="py-0.5 text-right">{r1(it.fat_g)}</td>
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
        <p className="mt-1 text-xs text-neutral-400">
          份量是 AI 假设的。差得多就把描述写具体些（如「隆江猪脚饭 大份」），再点「重分析」。
        </p>
      </div>
    </details>
  );
}

/** 管理面板里的一行: 改名 / 改内容 / 删除。不用 <form>, 理由见调用处注释 */
function TemplateRow({ tpl }: { tpl: MealTemplate }) {
  const [name, setName] = useState(tpl.name);
  const [desc, setDesc] = useState(tpl.description);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const dirty = name !== tpl.name || desc !== tpl.description;

  async function save() {
    setBusy(true);
    setMsg(null);
    const fd = new FormData();
    fd.set("id", tpl.id);
    fd.set("name", name);
    fd.set("description", desc);
    const res = await updateMealTemplate(fd);
    setBusy(false);
    setMsg(res?.error ?? "已保存");
  }

  async function remove() {
    setBusy(true);
    const fd = new FormData();
    fd.set("id", tpl.id);
    const res = await deleteMealTemplate(fd);
    setBusy(false);
    setConfirming(false);
    if (res?.error) setMsg(res.error);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input
        value={name}
        onChange={(e) => { setName(e.target.value); setMsg(null); }}
        placeholder="名字"
        className="input w-28 shrink-0 px-2 py-1 text-xs"
      />
      <input
        value={desc}
        onChange={(e) => { setDesc(e.target.value); setMsg(null); }}
        placeholder="描述"
        className="input min-w-0 flex-1 px-2 py-1 text-xs"
      />
      <button
        type="button"
        onClick={save}
        disabled={busy || !dirty}
        className="btn btn-ghost shrink-0 px-2 py-1 text-xs disabled:opacity-40"
      >
        {busy ? "…" : "保存"}
      </button>
      {confirming ? (
        <>
          <span className="text-xs text-red-600">删掉「{tpl.name}」？</span>
          <button type="button" onClick={remove} disabled={busy} className="btn btn-danger px-2 py-1 text-xs">
            确定
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="btn btn-ghost px-2 py-1 text-xs">
            取消
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="btn btn-ghost shrink-0 px-2 py-1 text-xs text-red-600"
        >
          删除
        </button>
      )}
      {msg && (
        <span className={"text-xs " + (msg === "已保存" ? "text-green-600" : "text-red-600")}>
          {msg}
        </span>
      )}
    </div>
  );
}
