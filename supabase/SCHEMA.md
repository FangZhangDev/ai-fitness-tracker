# ============================================================================
# AI Fitness Tracker — 数据库 Schema 说明
# ============================================================================

个人长期增肌追踪系统的数据库设计。共 5 张表 + 4 个视图，全部启用 RLS。

## 表结构

### profiles — 用户档案 (1:1 对应 auth.users)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid (PK) | = auth.users.id |
| height_cm | numeric(5,2) | 身高 cm |
| current_weight_kg | numeric(5,2) | 当前体重 |
| target_weight_kg | numeric(5,2) | 目标体重 |
| goal | text | 健身目标 |
| activity_level | enum | 活动水平 (用于热量估算) |

新用户注册时由触发器 `handle_new_user` 自动创建空档案。

### daily_metrics — 每日身体记录
`UNIQUE(user_id, date)` 防止同一天重复记录。字段：date / weight_kg / body_fat_pct / waist_cm / sleep_hours / notes，均有 CHECK 范围约束。

### meal_logs — 饮食记录
用户输入自然语言 `description`，AI 分析后回填 `calories / protein_g / carbs_g / fat_g`，原始返回存 `ai_raw` 留档。`analyzed_at` 标记是否已分析。

### workout_logs — 训练记录（**一行 = 一组**）
`workout_day / exercise / set_index / weight_kg / reps / rir / is_warmup / rest_sec / performed_at / notes`。

0008 起粒度从「一行一个动作」降到「一行一组」——第三组掉重量、最后一组冲 PR 这类信息在旧结构里是丢的。`set_index` 是同一天同一动作内的组号（1 起），`unique(user_id, date, exercise, set_index)` 让手表补传可以直接 upsert。`is_warmup` 的组不计入容量、PR 与平均 RIR；`rest_sec` 是这组做完之后休息了多久（手表计时器写入，可空）。

历史数据在 0008 里按原 `sets` 展开（4 组 → 4 行），逐日容量与迁移前完全一致，原表备份在 `workout_logs_backup_0008`。

### agent_mutations — AI 教练改动日志（0010）
AI 私教每改一行留一条行级快照，供按对话轮次一键撤销。`before` 为空表示这行是新增的，`after` 为空表示这行被删了，两者都有就是被改过。

撤销时按 `seq` **倒序**重放：同一轮里先建训练日再加动作，倒着退才不撞外键；删除方向记账时子行在前、父行在后，倒序重放就成了先插回父行再插回子行。插回去连 `id` 一起还原——`plan_exercises.id` 被手表端引用着，换新 id 等于把引用悄悄弄断。

⚠️ `plan_days` 删除会级联带走 `plan_exercises`，级联不经过应用层、不会自己留记录，所以删训练日必须先把子行逐条抄进来。见 `lib/actions/agent.ts`。

### ai_presets — AI 供应商预设（0011）
设置页保存的多套 AI 配置（含密钥），每用户至多一套激活——部分唯一索引 `uq_ai_presets_one_active` 在数据库层强制，两套同时“生效”这种静默错误不可能发生。生效优先级：激活的预设 > 环境变量（见 `lib/ai/client.ts` 的 `resolveAiConfig`，每次 AI 请求实时读取，切换立即生效）。

激活切换的顺序是**先撤旧再立新**（`lib/actions/settings.ts`），顺序反了会撞上面的索引。密钥明文存储但 RLS 隔离，且应用层永不把完整密钥回显给前端（编辑时留空 = 保留原值）。


### ai_analyses — AI 综合分析报告留档
每次"分析最近N天"存一条，`report` 为结构化 JSON (见 `lib/types/database.ts` 的 `AiAnalysisReport`)。

## 视图

- **v_exercise_pr**：每个动作的历史最大重量 + Epley 估算 1RM (`weight × (1 + reps/30)`)，热身组除外
- **v_exercise_last**：每个动作**上一次**训练的汇总（最近一天，非最后一组）：`last_date / last_weight_kg / last_sets / last_reps / last_rir`，供网页与手表预填
- **v_exercise_sessions**：一次训练里某个动作的汇总 —— `sets / warmup_sets / top_weight_kg / total_reps / volume_kg / avg_rir / rest_total_sec / dropped`。网页列表、力量曲线、AI 分析都读它，避免把一天的 4 组画成 4 个重叠的点
- **v_daily_nutrition**：每日热量/蛋白/碳水/脂肪汇总 + 未分析条数

## 安全

- 所有表启用 **RLS**，用户只能访问 `user_id = auth.uid()` 的行
- 数值字段 CHECK 约束防脏数据
- `updated_at` 由触发器统一维护

## 如何应用

1. Supabase 项目 → SQL Editor
2. 粘贴 `supabase/migrations/0001_init_schema.sql` 执行
3. 在 Auth → Users 注册账号后，profile 会自动创建
