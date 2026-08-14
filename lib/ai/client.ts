// AI 客户端: OpenAI 兼容协议, 通过环境变量配置 (支持 OpenAI / DeepSeek / 国内兼容服务)
import OpenAI from "openai";

export function aiClient() {
  return new OpenAI({
    baseURL: process.env.AI_BASE_URL || "https://api.openai.com/v1",
    apiKey: process.env.AI_API_KEY || "",
  });
}

export const AI_MODEL = process.env.AI_MODEL || "gpt-4o-mini";

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
  const client = aiClient();
  const res = await client.chat.completions.create({
    model: AI_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    temperature,
  });
  const content = res.choices[0]?.message?.content || "{}";
  return JSON.parse(content);
}
