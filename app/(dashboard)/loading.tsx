import { SkelLine, SkelStat, SkelChart } from "@/components/skeleton";

/**
 * 整个 dashboard 组共用一份骨架屏。
 *
 * 放在组这一层而不是每个页面各写一份 —— 各页面结构不同, 但「标题 + 几张卡」
 * 这个轮廓是共通的, 一份就够, 也省得每加一个页面就漏掉一个 loading.tsx。
 * 某个页面确实需要更贴合的骨架时, 在它自己的目录下加 loading.tsx 覆盖即可。
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      {/* SectionTitle */}
      <div className="mb-4">
        <SkelLine className="h-6 w-28" />
        <SkelLine className="mt-2 h-3.5 w-44" />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SkelStat />
        <SkelStat />
        <SkelStat />
        <SkelStat />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SkelChart />
        <SkelChart />
      </div>
    </div>
  );
}
