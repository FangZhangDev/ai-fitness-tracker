// ============================================================================
// Supabase 浏览器端客户端 (Client Component 中使用)
// 基于 @supabase/ssr, 自动处理 cookie / 会话
// ============================================================================
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/types/database";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
