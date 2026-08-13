import { getCurrentUser } from "@/lib/utils/server";
import { SectionTitle } from "@/components/ui";
import MealsManager from "@/components/meals-manager";

export const dynamic = "force-dynamic";
// 提交饮食时同步调用 AI 估算营养, 留出余量避免 Vercel 函数超时
export const maxDuration = 30;

export default async function MealsPage() {
  const { supabase } = await getCurrentUser();
  const { data } = await supabase
    .from("meal_logs")
    .select("*")
    .order("date", { ascending: false })
    .limit(80);

  return (
    <div className="space-y-4">
      <SectionTitle title="饮食记录" desc="自然语言输入，AI 自动估算营养" />
      <MealsManager list={data ?? []} />
    </div>
  );
}
