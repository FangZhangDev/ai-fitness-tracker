import { getCurrentUser } from "@/lib/utils/server";
import { SectionTitle } from "@/components/ui";
import ProfileForm from "@/components/profile-form";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const { supabase, userId } = await getCurrentUser();
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();

  return (
    <div className="space-y-4">
      <SectionTitle title="个人资料" desc="身高、体重目标与活动水平，用于热量与 AI 分析参考" />
      <ProfileForm profile={profile} />
    </div>
  );
}
