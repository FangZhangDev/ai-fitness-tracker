import { SectionTitle, Card } from "@/components/ui";
import { WatchPairing } from "@/components/watch-pairing";
import { listWatchDevices } from "@/lib/actions/watch";

export const dynamic = "force-dynamic";

export default async function WatchPage() {
  const devices = await listWatchDevices();

  return (
    <div className="mx-auto max-w-2xl">
      <SectionTitle
        title="手表"
        desc="把训练计划同步到 vivo Watch 3，在手表上直接查看和记录"
      />

      <WatchPairing devices={devices} />

      <Card className="mt-6 p-5">
        <h2 className="mb-2 text-sm font-semibold">手表上能做什么</h2>
        <ul className="space-y-1.5 text-sm text-neutral-600 dark:text-neutral-300">
          <li>· 查看今天该练什么：动作、目标重量、组数 × 次数</li>
          <li>· 转动表冠微调实际做的重量 / 次数 / RIR，点一下记录</li>
          <li>· 顶部显示今日进度（如「推日 2/5」），一眼知道还剩几个</li>
          <li>· 手机不在身边也能用：计划缓存在手表上，离线记录联网后自动补传</li>
        </ul>
        <p className="mt-3 text-xs text-neutral-400">
          手表上记录的数据会写入「训练记录」，与网页端完全一致。同一天同一个动作重复记录
          会覆盖而非新增，不会产生重复数据。
        </p>
      </Card>
    </div>
  );
}
