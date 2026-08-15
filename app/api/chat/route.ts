// ============================================================================
// AI 私教对话接口 (SSE 流式)
//
// 为什么是 Route Handler 而不是 Server Action:
//   Server Action 只能整体返回, 而这里一轮对话可能要调好几次工具, 全程十几秒。
//   没有流式的话用户面对的就是十几秒空白, 而且看不到 AI 到底在干什么。
//   Action 那套 useActionState 的写法在这里用不了, 所以走 SSE。
// ============================================================================
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/utils/server";
import { runCoach, type CoachEvent } from "@/lib/ai/coach";

// 一轮对话含多次工具调用, 顶到 Hobby 上限。
// lib/ai/coach.ts 里的软超时 (45s) 会先一步收尾, 这里是硬保险。
export const maxDuration = 60;

type Body = {
  message?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  /** 前端权限开关: 允许 AI 改计划 */
  canWrite?: boolean;
};

export async function POST(request: NextRequest) {
  // proxy.ts 的 matcher 排除了 /api, 所以这里是未登录请求的第一道关
  let auth: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    auth = await getCurrentUser();
  } catch {
    return Response.json({ error: "未登录，请重新登录后再试" }, { status: 401 });
  }
  const { supabase, userId } = auth;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "请求格式错误" }, { status: 400 });
  }

  const message = (body.message ?? "").trim();
  if (!message) return Response.json({ error: "说点什么吧" }, { status: 400 });
  if (message.length > 4000) return Response.json({ error: "消息太长了" }, { status: 400 });

  // 一次对话轮次的标识: 这轮改的所有行都挂在它下面, 撤销以它为单位
  const turnId = randomUUID();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: CoachEvent | Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      };

      try {
        const result = await runCoach(
          {
            supabase,
            userId,
            history: (body.history ?? []).slice(-12),
            message,
            canWrite: body.canWrite === true,
          },
          // done 事件由下面统一发, 这里滤掉, 免得前端收到两次
          (e) => {
            if (e.type !== "done") send(e);
          },
        );

        // ---- 落账 --------------------------------------------------------
        // 改动是边跑边写进库的, 这里补的是「怎么退回去」的记录。
        // 顺序 (seq) 必须保留: 撤销时倒着重放, 先删同轮里后加的动作, 再删训练日,
        // 否则会撞外键。
        if (result.mutations.length) {
          const { error } = await supabase.from("agent_mutations").insert(
            result.mutations.map((m, seq) => ({
              user_id: userId,
              turn_id: turnId,
              seq,
              table_name: m.table_name,
              row_id: m.row_id,
              before: m.before,
              after: m.after,
            })),
          );
          // 记不上账不该让整轮失败 —— 数据已经改好了, 只是撤销按钮用不了。
          // 明确告诉前端, 比默默给一个点了没反应的按钮强。
          if (error) {
            send({ type: "warn", message: `改动已生效，但撤销记录写入失败：${error.message}` });
          }
          revalidatePath("/plan");
          revalidatePath("/workouts");
          revalidatePath("/");
        }

        send({
          type: "done",
          text: result.text,
          turn_id: result.mutations.length ? turnId : null,
          mutation_count: result.mutations.length,
          pending_deletes: result.pendingDeletes,
        });
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : "AI 调用失败" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // 关掉反向代理的缓冲, 否则事件会被攒着一次性吐出来, 流式就白做了
      "X-Accel-Buffering": "no",
    },
  });
}
