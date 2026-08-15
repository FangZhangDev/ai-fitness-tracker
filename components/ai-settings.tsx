"use client";

// ============================================================================
// AI 供应商设置: 多套预设 + 一键切换 + 连通性测试
//
// 生效优先级在 lib/ai/client.ts: 激活的预设 > 环境变量。
// 这里改完不需要去别的页面刷新 -- 每次 AI 请求都实时读一次配置。
// ============================================================================

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Card, Field, runAction } from "@/components/ui";
import {
  savePreset,
  testPreset,
  activatePreset,
  deactivatePresets,
  deletePreset,
  type PresetView,
} from "@/lib/actions/settings";

/** 常用供应商快捷填充, 只是省打字, 填完仍然可以随意改 */
const TEMPLATES = [
  { name: "DeepSeek 官方", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { name: "Ollama 本地", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen2.5:7b" },
];

/** 页面(server)算好传下来的当前生效配置摘要 */
export type EffectiveInfo = {
  source: string; // 预设「xx」或 环境变量
  baseUrl: string;
  model: string;
  keyMasked: string;
  jsonMode: boolean;
  temperature: boolean;
  tools: boolean;
};

export default function AiSettings({
  presets,
  effective,
}: {
  presets: PresetView[];
  effective: EffectiveInfo;
}) {
  // null = 收起表单; "new" = 新建; 其它 = 正在编辑的预设 id
  const [editing, setEditing] = useState<string | null>(null);
  const [tpl, setTpl] = useState(TEMPLATES[0]);
  const [, formAction, pending] = useActionState(savePreset, undefined);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const router = useRouter();

  const editingPreset = presets.find((p) => p.id === editing) ?? null;
  const showForm = editing !== null;

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function runTest(form: HTMLFormElement) {
    setTesting(true);
    setTestResult(null);
    const res = await testPreset(undefined, new FormData(form));
    setTestResult(res.error ? `✗ ${res.error}` : `✓ 连通正常，模型回复: ${res.reply}`);
    setTesting(false);
  }

  const capability = (ok: boolean, label: string) =>
    ok ? null : <Badge color="amber">{label} 关</Badge>;

  return (
    <div className="space-y-4">
      {/* ---- 当前生效 ---- */}
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">当前生效</span>
          <Badge color="green">{effective.source}</Badge>
        </div>
        <div className="mt-2 grid gap-1 text-sm text-neutral-600 sm:grid-cols-2 dark:text-neutral-300">
          <div>模型：{effective.model || "(未配置)"}</div>
          <div>密钥：{effective.keyMasked}</div>
          <div className="truncate">接口：{effective.baseUrl || "(未配置)"}</div>
          <div className="flex items-center gap-1.5 pt-1">
            {capability(effective.jsonMode, "JSON 模式")}
            {capability(effective.temperature, "temperature")}
            {capability(effective.tools, "工具调用")}
          </div>
        </div>
        {!effective.tools && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            工具调用已关闭：AI 私教只能纯聊天，不能读数据、不能改计划（分析、营养估算等其它功能不受影响）。
          </p>
        )}
      </Card>

      {/* ---- 预设列表 ---- */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">我的配置（{presets.length}）</span>
          <button
            onClick={() => setEditing("new")}
            className="btn btn-primary px-3 py-1 text-sm"
          >
            + 新增配置
          </button>
        </div>

        {presets.length === 0 && !showForm && (
          <p className="mt-2 text-sm text-neutral-500">
            还没有保存的配置，当前走环境变量。加一套预设即可随时切换，不必再改环境变量重新部署。
          </p>
        )}

        <div className="mt-3 space-y-2">
          {presets.map((p) => (
            <div
              key={p.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{p.name}</span>
                  {p.isActive && (
                    <Badge color="green">生效中</Badge>
                  )}
                  {capability(p.jsonMode, "JSON")}
                  {capability(p.temperatureSupported, "temp")}
                  {capability(p.toolsSupported, "工具")}
                </div>
                <div className="mt-0.5 truncate text-xs text-neutral-500">
                  {p.model} · {p.baseUrl} · 密钥 {p.apiKeyMasked}
                </div>
              </div>
              <div className="flex shrink-0 gap-1.5 text-sm">
                {p.isActive ? (
                  <button
                    disabled={busy}
                    onClick={() => startTransition(() => runAction(deactivatePresets()).then(refresh))}
                    className="btn btn-ghost border border-neutral-200 px-2 py-1 dark:border-neutral-800"
                  >
                    停用
                  </button>
                ) : (
                  <button
                    disabled={busy}
                    onClick={() => {
                      const fd = new FormData();
                      fd.set("id", p.id);
                      startTransition(() => runAction(activatePreset(undefined, fd)).then(refresh));
                    }}
                    className="btn btn-primary px-2 py-1"
                  >
                    启用
                  </button>
                )}
                <button
                  onClick={() => {
                    setEditing(p.id);
                    setTestResult(null);
                  }}
                  className="btn btn-ghost border border-neutral-200 px-2 py-1 dark:border-neutral-800"
                >
                  编辑
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    const fd = new FormData();
                    fd.set("id", p.id);
                    startTransition(() => runAction(deletePreset(undefined, fd)).then(refresh));
                  }}
                  className="btn btn-ghost border border-neutral-200 px-2 py-1 text-red-600 dark:border-neutral-800 dark:text-red-400"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* ---- 新增 / 编辑表单 ---- */}
      {showForm && (
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium">{editingPreset ? `编辑「${editingPreset.name}」` : "新增配置"}</span>
            <button onClick={() => setEditing(null)} className="btn btn-ghost px-2 py-1 text-sm">
              收起
            </button>
          </div>

          {!editingPreset && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {TEMPLATES.map((t) => (
                <button
                  key={t.name}
                  onClick={() => setTpl(t)}
                  className={`rounded-full border px-2.5 py-0.5 text-xs ${
                    tpl.name === t.name
                      ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-300"
                      : "border-neutral-200 text-neutral-500 dark:border-neutral-800"
                  }`}
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}

          <form
            action={(fd) => {
              formAction(fd);
              // 保存成功(无 error)后收起表单。useActionState 拿不到这里的返回值,
              // 但保存失败时页面不会 revalidate, 列表不变; 简单起见统一收起,
              // 失败的 toast 会告诉用户, 再点编辑仍在。
              setEditing(null);
            }}
            className="space-y-3"
          >
            <input type="hidden" name="id" value={editingPreset?.id ?? ""} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="配置名称">
                <input
                  name="name"
                  defaultValue={editingPreset?.name ?? tpl.name}
                  className="input"
                  placeholder="如 DeepSeek 官方"
                  required
                />
              </Field>
              <Field label="模型名">
                <input
                  name="model"
                  defaultValue={editingPreset?.model ?? tpl.model}
                  className="input"
                  placeholder="如 deepseek-chat"
                  required
                />
              </Field>
            </div>
            <Field label="接口地址 (OpenAI 兼容)">
              <input
                name="base_url"
                defaultValue={editingPreset?.baseUrl ?? tpl.baseUrl}
                className="input"
                placeholder="https://api.deepseek.com/v1"
                required
              />
            </Field>
            <Field
              label="API 密钥"
              hint={editingPreset ? `当前: ${editingPreset.apiKeyMasked}，留空即保留` : "本地服务不需要可留空"}
            >
              <input
                name="api_key"
                type="password"
                className="input"
                placeholder={editingPreset ? "留空保留原密钥" : "sk-..."}
                autoComplete="off"
              />
            </Field>

            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" name="json_mode" defaultChecked={editingPreset?.jsonMode ?? true} className="h-3.5 w-3.5 accent-indigo-600" />
                JSON 模式
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" name="temperature_supported" defaultChecked={editingPreset?.temperatureSupported ?? true} className="h-3.5 w-3.5 accent-indigo-600" />
                temperature
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" name="tools_supported" defaultChecked={editingPreset?.toolsSupported ?? true} className="h-3.5 w-3.5 accent-indigo-600" />
                工具调用
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" name="activate" defaultChecked={!presets.some((p) => p.isActive)} className="h-3.5 w-3.5 accent-indigo-600" />
                保存后立即启用
              </label>
            </div>
            <p className="text-xs text-neutral-400">
              不确定开关含义就保持全开（OpenAI / DeepSeek 均支持）。换本地或推理类模型报参数错误时，再回来关对应的一项。
            </p>

            <div className="flex items-center gap-3">
              <button type="submit" disabled={pending} className="btn btn-primary">
                {pending ? "保存中…" : "保存"}
              </button>
              <button
                type="button"
                disabled={testing}
                onClick={(e) => runTest(e.currentTarget.form!)}
                className="btn btn-ghost border border-neutral-200 dark:border-neutral-800"
              >
                {testing ? "测试中…" : "测试连通"}
              </button>
              {testResult && (
                <span className={`text-sm ${testResult.startsWith("✓") ? "text-emerald-600" : "text-red-600"}`}>
                  {testResult}
                </span>
              )}
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
