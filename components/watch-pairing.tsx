"use client";

import { useEffect, useState, useTransition } from "react";
import {
  createPairingCode,
  revokeWatchDevice,
  type PairingCode,
  type WatchDevice,
} from "@/lib/actions/watch";
import { Card, EmptyState } from "@/components/ui";

/** 剩余秒数 → mm:ss */
function fmtLeft(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function WatchPairing({ devices }: { devices: WatchDevice[] }) {
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [error, setError] = useState<string>("");
  const [left, setLeft] = useState(0);
  const [pending, start] = useTransition();

  // 配对码倒计时
  useEffect(() => {
    if (!pairing) return;
    const tick = () => {
      const ms = new Date(pairing.expiresAt).getTime() - Date.now();
      setLeft(Math.max(0, Math.floor(ms / 1000)));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [pairing]);

  const expired = pairing !== null && left <= 0;

  function generate() {
    setError("");
    start(async () => {
      const res = await createPairingCode();
      if (res.error) setError(res.error);
      else if (res.pairing) setPairing(res.pairing);
    });
  }

  return (
    <div className="space-y-6">
      {/* ---- 配对码 ---- */}
      <Card className="p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">配对码</h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              在手表应用里选「配对」，输入这 6 位数字即可。10 分钟内有效，只能用一次。
            </p>
          </div>
          <button onClick={generate} disabled={pending} className="btn btn-primary shrink-0">
            {pending ? "生成中…" : pairing ? "重新生成" : "生成配对码"}
          </button>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/50 dark:text-red-300">
            {error}
          </p>
        )}

        {pairing && (
          <div className="mt-2 flex flex-col items-center rounded-xl border border-neutral-200 py-6 dark:border-neutral-800">
            <div
              className={`font-mono text-5xl font-bold tracking-[0.3em] tabular-nums ${
                expired ? "text-neutral-300 line-through dark:text-neutral-700" : ""
              }`}
            >
              {pairing.code}
            </div>
            <div className="mt-3 text-xs text-neutral-500">
              {expired ? "已过期，请重新生成" : `剩余 ${fmtLeft(left)}`}
            </div>
          </div>
        )}
      </Card>

      {/* ---- 已配对设备 ---- */}
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold">已配对的手表</h2>
        {devices.length === 0 ? (
          <EmptyState
            title="还没有配对任何手表"
            hint="生成配对码后，在手表上输入即可"
          />
        ) : (
          <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{d.name}</div>
                  <div className="mt-0.5 text-xs text-neutral-400">
                    配对于 {new Date(d.created_at).toLocaleString("zh-CN")}
                    {d.last_seen_at &&
                      ` · 最后同步 ${new Date(d.last_seen_at).toLocaleString("zh-CN")}`}
                  </div>
                </div>
                <form action={revokeWatchDevice}>
                  <input type="hidden" name="id" value={d.id} />
                  <button
                    type="submit"
                    className="btn btn-ghost shrink-0 text-red-600 dark:text-red-400"
                  >
                    解绑
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
