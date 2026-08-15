import { SkelLine, SkelCard, SkelChart, SkelList } from "@/components/skeleton";

/** 身体页: 录入表单 + 体重趋势图 + 历史列表 */
export default function BodyLoading() {
  return (
    <div className="space-y-4">
      <div className="mb-4">
        <SkelLine className="h-6 w-24" />
        <SkelLine className="mt-2 h-3.5 w-48" />
      </div>
      <SkelCard>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <SkelLine className="h-14" />
          <SkelLine className="h-14" />
          <SkelLine className="h-14" />
          <SkelLine className="h-14" />
        </div>
      </SkelCard>
      <SkelChart />
      <SkelList rows={6} />
    </div>
  );
}
