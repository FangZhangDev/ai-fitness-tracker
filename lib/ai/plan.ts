// AI 训练计划解析: 任意格式的计划文本 (Markdown 表格 / 纯文本列表) → 结构化计划
import { chatJSON } from "@/lib/ai/client";
import type { ParsedPlan, Weekday } from "@/lib/types/database";
import { parseRestSec } from "@/lib/utils/rest";

const SYSTEM = `你是一个训练计划解析器。用户会粘贴一份健身计划(可能是 Markdown 表格、纯文本或混合格式),
把它解析成结构化 JSON。只输出 JSON, 不要任何解释。

结构:
{
  "name": string,              // 计划名称, 用户没写就根据内容起一个简短的, 如 "上下肢分化 4 练"
  "days": [
    {
      "weekday": number,       // 1=周一, 2=周二, ... 7=周日
      "title": string,         // 该训练日的主题, 如 "上肢 A，上胸 + 背厚 + 肩"
      "exercises": [
        {
          "exercise": string,        // 动作名称, 去掉多余修饰, 保留可识别的名字
          "target_sets": number|null,// 组数, "3 × 8–10" 里的 3
          "rep_min": number|null,    // 次数下限, "8–10" 里的 8; "2组"这种没写次数则 null
          "rep_max": number|null,    // 次数上限, "8–10" 里的 10; 单值时与 rep_min 相同
          "rir_min": number|null,    // RIR 下限, "1–2" 里的 1; 单值 "2" 则为 2
          "rir_max": number|null,    // RIR 上限, "1–2" 里的 2; 单值 "2" 则为 2
          "rest_sec": number|null,   // 组间休息秒数, 如 120; 区间取下界
          "cues": string|null,       // 动作要点原文, 尽量完整保留
          "equipment": string|null   // 器材原文
        }
      ]
    }
  ]
}

规则:
- 只输出计划里实际出现的训练日; 没提到的周几不要编造
- "周一/周二/..." "Mon/Tue" "第一天" 都要正确映射到 weekday 数字
- 次数区间的连字符可能是 - – — ~ 等, 都要正确拆分
- "2组"、"3组" 这种只有组数没有次数的, target_sets 填数字, rep_min/rep_max 填 null
- RIR 写 "留余力" "力竭" 等非数字时, rir_min/rir_max 填 null
- 动作名里的 "?" "（小程序）" 等噪声去掉, 但不要改变动作本身的含义
- 超级组等一行写了多个动作的, 拆成多条, 各自保留原有参数
- 表格里 "undefined"、空白、"—" 一律视为 null
- 动作顺序必须与原文一致`;

/** 调用 AI 把计划文本解析成结构化计划 */
export async function parsePlanText(text: string): Promise<ParsedPlan> {
  const json = (await chatJSON(SYSTEM, text)) as Partial<ParsedPlan>;
  return normalizePlan(json);
}

// ============================================================================
// AI 生成计划: 换健身房 / 假期 / 重新分化时, 结合身体数据与近期训练自动编排
// ============================================================================

const GENERATE_SYSTEM = `你是一名专业的增肌教练。根据用户的身体数据、近期训练情况、可训练的日子
和场地器材, 编排一份可执行的分化训练计划。

输出 JSON, 结构与字段含义同下 (只输出 JSON, 不要解释):
${SYSTEM.slice(SYSTEM.indexOf("结构:"), SYSTEM.indexOf("规则:"))}
编排要求:
- 只在用户指定的 weekday 上安排训练, 不要多排也不要少排
- 只使用用户列出的器材; 器材没提到的动作不要出现。器材信息很少时优先选自由重量与自重动作
- 每个训练日 5-8 个动作, 大肌群复合动作在前, 孤立动作在后
- target_sets 一般 2-4; 复合动作 rep_min/rep_max 取 6-12, 孤立动作取 10-20
- rir_min/rir_max: 复合动作 2-3, 孤立动作 1-2
- rest_sec: 复合动作 120-180, 孤立动作 60-90; 只给一个数, 单位是秒
- cues 写具体的动作要点, 针对该动作, 不要写空话
- 参考用户近期练过的动作与重量, 保持连续性; 若换了场地则选功能相近的替代动作
- title 要说明该日练什么, 如 "上肢 A，胸 + 背 + 肩"`;

export interface GeneratePlanInput {
  /** 用户自由描述: 场地、周期、偏好, 如 "过年回家, 小区健身房只有哑铃和史密斯机" */
  request: string;
  /** 打算训练的周几 */
  weekdays: number[];
  /** 可用器材, 自由文本 */
  equipment: string;
  profile: {
    height_cm: number | null;
    current_weight_kg: number | null;
    target_weight_kg: number | null;
    goal: string | null;
  } | null;
  /** 近期练过的动作与最好成绩, 用于保持连续性 */
  recentExercises: Array<{
    exercise: string;
    max_weight_kg: number | null;
    estimated_1rm_kg: number | null;
  }>;
}

/** 调用 AI 生成一份新计划 */
export async function generatePlan(input: GeneratePlanInput): Promise<ParsedPlan> {
  const user = `用户档案: ${JSON.stringify(input.profile || {})}

打算训练的日子 (1=周一 ... 7=周日): ${JSON.stringify(input.weekdays)}

可用器材:
${input.equipment || "(未说明, 按常见商业健身房配置编排)"}

近期练过的动作与最好成绩:
${input.recentExercises.length ? JSON.stringify(input.recentExercises) : "(暂无历史记录)"}

用户补充说明:
${input.request || "(无)"}`;

  const json = (await chatJSON(GENERATE_SYSTEM, user)) as Partial<ParsedPlan>;
  const plan = normalizePlan(json);
  // AI 偶尔会多排或少排训练日, 这里按用户指定的 weekday 过滤
  const allowed = new Set(input.weekdays);
  return { ...plan, days: plan.days.filter((d) => allowed.has(d.weekday)) };
}

/**
 * 规整 AI 输出: AI 可能返回越界的 weekday、字符串数字、缺字段等,
 * 这里统一收敛, 避免脏数据直接写库触发约束错误。
 */
export function normalizePlan(raw: Partial<ParsedPlan>): ParsedPlan {
  const name = (typeof raw.name === "string" && raw.name.trim()) || "我的训练计划";

  const seenWeekday = new Set<number>();
  const days = (Array.isArray(raw.days) ? raw.days : [])
    .map((d) => {
      const weekday = clampInt(d?.weekday, 1, 7);
      if (weekday === null) return null;
      return {
        weekday: weekday as Weekday,
        title: (typeof d?.title === "string" && d.title.trim()) || `周${weekday} 训练`,
        exercises: (Array.isArray(d?.exercises) ? d.exercises : [])
          .map((e) => {
            const exercise = typeof e?.exercise === "string" ? e.exercise.trim() : "";
            if (!exercise) return null;
            // 次数/RIR 区间: 保证 min <= max
            const [rep_min, rep_max] = orderPair(
              clampInt(e?.rep_min, 0, 100),
              clampInt(e?.rep_max, 0, 100),
            );
            const [rir_min, rir_max] = orderPair(
              clampInt(e?.rir_min, 0, 10),
              clampInt(e?.rir_max, 0, 10),
            );
            return {
              exercise,
              target_sets: clampInt(e?.target_sets, 0, 20),
              rep_min,
              rep_max,
              rir_min,
              rir_max,
              rest_sec: restSecOf(e),
              cues: text(e?.cues),
              equipment: text(e?.equipment),
            };
          })
          .filter((e): e is NonNullable<typeof e> => e !== null),
      };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null)
    // 同一个周几只保留第一条 (plan_days 上有 unique(plan_id, weekday) 约束)
    .filter((d) => {
      if (seenWeekday.has(d.weekday)) return false;
      seenWeekday.add(d.weekday);
      return true;
    })
    .filter((d) => d.exercises.length > 0)
    .sort((a, b) => a.weekday - b.weekday);

  return { name, days };
}

/** 转成范围内的整数, 无法解析或越界返回 null */
/**
 * 休息秒数。声明的类型是 number, 但这是模型的输出 ——
 * 实际可能回 "120"、"2-3分钟", 或者用了改版前的 rest 字段名, 全部兜住。
 */
function restSecOf(e: unknown): number | null {
  const o = e as { rest_sec?: unknown; rest?: unknown } | null | undefined;
  const v = o?.rest_sec ?? o?.rest;
  if (typeof v === "number") return clampInt(v, 0, 3600);
  return parseRestSec(text(v));
}

function clampInt(v: unknown, min: number, max: number): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

/** 只填了一端时用同值补齐; 顺序颠倒时交换 */
function orderPair(a: number | null, b: number | null): [number | null, number | null] {
  if (a === null && b === null) return [null, null];
  if (a === null) return [b, b];
  if (b === null) return [a, a];
  return a <= b ? [a, b] : [b, a];
}

/** 去空白, 并把 AI 常见的占位值当成空 */
function text(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s === "undefined" || s === "null" || s === "—" || s === "-") return null;
  return s;
}
