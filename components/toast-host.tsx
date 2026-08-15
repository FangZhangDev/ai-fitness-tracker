"use client";

import { useEffect, useState } from "react";
import { TOAST_EVENT, type ToastDetail } from "@/lib/utils/toast";

/** 一条提示挂多久 (ms); 出错的多留一会儿, 那种一般要看清内容 */
const HOLD_MS = { error: 6000, success: 2500, info: 3500 } as const;

/**
 * 轻提示的渲染端, 挂在 dashboard 布局里, 全局一份。
 *
 * 替掉原来的 window.alert —— alert 会阻塞整个页面、样式是浏览器原生的,
 * 手机上尤其突兀, 而且必须点一下才能继续。
 * 这里手写不到 60 行, 不引任何库。
 */
export function ToastHost() {
  const [items, setItems] = useState<ToastDetail[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<ToastDetail>).detail;
      if (!detail?.message) return;
      setItems((cur) => [...cur, detail]);
      setTimeout(
        () => setItems((cur) => cur.filter((t) => t.id !== detail.id)),
        HOLD_MS[detail.kind] ?? HOLD_MS.info,
      );
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);

  if (!items.length) return null;

  return (
    // 底部居中: 手机上底部有 tab 栏, 垫高一点免得压在上面
    <div
      className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6"
      role="status"
      aria-live="polite"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto max-w-md rounded-lg border px-4 py-2.5 text-sm shadow-lg ${STYLE[t.kind]}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

const STYLE: Record<ToastDetail["kind"], string> = {
  error:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  info: "border-neutral-200 bg-white text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200",
};
