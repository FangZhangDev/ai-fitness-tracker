import { getCurrentUser } from "@/lib/utils/server";
import { SectionTitle } from "@/components/ui";
import AnalysisRunner from "@/components/analysis-runner";

export const dynamic = "force-dynamic";
// AI 综合分析是同步 Server Action, 实测 7 天数据需 5-7s, 分析区间最长可选 90 天,
// 耗时会显著上升。Vercel 免费版函数默认超时较短, 这里顶到 Hobby 上限 60s。
// (Server Action 的超时按所在 page 的配置生效, 见 Next 文档 route-segment-config/maxDuration)
export const maxDuration = 60;

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
