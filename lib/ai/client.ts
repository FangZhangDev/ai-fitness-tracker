// AI 客户端: OpenAI 兼容协议, 通过环境变量配置 (支持 OpenAI / DeepSeek / 国内兼容服务)
import OpenAI from "openai";

export function aiClient() {
  return new OpenAI({
    baseURL: process.env.AI_BASE_URL || "https://api.openai.com/v1",
    apiKey: process.env.AI_API_KEY || "",
  });
}

export const AI_MODEL = process.env.AI_MODEL || "gpt-4o-mini";

/** 调用 AI 并解析 JSON 响应 (带容错) */
export async function chatJSON(system: string, user: string): Promise<unknown> {
  const client = aiClient();
  const res = await client.chat.completions.create({
    model: AI_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });
  const content = res.choices[0]?.message?.content || "{}";
  return JSON.parse(content);
}
