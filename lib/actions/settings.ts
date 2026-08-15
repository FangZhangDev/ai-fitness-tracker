"use server";

// ============================================================================
// AI 供应商预设的增删改与连通性测试
//
// 密钥安全: 表里存明文(RLS 隔离), 但任何返回给前端的地方都只给掩码。
// 编辑时密钥留空 = 保留原值, 前端从头到尾拿不到完整密钥。
// ============================================================================

import { revalidatePath } from "next/cache";
import OpenAI from "openai";
import { getCurrentUser } from "@/lib/utils/server";
import type { AiPreset } from "@/lib/types/database";

export type ActionResult = { error?: string };

/** 给前端展示用的预设(密钥已掩码) */
export type PresetView = {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyMasked: string;
  model: string;
  jsonMode: boolean;
  temperatureSupported: boolean;
  toolsSupported: boolean;
  isActive: boolean;
};

/** 注意: 本文件是 "use server", 导出必须全是 async 函数(类型除外),
 * 所以掩码逻辑只在这里内部用, 不导出。 */
function maskKey(key: string): string {
  if (!key) return "未设置";
  if (key.length <= 8) return "***";
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

/** 服务端查询 + 掩码, 页面直接调用(不是 action) */
export async function presetViews(): Promise<PresetView[]> {
  const { supabase, userId } = await getCurrentUser();
  const { data } = await supabase
    .from("ai_presets")
    .select("*")
    .eq("user_id", userId)
    .order("is_active", { ascending: false })
    .order("created_at");
  return (data ?? []).map(toView);
}

function toView(p: AiPreset): PresetView {
  return {
    id: p.id,
    name: p.name,
    baseUrl: p.base_url,
    apiKeyMasked: maskKey(p.api_key),
    model: p.model,
    jsonMode: p.json_mode,
    temperatureSupported: p.temperature_supported,
    toolsSupported: p.tools_supported,
    isActive: p.is_active,
  };
}

function str(v: FormDataEntryValue | null): string {
  return (v?.toString() ?? "").trim();
}
function on(v: FormDataEntryValue | null): boolean {
  return str(v) === "on" || str(v) === "1";
}

// ============================================================================
// 保存(新增或编辑)
// ============================================================================
export async function savePreset(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const { supabase, userId } = await getCurrentUser();

  const id = str(formData.get("id"));
  const name = str(formData.get("name"));
  const baseUrl = str(formData.get("base_url")).replace(/\/+$/, ""); // 尾部斜杠容忍
  const model = str(formData.get("model"));
  const apiKey = str(formData.get("api_key"));
  const activate = on(formData.get("activate"));

  if (!name) return { error: "给这套配置起个名字" };
  if (!/^https?:\/\/.+/.test(baseUrl)) return { error: "接口地址要以 http(s):// 开头" };
  if (!model) return { error: "填写模型名" };
  if (!id && !apiKey && !/localhost|127\.|192\.168\.|10\.|内网/.test(baseUrl)) {
    // 不强制: 公网服务理论上也可能走 IP 白名单免鉴权, 但 99% 是忘了填
    return { error: "公网接口一般需要密钥; 确实不需要就随便填一个占位" };
  }

  const flags = {
    json_mode: on(formData.get("json_mode")),
    temperature_supported: on(formData.get("temperature_supported")),
    tools_supported: on(formData.get("tools_supported")),
  };

  try {
    if (id) {
      // 编辑: 密钥留空 = 保留原值, 绝不能把空串写进去覆盖
      const patch: Partial<AiPreset> = {
        name,
        base_url: baseUrl,
        model,
        ...flags,
      };
      if (apiKey) patch.api_key = apiKey;
      const { error } = await supabase
        .from("ai_presets")
        .update(patch)
        .eq("id", id)
        .eq("user_id", userId);
      if (error) {
        if (error.code === "23505") return { error: `已经有叫「${name}」的配置了` };
        return { error: error.message };
      }
      if (activate) return await activateOnly(supabase, userId, id);
      revalidatePath("/settings");
      return {};
    }

    const { data: created, error } = await supabase
      .from("ai_presets")
      .insert({ user_id: userId, name, base_url: baseUrl, api_key: apiKey, model, is_active: false, ...flags })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") return { error: `已经有叫「${name}」的配置了` };
      return { error: error.message };
    }
    if (activate) return await activateOnly(supabase, userId, created.id);
    revalidatePath("/settings");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "保存失败" };
  }
}

/** 激活 = 先撤旧再立新。顺序不能反: 部分唯一索引(uq_ai_presets_one_active)下, 先立新会撞索引 */
async function activateOnly(
  supabase: Awaited<ReturnType<typeof getCurrentUser>>["supabase"],
  userId: string,
  id: string,
): Promise<ActionResult> {
  await supabase
    .from("ai_presets")
    .update({ is_active: false })
    .eq("user_id", userId)
    .eq("is_active", true);
  const { error } = await supabase
    .from("ai_presets")
    .update({ is_active: true })
    .eq("id", id)
    .eq("user_id", userId);
  revalidatePath("/settings");
  return error ? { error: error.message } : {};
}

// ============================================================================
// 激活 / 删除
// ============================================================================
export async function activatePreset(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const { supabase, userId } = await getCurrentUser();
  const id = str(formData.get("id"));
  if (!id) return { error: "缺少 id" };
  return activateOnly(supabase, userId, id);
}

/** 停用当前激活的 -> 生效配置回落到环境变量 */
export async function deactivatePresets(): Promise<ActionResult> {
  const { supabase, userId } = await getCurrentUser();
  const { error } = await supabase
    .from("ai_presets")
    .update({ is_active: false })
    .eq("user_id", userId)
    .eq("is_active", true);
  revalidatePath("/settings");
  return error ? { error: error.message } : {};
}

export async function deletePreset(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const { supabase, userId } = await getCurrentUser();
  const id = str(formData.get("id"));
  if (!id) return { error: "缺少 id" };
  const { error } = await supabase
    .from("ai_presets")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  revalidatePath("/settings");
  return error ? { error: error.message } : {};
}

// ============================================================================
// 连通性测试: 用表单当前填的值(未保存也能测)真实调一次对话接口
// ============================================================================
export type TestResult = { error?: string; ok?: boolean; reply?: string };

export async function testPreset(_prev: unknown, formData: FormData): Promise<TestResult> {
  const { supabase, userId } = await getCurrentUser();

  const id = str(formData.get("id"));
  const baseUrl = str(formData.get("base_url")).replace(/\/+$/, "");
  const model = str(formData.get("model"));
  let apiKey = str(formData.get("api_key"));

  if (!/^https?:\/\/.+/.test(baseUrl)) return { error: "接口地址要以 http(s):// 开头" };
  if (!model) return { error: "填写模型名" };

  // 编辑已有配置时密钥留空 = 用库里存的那个测, 前端无需拿到明文
  if (!apiKey && id) {
    const { data } = await supabase
      .from("ai_presets")
      .select("api_key")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    apiKey = data?.api_key ?? "";
  }

  try {
    const client = new OpenAI({ baseURL: baseUrl, apiKey });
    const res = await client.chat.completions.create(
      {
        model,
        messages: [{ role: "user", content: "只回复两个字符: ok" }],
        // 第二个参数是请求级选项: 测试就是测试, 15 秒不通就报不通,
        // 别让一次测试占满 action 的执行时间预算
        max_tokens: 20,
      },
      { timeout: 15000 },
    );
    const reply = res.choices[0]?.message?.content?.trim() || "(空回复)";
    return { ok: true, reply: reply.slice(0, 40) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "连接失败" };
  }
}
