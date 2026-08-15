/**
 * 轻提示 —— 发射端
 *
 * 刻意拆成「发射」与「渲染」两个文件: 发射端是一个普通模块(没有 'use client'),
 * 于是 ui.tsx 那种服务端/客户端通用的文件可以放心引它, 不会把整条引用链拖进
 * 客户端边界。真正渲染的 <ToastHost /> 才是客户端组件。
 *
 * 用自定义事件而不是 context/状态库: 调用点(runAction)是一个普通异步函数,
 * 不在 React 组件里, 拿不到 hook。窗口事件是这里最省事又不引依赖的通道。
 */

export type ToastKind = "error" | "success" | "info";

export type ToastDetail = {
  id: number;
  message: string;
  kind: ToastKind;
};

export const TOAST_EVENT = "app-toast";

let seq = 0;

/** 弹一条提示; 服务端调用是空操作, 不会炸 */
export function toast(message: string, kind: ToastKind = "info") {
  if (typeof window === "undefined") return;
  const detail: ToastDetail = { id: ++seq, message, kind };
  window.dispatchEvent(new CustomEvent<ToastDetail>(TOAST_EVENT, { detail }));
}
