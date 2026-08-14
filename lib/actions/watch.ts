"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/utils/server";

export type PairingCode = { code: string; expiresAt: string };
export type PairingResult = { error?: string; pairing?: PairingCode };
export type WatchDevice = {
  id: string;
  name: string;
  created_at: string;
  last_seen_at: string | null;
};

/**
 * 生成一次性配对码 (10 分钟有效)。
 * 手表上输入这 6 位数字即可换取长期 token, 之后不必再登录。
 * 生成新码时, 该用户此前未使用的码会被数据库函数一并作废。
 */
export async function createPairingCode(): Promise<PairingResult> {
  const { supabase } = await getCurrentUser();
  const { data, error } = await supabase.rpc("watch_create_pairing_code");
  if (error) return { error: error.message };

  // 函数返回 table(code, expires_at), supabase-js 收到的是数组
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.code) return { error: "生成失败, 请重试" };

  revalidatePath("/watch");
  return { pairing: { code: row.code, expiresAt: row.expires_at } };
}

/** 已配对的手表列表 */
export async function listWatchDevices(): Promise<WatchDevice[]> {
  const { supabase, userId } = await getCurrentUser();
  const { data } = await supabase
    .from("watch_devices")
    .select("id, name, created_at, last_seen_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  return (data ?? []) as WatchDevice[];
}

/**
 * 解绑手表 — 删掉设备记录, 该手表上的 token 立即失效。
 * 直接用作 <form action>, 因此返回 void; 失败时抛错交给 error.tsx 兜底。
 */
export async function revokeWatchDevice(formData: FormData): Promise<void> {
  const { supabase } = await getCurrentUser();
  const id = formData.get("id")?.toString() ?? "";
  if (!id) throw new Error("缺少设备 id");
  const { error } = await supabase.from("watch_devices").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/watch");
}
