// ============================================================================
// AI 私教: system prompt 与工具调用循环
//
// 这个文件里绝大部分篇幅是 prompt。工具层写对了只保证「能改」, prompt 写对了
// 才保证「改得对」—— 下面每一条约束都对应一种实际会出现的错法, 注释里写了是哪种。
// ============================================================================
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Weekday } from "@/lib/types/database";
import { WEEKDAY_LABEL } from "@/lib/types/database";
import { WEIGHT_CONVENTION } from "@/lib/constants/weight-convention";
import { chatTurn, type StreamEvent } from "@/lib/ai/client";
import { runTool, toolsFor, type ToolCtx } from "@/lib/ai/coach-tools";
import { todayISO } from "@/lib/utils/date";

type DB = SupabaseClient<Database>;

/** 一轮对话最多让模型调几次工具。超过就强制收尾 */
const MAX_ROUNDS = 6;
/**
 * 软超时。Vercel Hobby 给整个函数 60 秒, 到点直接掐断连接, 用户看到的是
 * 半句话 + 一个没有下文的进度条。留 15 秒余量, 到 45 秒就让模型收尾,
 * 宁可回答短一点也要有始有终。
 */
const SOFT_DEADLINE_MS = 45_000;

// ---------------------------------------------------------------------------
// system prompt
// ---------------------------------------------------------------------------

/**
 * 拼 system prompt 的骨架。
 *
 * 这里只放「每轮都用得上、且体量小」的东西: 今天几号、身体数据、计划的目录
 * (练哪几天、各练什么, 不含动作明细)、练过的动作名。细节一律让模型自己调工具取。
 *
 * 反过来做 —— 把全库塞进 prompt —— 试过是错的, 原因和 lib/ai/nutrition.ts 里
 * 记的那个「只要合计就系统性偏低 30%」是同一个: 材料直接摊在眼前时, 模型给的是
 * 整体印象, 不会真的去查。逼它调工具, 引用才真的有据。
 */
async function buildSystemPrompt(supabase: DB, userId: string): Promise<string> {
  const date = todayISO();
  const jsDay = new Date().getDay();
  const weekday = (jsDay === 0 ? 7 : jsDay) as Weekday;

  const [profileRes, planRes, prRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("height_cm,current_weight_kg,target_weight_kg,goal,activity_level")
      .eq("id", userId)
      .maybeSingle(),
    supabase.from("workout_plans").select("id,name").eq("is_active", true).maybeSingle(),
    supabase
      .from("v_exercise_pr")
      .select("exercise,max_weight_kg")
      .order("estimated_1rm_kg", { ascending: false })
      .limit(40),
  ]);

  // 计划目录: 只列周几 + 主题 + 动作数, 不展开动作
  let planOutline = "用户还没有启用中的训练计划。";
  if (planRes.data) {
    const { data: days } = await supabase
      .from("plan_days")
      .select("id,weekday,title,plan_exercises(count)")
      .eq("plan_id", planRes.data.id)
      .order("weekday");
    const lines = (days ?? []).map((d) => {
      const n = (d.plan_exercises as unknown as { count: number }[] | null)?.[0]?.count ?? 0;
      return `  ${WEEKDAY_LABEL[d.weekday as Weekday]} ${d.title} (${n} 个动作)`;
    });
    planOutline = `当前启用的计划:《${planRes.data.name}》\n${
      lines.length ? lines.join("\n") : "  (还没有训练日)"
    }\n没列出来的周几就是休息日。动作明细要用 get_plan 取。`;
  }

  const known = (prRes.data ?? []).map((r) => r.exercise);
  const knownList = known.length
    ? known.join("、")
    : "(还没有训练记录, 用户是新手或刚开始用这个系统)";

  return `你是这位用户的私人健身教练。你能读到他全部的训练、饮食、身体数据, 也能直接修改他的训练计划。

# 现在
今天是 ${date}, ${WEEKDAY_LABEL[weekday]} (weekday=${weekday})。
【重要】所有「今天」「明天」「这周六」都要以这个日期为准算, 不要用你训练数据里的日期。
周几在数据库里是 1=周一 ... 7=周日。

# 用户档案
${JSON.stringify(profileRes.data ?? {})}

# 计划概览
${planOutline}

# 他练过的动作 (按估算 1RM 排序)
${knownList}

# 最重要的一条: 计划 ≠ 记录
这两件事在数据库里是分开的, 搞混了会污染他的历史数据:
- **训练计划** (plan_days / plan_exercises) 是模板, 表示「打算怎么练」。
  「周六我也想练胸」「把深蹲组数加到 4 组」「这个动作换掉」—— 都是改计划。
- **训练记录** (workout_logs) 是事实, 表示「实际练了什么」。
  「我今天卧推 80kg 做了 4 组」—— 这是记录。
你现在**只有改计划的权限**, 没有写训练记录的权限。用户要你记录实际训练时,
告诉他去「训练」页记, 或者在手表上记 —— 不要试图用改计划的工具去代替记录。

# 动作命名: 必须沿用他已有的写法
上面那份动作清单就是他历史记录里的原始写法。往计划里加动作时:
- 能对上清单里某一项的, **必须**一字不差地用清单里的名字。
  写成「杠铃卧推」而他记录里是「平板杠铃卧推」, 会让这个动作的力量曲线和
  历史最大重量直接断成两条, 这是很难事后修的错误。
- 确实是清单里没有的新动作才新建, 并且要在回复里点明「这是个新动作」。

# 重量口径
给重量建议时必须按这个口径说, 否则他会照着练错:
${WEIGHT_CONVENTION}

# 工具使用
- 改计划前**必须**先调 get_plan 拿到真实的 day_id / exercise_id。绝对不要猜 id 或者编 id。
- 涉及「今天」的问题先调 get_today。
- 加多个动作时一次性传进 exercises 数组, 不要一个动作调一次 —— 每多一次调用就多一个来回, 会超时。
- 一套计划里同一个周几只能有一个训练日。那天已经有了就用 add_plan_exercises 往里加, 不要再 add_plan_day。
- 工具返回 error 时, 读懂它说的原因然后换个方式做, 不要重复同样的调用。
- 删除动作或训练日只能用 request_delete_* 提出请求, 那会弹给用户确认。
  调用之后不要说「已删除」, 要说「我建议删掉 X, 你确认一下」。

# 回答方式
- 说人话, 简短。默认不超过 200 字, 用户明确要求详细分析时才展开。
- 引用数据时给具体数字 (「你近 4 周深蹲容量从 3800 涨到 4200kg」),
  **这些数字只能来自工具返回值, 一个都不许编**。没查过就先查, 或者直说不知道。
- 改完东西要说清楚改的是哪套计划的哪一天、加/改了什么, 让他不用去翻页面就知道发生了什么。
- 他只是想聊两句或者问健身常识时, 就正常聊, 不用非得调工具、非得改东西。`;
}

// ---------------------------------------------------------------------------
// 对话循环
// ---------------------------------------------------------------------------

export type CoachEvent =
  | StreamEvent
  | { type: "tool_result"; name: string; ok: boolean }
  | { type: "done"; text: string };

export type CoachInput = {
  supabase: DB;
  userId: string;
  /** 历史消息 (不含 system), 由前端带上来 */
  history: Array<{ role: "user" | "assistant"; content: string }>;
  message: string;
  canWrite: boolean;
};

export type CoachResult = {
  text: string;
  mutations: ToolCtx["mutations"];
  pendingDeletes: ToolCtx["pendingDeletes"];
};

/**
 * 跑完一整轮对话 (可能包含多次工具调用), 边跑边通过 onEvent 吐进度。
 *
 * 工具报错不中断循环 —— 错误信息作为 tool 消息回喂给模型, 让它自己纠正。
 * 这是这套东西能用的关键: 模型第一次十有八九会撞上「周六已经有训练日了」,
 * 收到那句人话之后它下一轮就改对了。
 */
export async function runCoach(
  input: CoachInput,
  onEvent: (e: CoachEvent) => void,
): Promise<CoachResult> {
  const started = Date.now();
  const system = await buildSystemPrompt(input.supabase, input.userId);

  const ctx: ToolCtx = {
    supabase: input.supabase,
    userId: input.userId,
    canWrite: input.canWrite,
    mutations: [],
    pendingDeletes: [],
  };

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    // 只带最近 12 条历史: 再往前的对话对当下的判断帮助不大, 但每一条都要占 token,
    // 而 token 直接换算成延迟, 而延迟这里是有硬上限的
    ...input.history.slice(-12),
    { role: "user", content: input.message },
  ];

  const tools = toolsFor(input.canWrite);
  let finalText = "";

  for (let round = 0; round < MAX_ROUNDS; round++) {
    // 时间不够再跑一轮工具了就收尾。注意是「不再给工具」而不是直接断开,
    // 让模型用已经拿到的信息把话说完 —— 半截回答比短回答糟糕得多。
    const overtime = Date.now() - started > SOFT_DEADLINE_MS;
    const lastRound = round === MAX_ROUNDS - 1;
    const allowTools = !overtime && !lastRound;

    if (overtime || lastRound) {
      messages.push({
        role: "system",
        content: "时间到了, 不要再调用工具。用你已经拿到的信息把话说完, 简短一点。",
      });
    }

    const { text, toolCalls } = await chatTurn(messages, allowTools ? tools : [], onEvent);
    if (text) finalText += (finalText ? "\n" : "") + text;

    if (!toolCalls.length) break;

    // 把模型这一轮的发言与工具调用意图原样放回消息里, 否则下一轮它看不到自己刚做过什么
    messages.push({
      role: "assistant",
      content: text || null,
      tool_calls: toolCalls.map((t) => ({
        id: t.id,
        type: "function" as const,
        function: { name: t.name, arguments: t.args },
      })),
    });

    for (const call of toolCalls) {
      const result = await runTool(ctx, call.name, call.args);
      onEvent({ type: "tool_result", name: call.name, ok: !result.includes('"error"') });
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  onEvent({ type: "done", text: finalText });
  return { text: finalText, mutations: ctx.mutations, pendingDeletes: ctx.pendingDeletes };
}
