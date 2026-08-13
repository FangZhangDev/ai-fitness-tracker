import { getCurrentUser } from "@/lib/utils/server";
import { SectionTitle } from "@/components/ui";
import AnalysisRunner from "@/components/analysis-runner";

export const dynamic = "force-dynamic";

export default async function AnalysisPage() {
  const { supabase } = await getCurrentUser();
  const { data } = await supabase
    .from("ai_analyses")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <div className="space-y-4">
      <SectionTitle title="AI 健身分析" desc="综合身体、饮食、训练数据的智能评估" />
      <AnalysisRunner latest={data} />
    </div>
  );
}
