"use client";

// ============================================================================
// AI 私教对话框
//
// 走 SSE 而不是普通 fetch: 一轮里可能调好几次工具, 全程十几秒。没有过程反馈的话
// 用户面对的是十几秒空白, 也不知道 AI 在读什么、改了什么。
// ============================================================================
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Card, Badge, runAction } from "@/components/ui";
import { undoTurn, confirmDelete, latestUndoableTurn } from "@/lib/actions/agent";
import { toast } from "@/lib/utils/toast";

type PendingDelete = {
  kind: "plan_exercise" | "plan_day";
  id: string;
  label: string;
  cascade?: string;
};

type Msg = {
  role: "user" | "assistant";
  content: string;
  /** 这条回复过程中调用过的工具 (中文名), 折叠显示 */
  tools?: string[];
  /** 有改动才有值, 撤销以它为单位 */
  turnId?: string | null;
  mutationCount?: number;
  undone?: boolean;
  pendingDeletes?: PendingDelete[];
};

/** 工具名 → 给人看的说法 */
const TOOL_LABEL: Record<string, string> = {
  get_today: "查看今天的安排",
  get_plan: "读取训练计划",
  query_workouts: "翻训练记录",
  get_prs: "查历史最好成绩",
  query_metrics: "查身体数据",
  query_nutrition: "查饮食记录",
  add_plan_day: "新增训练日",
  add_plan_exercises: "添加动作",
  update_plan_exercise: "修改动作",
  update_plan_day: "修改训练日",
  move_plan_exercise: "调整动作顺序",
  request_delete_plan_exercise: "请求删除动作",
  request_delete_plan_day: "请求删除训练日",
};

// ---------------------------------------------------------------------------
// 写权限开关
//
// 它是「这台设备上我愿意让 AI 动手到什么程度」, 属于偏好而不是账号设置,
// 所以放 localStorage, 不为它建表。
//
// 用 useSyncExternalStore 而不是 useState + useEffect 读取: 后者要在 effect 里
// setState, 会多触发一次渲染 (新版 react-hooks 规则直接判错)。顺带两个好处 ——
// 服务端快照恒为 false, 首屏渲染出来就是「只读」这个安全默认, 不会先闪一下
// 「可写」; 多个标签页开着时也能跟着 storage 事件一起变。
// ---------------------------------------------------------------------------
const WRITE_PREF_KEY = "coach-can-write";
const PREF_EVENT = "coach-pref-change";

function subscribePref(cb: () => void) {
  window.addEventListener(PREF_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(PREF_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function readPref() {
  return localStorage.getItem(WRITE_PREF_KEY) === "1";
}

function writePref(v: boolean) {
  localStorage.setItem(WRITE_PREF_KEY, v ? "1" : "0");
  window.dispatchEvent(new Event(PREF_EVENT));
}

const SUGGESTIONS = [
  "我周六也想练胸，帮我在计划里加几个简单动作",
  "看看我最近一个月练得怎么样",
  "我最近深蹲一直上不去，有什么建议",
];

// ---------------------------------------------------------------------------
// 会话持久化 (localStorage)
//
// 消息只活在这个组件的 state 里, 离开分析页再回来就是一场新对话 --
// 撤销条跟着消失, 哪怕服务器上那轮改动根本还没撤。所以把消息列表
// (连同 turnId/撤销状态/删除确认) 存进 localStorage, 挂载时恢复。
//
// 只存本设备: 跨设备的对话同步要建表(二期), 这里先把「来回导航就丢」
// 这个最高频的坑填掉。
// ---------------------------------------------------------------------------
const HISTORY_KEY = "coach-messages-v1";
/** 上限防无限膨胀: 撤销条只挂在最后几条上, 更早的消息没有关键状态 */
const HISTORY_MAX = 60;

export default function CoachChat() {
  const router = useRouter();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  /** 服务器上最近一轮未撤销的改动; 不在当前消息列表里才显示恢复条 */
  const [recovered, setRecovered] = useState<Awaited<ReturnType<typeof latestUndoableTurn>>>(null);
  const canWrite = useSyncExternalStore(subscribePref, readPref, () => false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 首帧(恢复完成前)不落盘, 否则空数组会把刚存的历史覆盖掉
  const hydrated = useRef(false);
  // msgs 的最新引用, 供挂载 effect 里的异步回调读到恢复后的消息
  const msgsRef = useRef(msgs);

  // 挂载: 恢复本地会话 + 问服务器还有没有没撤的轮次
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Msg[];
        if (Array.isArray(saved) && saved.length) {
          // 流式中断会留下一条空 assistant 消息, 恢复时丢掉
          //
          // 豁免 set-state-in-effect: 「挂载时从 localStorage 恢复一次」没有
          // 对应的订阅源, useSyncExternalStore 不适用(SSR 快照与客户端首帧
          // 必须一致, 而这里恰恰要不一致); 也无法放进 useState 初始化器 --
          // 那会在服务端渲染时炸掉。多出的一次渲染只发生在挂载时。
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setMsgs(saved.filter((m) => m.role === "user" || m.content));
        }
      }
    } catch {
      // 历史坏了就当没有, 不影响新对话
    }
    hydrated.current = true;

    latestUndoableTurn().then((t) => {
      // 本轮已在消息列表里有撤销条的话, 恢复条就多余了
      setRecovered(t && msgsRef.current.some((m) => m.turnId === t.turnId) ? null : t);
    });
  }, []);

  useEffect(() => {
    msgsRef.current = msgs;
    if (hydrated.current && !pending) {
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(msgs.slice(-HISTORY_MAX)));
      } catch {
        // 存储满了等场景: 静默放弃, 不打断聊天
      }
    }
  }, [msgs, pending]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, status]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || pending) return;

    setInput("");
    setPending(true);
    setStatus("思考中…");

    const history = msgs.map((m) => ({ role: m.role, content: m.content }));
    setMsgs((prev) => [...prev, { role: "user", content: message }, { role: "assistant", content: "" }]);

    const tools: string[] = [];

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history, canWrite }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: "请求失败" }));
        throw new Error(err.error || `请求失败 (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      // SSE 一帧是 "data: {...}\n\n"。网络分片不保证按帧到达, 所以要留着
      // 半截缓冲, 只处理已经收全的帧
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";

        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith("data:")) continue;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          handleEvent(ev, tools, setMsgs, setStatus);
        }
      }
    } catch (e) {
      const text = e instanceof Error ? e.message : "出错了";
      setMsgs((prev) => patchLast(prev, (m) => ({ ...m, content: m.content || `⚠️ ${text}` })));
      toast(text, "error");
    } finally {
      setPending(false);
      setStatus("");
      // AI 可能刚改过计划, 让页面上的服务端数据跟上
      router.refresh();
    }
  }

  async function onUndo(turnId: string, idx: number) {
    const fd = new FormData();
    fd.set("turn_id", turnId);
    const res = await runAction(undoTurn(fd));
    if (!res.error) {
      setMsgs((prev) => prev.map((m, i) => (i === idx ? { ...m, undone: true } : m)));
      toast("已撤销这轮改动", "success");
      router.refresh();
    }
  }

  /** 撤销恢复条上的那轮 -- 不在消息列表里, 撤完把条收掉即可 */
  async function onUndoRecovered(turnId: string) {
    const fd = new FormData();
    fd.set("turn_id", turnId);
    const res = await runAction(undoTurn(fd));
    if (!res.error) {
      setRecovered(null);
      toast("已撤销这轮改动", "success");
      router.refresh();
    }
  }

  function clearChat() {
    setMsgs([]);
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      // 忽略
    }
  }

  async function onConfirmDelete(d: PendingDelete, idx: number) {
    const fd = new FormData();
    fd.set("kind", d.kind);
    fd.set("id", d.id);
    const res = await runAction(confirmDelete(fd));
    if (!res.error) {
      setMsgs((prev) =>
        prev.map((m, i) =>
          i === idx ? { ...m, pendingDeletes: m.pendingDeletes?.filter((p) => p.id !== d.id) } : m,
        ),
      );
      toast("已删除", "success");
      router.refresh();
    }
  }

  function dismissDelete(d: PendingDelete, idx: number) {
    setMsgs((prev) =>
      prev.map((m, i) =>
        i === idx ? { ...m, pendingDeletes: m.pendingDeletes?.filter((p) => p.id !== d.id) } : m,
      ),
    );
  }

  return (
    <Card className="flex h-[32rem] flex-col overflow-hidden">
      {/* 消息区 */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {/* 服务器上还有没撤的轮次, 但对应消息不在本会话里(刷新/换设备/清空过) */}
        {recovered && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs dark:border-emerald-900 dark:bg-emerald-950/50">
            <span className="flex-1 text-emerald-700 dark:text-emerald-300">
              上次 AI 改了 {recovered.mutationCount} 处，还没有撤销
            </span>
            <button
              onClick={() => onUndoRecovered(recovered.turnId)}
              className="rounded-md px-2 py-1 font-medium text-emerald-700 transition hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-900"
            >
              撤销
            </button>
          </div>
        )}

        {msgs.length === 0 && (
          <div className="py-6 text-center">
            <div className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
              问点什么，或者让我改计划
            </div>
            <div className="mt-1 text-xs text-neutral-400">
              我能看到你全部的训练、饮食和身体数据
            </div>
            <div className="mt-4 flex flex-col items-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="max-w-full rounded-full border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600 transition hover:border-indigo-400 hover:text-indigo-600 dark:border-neutral-700 dark:text-neutral-300"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-3.5 py-2 text-sm text-white">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="space-y-2">
              {!!m.tools?.length && (
                <div className="flex flex-wrap gap-1">
                  {m.tools.map((t, j) => (
                    <span key={j} className="text-[11px] text-neutral-400">
                      · {t}
                    </span>
                  ))}
                </div>
              )}

              {m.content && (
                <div className="max-w-[92%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-neutral-100 px-3.5 py-2 text-sm text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100">
                  {m.content}
                </div>
              )}

              {/* 撤销条 */}
              {m.turnId && !!m.mutationCount && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs dark:border-emerald-900 dark:bg-emerald-950/50">
                  {m.undone ? (
                    <span className="text-neutral-500">已撤销这轮改动</span>
                  ) : (
                    <>
                      <span className="flex-1 text-emerald-700 dark:text-emerald-300">
                        ✓ 已写入 {m.mutationCount} 处改动
                      </span>
                      <button
                        onClick={() => onUndo(m.turnId!, i)}
                        className="rounded-md px-2 py-1 font-medium text-emerald-700 transition hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-900"
                      >
                        撤销
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* 删除确认: AI 提得出请求, 但删不掉, 必须你点 */}
              {m.pendingDeletes?.map((d) => (
                <div
                  key={d.id}
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs dark:border-red-900 dark:bg-red-950/50"
                >
                  <div className="font-medium text-red-700 dark:text-red-300">
                    要删除 {d.label} 吗？
                  </div>
                  {d.cascade && <div className="mt-0.5 text-red-500">{d.cascade}</div>}
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => onConfirmDelete(d, i)}
                      className="rounded-md bg-red-600 px-2.5 py-1 font-medium text-white transition hover:bg-red-700"
                    >
                      确认删除
                    </button>
                    <button
                      onClick={() => dismissDelete(d, i)}
                      className="rounded-md px-2.5 py-1 text-neutral-500 transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    >
                      不用了
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ),
        )}

        {status && <div className="text-xs text-neutral-400">{status}</div>}
      </div>

      {/* 输入区 */}
      <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={canWrite ? "说点什么，我可以直接改计划" : "说点什么（当前只读）"}
            disabled={pending}
            className="input flex-1"
          />
          <button type="submit" disabled={pending || !input.trim()} className="btn btn-primary">
            {pending ? "…" : "发送"}
          </button>
        </form>

        {/* 权限开关 */}
        <div className="mt-2 flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-500">
            <input
              type="checkbox"
              checked={canWrite}
              onChange={(e) => writePref(e.target.checked)}
              className="h-3.5 w-3.5 accent-indigo-600"
            />
            允许直接改训练计划
          </label>
          {canWrite ? (
            <Badge color="amber">可写</Badge>
          ) : (
            <Badge color="neutral">只读</Badge>
          )}
          {msgs.length > 0 && !pending && (
            <button
              onClick={clearChat}
              className="text-[11px] text-neutral-400 underline-offset-2 transition hover:text-neutral-600 hover:underline dark:hover:text-neutral-300"
            >
              清空对话
            </button>
          )}
          <span className="ml-auto text-[11px] text-neutral-400">
            {canWrite ? "改动可一键撤销，删除仍需你确认" : "AI 只能看和建议，不会动数据"}
          </span>
        </div>
      </div>
    </Card>
  );
}

/** 处理一个 SSE 事件, 把它落到最后那条 assistant 消息上 */
function handleEvent(
  ev: Record<string, unknown>,
  tools: string[],
  setMsgs: React.Dispatch<React.SetStateAction<Msg[]>>,
  setStatus: (s: string) => void,
) {
  switch (ev.type) {
    case "text":
      setStatus("");
      setMsgs((prev) => patchLast(prev, (m) => ({ ...m, content: m.content + String(ev.text) })));
      break;

    case "tool_call": {
      const label = TOOL_LABEL[String(ev.name)] ?? String(ev.name);
      tools.push(label);
      setStatus(`${label}…`);
      setMsgs((prev) => patchLast(prev, (m) => ({ ...m, tools: [...tools] })));
      break;
    }

    case "warn":
      toast(String(ev.message), "error");
      break;

    case "error":
      setMsgs((prev) =>
        patchLast(prev, (m) => ({ ...m, content: m.content || `⚠️ ${String(ev.message)}` })),
      );
      break;

    case "done":
      setStatus("");
      setMsgs((prev) =>
        patchLast(prev, (m) => ({
          ...m,
          // 流式文本已经逐字拼好了; done 里的整段只在流式没吐出任何东西时兜底
          content: m.content || String(ev.text ?? ""),
          turnId: (ev.turn_id as string | null) ?? null,
          mutationCount: Number(ev.mutation_count ?? 0),
          pendingDeletes: (ev.pending_deletes as PendingDelete[] | undefined) ?? [],
        })),
      );
      break;
  }
}

/** 把补丁打到数组最后一条上 (那条一定是正在生成的 assistant 消息) */
function patchLast(prev: Msg[], fn: (m: Msg) => Msg): Msg[] {
  if (!prev.length) return prev;
  return prev.map((m, i) => (i === prev.length - 1 ? fn(m) : m));
}
