// 骨架屏原语。
//
// 为什么值得有: 所有页面都是 force-dynamic 的服务端组件, 数据要从东京的 Supabase
// 取好几趟才换屏。在此之前界面纹丝不动 —— 点了没反应是最难受的一种等待。
// 骨架屏不会让它变快, 但会让人立刻知道「点上了, 在加载」。
//
// 纯 CSS(Tailwind 的 animate-pulse), 没有 JS, 也不引任何库。
// motion-reduce 下不闪 —— 系统开了「减少动态效果」就该安静。

export function SkelLine({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-neutral-200 motion-reduce:animate-none dark:bg-neutral-800 ${className}`}
    />
  );
}

export function SkelCard({
  className = "",
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return <div className={`card p-4 ${className}`}>{children}</div>;
}

/** 指标卡: 与 ui.tsx 的 Stat 同高, 免得内容进来时整页跳一下 */
export function SkelStat() {
  return (
    <SkelCard>
      <SkelLine className="h-3 w-12" />
      <SkelLine className="mt-2 h-7 w-20" />
      <SkelLine className="mt-1.5 h-3 w-16" />
    </SkelCard>
  );
}

/** 图表卡: 高度对齐 charts/ 下的 h-64 */
export function SkelChart({ title = true }: { title?: boolean }) {
  return (
    <SkelCard>
      {title && <SkelLine className="mb-3 h-4 w-28" />}
      <SkelLine className="h-64 w-full" />
    </SkelCard>
  );
}

/** 列表卡: n 行等宽条 */
export function SkelList({ rows = 4 }: { rows?: number }) {
  return (
    <SkelCard>
      <SkelLine className="mb-3 h-4 w-24" />
      <div className="space-y-2.5">
        {Array.from({ length: rows }, (_, i) => (
          <SkelLine key={i} className="h-4 w-full" />
        ))}
      </div>
    </SkelCard>
  );
}
