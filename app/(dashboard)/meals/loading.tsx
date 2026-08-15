import { SkelLine, SkelCard, SkelList } from "@/components/skeleton";

/** 饮食页: 录入表单 + 记录列表 */
export default function MealsLoading() {
  return (
    <div className="space-y-4">
      <div className="mb-4">
        <SkelLine className="h-6 w-24" />
        <SkelLine className="mt-2 h-3.5 w-52" />
      </div>
      <SkelCard>
        <SkelLine className="h-4 w-28" />
        <SkelLine className="mt-3 h-24 w-full" />
        <SkelLine className="mt-3 h-9 w-28" />
      </SkelCard>
      <SkelList rows={6} />
    </div>
  );
}
