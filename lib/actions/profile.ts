"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/utils/server";
import type { ProfileUpdate } from "@/lib/types/database";

export type ActionResult = { error?: string };

export async function upsertProfile(prev: unknown, formData: FormData): Promise<ActionResult> {
  const { supabase, userId } = await getCurrentUser();
  const patch: ProfileUpdate = {
    height_cm: num(formData.get("height_cm")),
    current_weight_kg: num(formData.get("current_weight_kg")),
    target_weight_kg: num(formData.get("target_weight_kg")),
    goal: str(formData.get("goal")),
    activity_level: (str(formData.get("activity_level")) as ProfileUpdate["activity_level"]) || null,
  };
  const { error } = await supabase
    .from("profiles")
    .upsert({ id: userId, ...patch });
  if (error) return { error: error.message };
  revalidatePath("/profile");
  revalidatePath("/");
  return {};
}

function str(v: FormDataEntryValue | null): string {
  return (v?.toString() ?? "").trim() || "";
}
function num(v: FormDataEntryValue | null): number | null {
  const s = v?.toString().trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
