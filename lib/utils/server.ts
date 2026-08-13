// 服务端通用助手: 获取当前登录用户 (未登录抛错, 由中间件拦截)
import { createClient } from "@/lib/supabase/server";

export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("未登录");
  return { supabase, userId: user.id };
}
