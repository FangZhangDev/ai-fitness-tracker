// ============================================================================
// 全量导出包
//
// 目的: 一次性把所有数据导出成「网页版 AI 能直接读懂」的形式, 丢给
// ChatGPT / Claude 分析, 再把它们的回复粘回本系统导入。
//
// 两种形态:
//   Markdown — 单文件, 可直接粘贴进对话框, 含数据字典与回复格式约定
//   ZIP      — 各表 CSV + README.md + PROMPT.md, 适合当附件上传或做备份
// ============================================================================
import JSZip from "jszip";
import { toCSV, type Row } from "@/lib/utils/export";

export interface BundleData {
  profile: Row | null;
  dailyMetrics: Row[];
  mealLogs: Row[];
  workoutLogs: Row[];
  aiAnalyses: Row[];
  exercisePR: Row[];
  dailyNutrition: Row[];
  plans: Array<{
    name: string;
    is_active: boolean;
    days: Array<{
      weekday: number;
      title: string;
      exercises: Row[];
    }>;
  }>;
}

const WEEKDAY = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];

// ---------------------------------------------------------------------------
// 数据字典 — 让 AI 知道每个字段是什么意思、什么单位
// ---------------------------------------------------------------------------
const DATA_DICTIONARY = `## 数据字典

所有重量单位为 **公斤(kg)**，长度为 **厘米(cm)**，能量为 **千卡(kcal)**，日期为 \`YYYY-MM-DD\`。

### profile 个人档案
| 字段 | 含义 |
| --- | --- |
| height_cm | 身高 |
| current_weight_kg | 当前体重 |
| target_weight_kg | 目标体重 |
| goal | 训练目标（如增肌/减脂） |
| activity_level | 日常活动量 |

### daily_metrics 每日身体指标
| 字段 | 含义 |
| --- | --- |
| date | 日期 |
| weight_kg | 晨起体重 |
| body_fat_pct | 体脂率(%) |
| waist_cm | 腰围 |
| sleep_hours | 睡眠时长(小时) |

### meal_logs 饮食记录
| 字段 | 含义 |
| --- | --- |
| date / meal_type | 日期 / 餐次(breakfast午lunch晚dinner加餐snack) |
| description | 用自然语言写的进食内容 |
| calories / protein_g / carbs_g / fat_g | 由 AI 估算的热量与三大营养素 |

### workout_logs 训练记录
| 字段 | 含义 |
| --- | --- |
| date | 训练日期 |
| workout_day | 训练日主题（如「上肢 A」） |
| exercise | 动作名称 |
| weight_kg | 负重 |
| sets / reps | 组数 / 每组次数 |
| rir | Reps In Reserve，留了几次余力（0=力竭） |

### exercise_pr 各动作历史最好成绩
\`estimated_1rm_kg\` 用 Epley 公式估算：\`1RM = 重量 × (1 + 次数/30)\`。

### plans 训练计划
\`rep_min/rep_max\` 是目标次数区间，\`rir_min/rir_max\` 是目标 RIR 区间，
\`cues\` 是动作要点，\`equipment\` 是所需器材。`;

// ---------------------------------------------------------------------------
// 给网页版 AI 的提示词 —— 关键在于约定好回复格式, 好让回复能粘回系统
// ---------------------------------------------------------------------------
const AI_PROMPT = `## 给 AI 的话（把这段连同下面的数据一起发给 ChatGPT / Claude）

我在做长期增肌训练，下面是我的完整训练与饮食数据。请你：

1. 评估我最近的进展：体重与围度变化是否在合理的增肌速度区间（约每周 0.25–0.5kg），
   蛋白摄入是否够（建议每公斤体重 1.6–2.2g），训练容量与力量增长是否匹配。
2. 指出数据里最值得注意的 2–3 个问题，并说明你是从哪些数字看出来的。
3. 给出具体可执行的调整建议，不要空话。

**如果你建议我修改训练计划，请务必用下面这个格式输出计划部分**，
因为我会把你的回复原样粘回我的系统自动导入：

\`\`\`
**周一：上肢 A，上胸 + 背厚 + 肩**

| 动作 | 组 × 次 | RIR | 休息 | 要点 | 器材 |
| --- | --- | --- | --- | --- | --- |
| 上斜推胸训练器 | 3 × 8-10 | 2 | 2-3分钟 | 上胸优先，肩胛后收下沉 | 上斜卧推训练器 |
| 绳索侧平举 | 3 × 12-20 | 1-2 | 60-90秒 | 小重量，手肘带动 | 龙门架 + D型手柄 |

**周四：上肢 B，背宽 + 胸 + 后束**

| 动作 | 组 × 次 | RIR | 休息 | 要点 | 器材 |
| --- | --- | --- | --- | --- | --- |
| 高位下拉 | 3 × 6-10 | 2 | 2-3分钟 | 想象用肘拉，不是手拉 | 高位下拉训练器 |
\`\`\`

要求：每个训练日一个「**周X：主题**」标题加一张表；
表格必须是「动作 / 组 × 次 / RIR / 休息 / 要点 / 器材」这六列；
只写我实际要练的那几天。`;

// ---------------------------------------------------------------------------
// Markdown 单文件
// ---------------------------------------------------------------------------
export function buildMarkdownBundle(d: BundleData, exportedAt: string): string {
  const parts: string[] = [];

  parts.push(`# AI 健身追踪 · 全量数据导出`);
  parts.push(`导出时间：${exportedAt}`);
  parts.push("");
  parts.push(AI_PROMPT);
  parts.push("");
  parts.push("---");
  parts.push("");
  parts.push(DATA_DICTIONARY);
  parts.push("");
  parts.push("---");
  parts.push("");

  parts.push(`## 我的档案`);
  parts.push(d.profile ? kvTable(d.profile) : "（未填写）");
  parts.push("");

  parts.push(`## 当前训练计划`);
  if (!d.plans.length) {
    parts.push("（还没有建计划）");
  } else {
    for (const p of d.plans) {
      parts.push(`### ${p.name}${p.is_active ? "（启用中）" : ""}`);
      for (const day of p.days) {
        parts.push("");
        parts.push(`**${WEEKDAY[day.weekday] ?? `周${day.weekday}`}：${day.title}**`);
        parts.push("");
        parts.push("| 动作 | 组 × 次 | RIR | 休息 | 要点 | 器材 |");
        parts.push("| --- | --- | --- | --- | --- | --- |");
        for (const e of day.exercises) {
          parts.push(
            `| ${cell(e.exercise)} | ${setsReps(e)} | ${range(e.rir_min, e.rir_max)} | ${cell(e.rest)} | ${cell(e.cues)} | ${cell(e.equipment)} |`,
          );
        }
      }
      parts.push("");
    }
  }
  parts.push("");

  parts.push(section("身体指标", d.dailyMetrics));
  parts.push(section("每日营养汇总", d.dailyNutrition));
  parts.push(section("饮食记录", d.mealLogs));
  parts.push(section("训练记录", d.workoutLogs));
  parts.push(section("各动作 PR", d.exercisePR));

  if (d.aiAnalyses.length) {
    parts.push(`## 历史 AI 分析`);
    for (const a of d.aiAnalyses.slice(0, 10)) {
      parts.push(
        `- **${a.period_start} ~ ${a.period_end}**：${
          (a.report as { summary?: string } | null)?.summary ?? "(无摘要)"
        }`,
      );
    }
    parts.push("");
  }

  return parts.join("\n");
}

/** 一个表 → Markdown 表格 (空表也留个标题, 让 AI 知道这块确实没数据) */
function section(title: string, rows: Row[]): string {
  if (!rows.length) return `## ${title}\n\n（暂无数据）\n`;
  const headers = Object.keys(rows[0]).filter((h) => h !== "id" && h !== "user_id");
  const lines = [
    `## ${title}（共 ${rows.length} 条）`,
    "",
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${headers.map((h) => cell(r[h])).join(" | ")} |`),
    "",
  ];
  return lines.join("\n");
}

function kvTable(obj: Row): string {
  const skip = new Set(["id", "user_id", "created_at", "updated_at"]);
  const lines = ["| 字段 | 值 |", "| --- | --- |"];
  for (const [k, v] of Object.entries(obj)) {
    if (skip.has(k)) continue;
    lines.push(`| ${k} | ${cell(v)} |`);
  }
  return lines.join("\n");
}

/** 单元格转义: Markdown 表格里 | 和换行会破坏结构 */
function cell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function range(min: unknown, max: unknown): string {
  if (min === null || min === undefined) return "—";
  if (max === null || max === undefined || max === min) return String(min);
  return `${min}-${max}`;
}

function setsReps(e: Row): string {
  const sets = e.target_sets ?? null;
  const rmin = e.rep_min ?? null;
  const rmax = e.rep_max ?? null;
  if (sets === null && rmin === null) return "—";
  if (rmin === null) return `${sets} 组`;
  return `${sets ?? "?"} × ${rmax === null || rmax === rmin ? rmin : `${rmin}-${rmax}`}`;
}

// ---------------------------------------------------------------------------
// ZIP: 各表 CSV + 说明文档
// ---------------------------------------------------------------------------
export async function buildZipBundle(d: BundleData, exportedAt: string): Promise<Buffer> {
  const zip = new JSZip();

  zip.file(
    "README.md",
    `# AI 健身追踪 · 数据导出\n\n导出时间：${exportedAt}\n\n` +
      `本压缩包内：\n` +
      `- \`PROMPT.md\` — 建议直接复制给 ChatGPT / Claude 的提示词\n` +
      `- \`all.md\` — 全部数据的单文件 Markdown 版（懒得传多个文件就用这个）\n` +
      `- \`data/*.csv\` — 各表原始数据，可用 Excel 打开\n` +
      `- \`data/plans.json\` — 训练计划（含要点与器材）\n\n` +
      DATA_DICTIONARY,
  );
  zip.file("PROMPT.md", AI_PROMPT);
  zip.file("all.md", buildMarkdownBundle(d, exportedAt));

  const data = zip.folder("data")!;
  data.file("daily_metrics.csv", toCSV(d.dailyMetrics));
  data.file("meal_logs.csv", toCSV(d.mealLogs));
  data.file("workout_logs.csv", toCSV(d.workoutLogs));
  data.file("daily_nutrition.csv", toCSV(d.dailyNutrition));
  data.file("exercise_pr.csv", toCSV(d.exercisePR));
  data.file("ai_analyses.csv", toCSV(d.aiAnalyses));
  data.file("profile.json", JSON.stringify(d.profile, null, 2));
  data.file("plans.json", JSON.stringify(d.plans, null, 2));

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** 机器可读的全量 JSON (含数据字典, 方便再导入或喂给别的工具) */
export function buildJsonBundle(d: BundleData, exportedAt: string): string {
  return JSON.stringify(
    {
      exported_at: exportedAt,
      source: "ai-fitness-tracker",
      note: "所有重量单位 kg, 长度 cm, 能量 kcal, 日期 YYYY-MM-DD。rir = Reps In Reserve。",
      ...d,
    },
    null,
    2,
  );
}
