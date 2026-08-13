// ============================================================================
// Supabase 服务端客户端 (Server Component / Route Handler / Server Action 中使用)
// 通过 cookies() 读写会话, 支持App Router
// ============================================================================
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/types/database";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // 在 Server Component 中调用 set 会抛错 (只读上下文)
            // 可忽略: 中间件会刷新会话
          }
        },
      },
    },
  );
}
