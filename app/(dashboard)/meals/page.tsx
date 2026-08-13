import { getCurrentUser } from "@/lib/utils/server";
import { SectionTitle } from "@/components/ui";
import MealsManager from "@/components/meals-manager";

export const dynamic = "force-dynamic";

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
