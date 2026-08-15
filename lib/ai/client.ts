// AI 客户端: OpenAI 兼容协议, 通过环境变量配置 (支持 OpenAI / DeepSeek / 国内兼容服务)
import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";

/**
 * 一份 AI 配置。
 *
 * 后两个开关是给「换供应商」用的, 不是摆设:
 *   - response_format: {type:"json_object"} OpenAI 与 DeepSeek 都支持,
 *     但部分本地/国产模型不认, 会直接报错
 *   - temperature 推理类模型 (o 系列、deepseek-reasoner) 会拒绝
 * 这两条以前只写在 AGENTS.md 里靠人记, 现在做成配置项, 换模型时关掉即可。
 */
export type AiConfig = {
  baseURL: string;
  apiKey: string;
  model: string;
  /** 支持 response_format json_object; 关掉时改为在 prompt 里要求只输出 JSON */
  jsonMode: boolean;
  /** 支持 temperature 参数; 关掉时整个参数不发送 */
  temperature: boolean;
  /** 支持 function calling; AI 教练 chatbox 需要它 */
  tools: boolean;
};

/**
 * 解析当前生效的 AI 配置。
 *
 * 优先级: 设置页里激活的预设(ai_presets 表) > 环境变量。
 * 预设删光或都没激活时自动回落环境变量, 所以部署时的环境变量永远是一份
 * 可用的兜底, 不会因为误删预设把 AI 功能弄挂。
 *
 * ⚠️ 这是全项目唯一读取 AI 供应商配置的地方, 上层调用点
 * (analyze / plan / nutrition / coach) 全部无感知。
 *
 * 每次调用都实时查一次库而不是缓存: 设置页刚切换预设, 下一次请求就要
 * 立即生效; 而这条查询本身只有几毫秒, 不值得为它做缓存失效逻辑。
 */
export async function resolveAiConfig(): Promise<AiConfig> {
  try {
    // 延迟 import 而不是顶部 import: utils/server 依赖 supabase/server(cookie),
    // 这条链路只在服务端成立, 顶部 import 会让本文件没法被客户端模块安全引用。
    const { getCurrentUser } = await import("@/lib/utils/server");
    const { supabase, userId } = await getCurrentUser();
    const { data: preset } = await supabase
      .from("ai_presets")
      .select("base_url, api_key, model, json_mode, temperature_supported, tools_supported")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();
    if (preset) {
      return {
        baseURL: preset.base_url,
        apiKey: preset.api_key,
        model: preset.model,
        jsonMode: preset.json_mode,
        temperature: preset.temperature_supported,
        tools: preset.tools_supported,
      };
    }
  } catch (e) {
    // 未登录 / 表还没建(迁移未执行)等场景: 安静回落环境变量。
    // 这里吞掉是对的 -- 配置真正缺失时, AI 调用本身会报出更准确的错。
    console.warn("ai: 读取预设失败, 回落环境变量", e instanceof Error ? e.message : e);
  }
  return envConfig();
}

/** 环境变量兜底配置 (与历史行为完全一致) */
function envConfig(): AiConfig {
  return {
    baseURL: process.env.AI_BASE_URL || "https://api.openai.com/v1",
    apiKey: process.env.AI_API_KEY || "",
    model: process.env.AI_MODEL || "gpt-4o-mini",
    // 环境变量里显式写 "0"/"false" 才关闭, 默认全开 (OpenAI/DeepSeek 都支持)
    jsonMode: flag(process.env.AI_JSON_MODE, true),
    temperature: flag(process.env.AI_TEMPERATURE_SUPPORTED, true),
    tools: flag(process.env.AI_TOOLS_SUPPORTED, true),
  };
}

function flag(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined || v === "") return dflt;
  return !["0", "false", "no", "off"].includes(v.toLowerCase());
}

export async function aiClient(cfg?: AiConfig) {
  const c = cfg ?? (await resolveAiConfig());
  return new OpenAI({ baseURL: c.baseURL, apiKey: c.apiKey });
}

/**
 * 调用 AI 并解析 JSON 响应 (带容错)
 *
 * temperature 默认 0.2。营养估算这类「同样的输入就该给同样的数」的场景传 0 ——
 * 实测同一段饮食描述在 0.2 下三次给出 2050 / 2100 / 2140 kcal, 点两次重分析
 * 就是两个结果, 没法判断到底哪个准。
 */
export async function chatJSON(
  system: string,
  user: string,
  temperature = 0.2,
): Promise<unknown> {
  const cfg = await resolveAiConfig();
  const client = await aiClient(cfg);
  const res = await client.chat.completions.create({
    model: cfg.model,
    messages: [
      // 模型不支持 json_object 时, 把要求写进 system 里 —— 比直接报错强,
      // 下面的 JSON.parse 本来就带容错
      { role: "system", content: cfg.jsonMode ? system : `${system}\n\n只输出 JSON, 不要代码块标记, 不要任何解释。` },
      { role: "user", content: user },
    ],
    ...(cfg.jsonMode ? { response_format: { type: "json_object" as const } } : {}),
    ...(cfg.temperature ? { temperature } : {}),
  });
  const content = res.choices[0]?.message?.content || "{}";
  const parsed = safeParse(content);
  // 「null」「42」「"文本"」都是合法 JSON, 模型偶尔真会吐。调用方一律按对象取字段,
  // 拿到非对象就会在 json.xxx 上抛 TypeError, 所以在这一层统一兜住。
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

/**
 * 关掉 jsonMode 后模型常把 JSON 包在 ```json 代码块里, 直接 parse 会炸。
 * 开着 jsonMode 时这段不会生效, 属于纯兜底。
 */
function safeParse(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) return {};
    try {
      return JSON.parse(m[0]);
    } catch {
      return {};
    }
  }
}

// ============================================================================
// 带工具调用的流式对话 (AI 教练 chatbox 用)
// ============================================================================

/** 流式过程中吐给上层的增量事件 */
export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; args: string };

export type ToolCallRequest = { id: string; name: string; args: string };

/**
 * 发一轮对话, 边收边吐。返回这一轮模型说的话与它要调用的工具。
 *
 * 为什么不复用 chatJSON: 那边写死了 response_format json_object, 与 tools
 * 互斥 —— 带着它发工具调用, OpenAI 直接报错, DeepSeek 会返回一段 JSON 文本
 * 而不是 tool_calls。两条路径必须分开, 且**不要**去动 chatJSON,
 * 它同时被营养分析、计划解析、综合分析三处依赖。
 */
export async function chatTurn(
  messages: ChatCompletionMessageParam[],
  tools: ChatCompletionTool[],
  onEvent: (e: StreamEvent) => void,
): Promise<{ text: string; toolCalls: ToolCallRequest[] }> {
  const cfg = await resolveAiConfig();
  const client = await aiClient(cfg);

  const stream = await client.chat.completions.create({
    model: cfg.model,
    messages,
    // cfg.tools 关掉(模型不支持 function calling)时直接不传: 传了要么报错、
    // 要么模型把工具说明当成用户输入回话, 都是灾难。代价是私教退化成纯聊天
    ...(cfg.tools && tools.length ? { tools, tool_choice: "auto" as const } : {}),
    ...(cfg.temperature ? { temperature: 0.3 } : {}),
    stream: true,
  });

  let text = "";
  // tool_calls 在流里是按 index 分片来的: 名字可能只在第一片出现,
  // 参数则被切成很多段 JSON 文本, 要按 index 拼回去。
  // index 缺失是部分国产兼容服务的老毛病, 兜底成 0 —— 单个工具调用的场景下够用。
  const acc = new Map<number, { id: string; name: string; args: string }>();

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;

    if (delta.content) {
      text += delta.content;
      onEvent({ type: "text", text: delta.content });
    }

    for (const tc of delta.tool_calls ?? []) {
      const i = tc.index ?? 0;
      const cur = acc.get(i) ?? { id: "", name: "", args: "" };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.name = tc.function.name;
      if (tc.function?.arguments) cur.args += tc.function.arguments;
      acc.set(i, cur);
    }
  }

  const toolCalls: ToolCallRequest[] = [...acc.values()]
    .filter((t) => t.name)
    // id 是回传 tool 结果时的关联键, 少数兼容服务不给, 这里补一个
    .map((t, i) => ({ id: t.id || `call_${i}`, name: t.name, args: t.args || "{}" }));

  for (const t of toolCalls) onEvent({ type: "tool_call", ...t });

  return { text, toolCalls };
}
