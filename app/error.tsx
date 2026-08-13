"use client";

// 全局错误边界
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="text-3xl">⚠️</div>
      <h1 className="text-lg font-semibold">出错了</h1>
      <p className="max-w-md text-sm text-neutral-500">{error.message || "页面加载时发生未知错误"}</p>
      <button onClick={reset} className="btn btn-primary">重试</button>
    </div>
  );
}
