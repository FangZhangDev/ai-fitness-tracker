import { getCurrentUser } from "@/lib/utils/server";
import { SectionTitle } from "@/components/ui";
import MealsManager from "@/components/meals-manager";

export const dynamic = "force-dynamic";
// 提交饮食时同步调用 AI 估算营养, 留出余量避免 Vercel 函数超时
export const maxDuration = 30;

export default async function MealsPage() {
  const { supabase } = await getCurrentUser();
  // 记录与常吃套餐一起拉, 两个查询互不依赖
  const [{ data }, { data: templates }] = await Promise.all([
    supabase.from("meal_logs").select("*").order("date", { ascending: false }).limit(80),
    // 排序口径与 0007 的索引一致: 手动顺序优先, 其次最近用过、用得多
    supabase
      .from("meal_templates")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("last_used_at", { ascending: false, nullsFirst: false })
      .order("use_count", { ascending: false }),
  ]);

  return (
    <div className="space-y-4">
      <SectionTitle title="饮食记录" desc="自然语言输入，AI 自动估算营养" />
      <MealsManager list={data ?? []} templates={templates ?? []} />
    </div>
  );
}
