"use client";

import { useActionState } from "react";
import { upsertProfile } from "@/lib/actions/profile";
import type { Profile } from "@/lib/types/database";
import { Card, Field } from "@/components/ui";
import { ACTIVITY_LABEL } from "@/components/ui";

export default function ProfileForm({ profile }: { profile: Profile | null }) {
  const [state, formAction, pending] = useActionState(upsertProfile, undefined);

  return (
    <Card className="max-w-xl p-5">
      <form action={formAction} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="身高 (cm)">
            <input name="height_cm" type="number" step="0.1" defaultValue={profile?.height_cm ?? ""} className="input" />
          </Field>
          <Field label="当前体重 (kg)">
            <input name="current_weight_kg" type="number" step="0.1" defaultValue={profile?.current_weight_kg ?? ""} className="input" />
          </Field>
          <Field label="目标体重 (kg)">
            <input name="target_weight_kg" type="number" step="0.1" defaultValue={profile?.target_weight_kg ?? ""} className="input" />
          </Field>
          <Field label="活动水平">
            <select name="activity_level" defaultValue={profile?.activity_level ?? ""} className="input">
              <option value="">不填</option>
              {Object.entries(ACTIVITY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="健身目标">
          <input name="goal" defaultValue={profile?.goal ?? ""} className="input" placeholder="如：增肌 / 减脂 / 力量提升" />
        </Field>

        {state?.error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-300">{state.error}</div>}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending} className="btn btn-primary">
            {pending ? "保存中..." : "保存"}
          </button>
          {state && !state.error && <span className="text-sm text-emerald-600">已保存 ✓</span>}
        </div>
      </form>
    </Card>
  );
}
