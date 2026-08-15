import { SkelLine, SkelCard, SkelChart, SkelList } from "@/components/skeleton";

/** 训练页: 今日计划一大张 + 两张图 + 记录列表, 与实际结构对齐, 免得内容进来时跳动 */
export default function WorkoutsLoading() {
  return (
    <div className="space-y-4">
      <div className="mb-4">
        <SkelLine className="h-6 w-24" />
        <SkelLine className="mt-2 h-3.5 w-56" />
      </div>

      {/* 今日计划记录 */}
      <SkelCard>
        <SkelLine className="h-4 w-40" />
        <div className="mt-3 space-y-2">
          <SkelLine className="h-20 w-full" />
          <SkelLine className="h-20 w-full" />
          <SkelLine className="h-20 w-full" />
        </div>
      </SkelCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SkelChart />
        <SkelList rows={5} />
      </div>

      <SkelList rows={6} />
    </div>
  );
}
