// ============================================================================
// 代理(原 middleware): 刷新 Supabase 会话 + 路由保护
// Next.js 16 起 middleware 文件约定更名为 proxy, 导出函数名也随之改为 proxy
// - 未登录访问受保护路由 → 重定向 /login
// - 已登录访问 /login → 重定向 /
// ============================================================================
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/types/database";

export async function proxy(request: NextRequest) {
  // 构造响应, 后续在 supabase.setAll 中同步 cookie 到 request/response
  const response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  // getUser 会刷新会话 (写回 cookie)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = pathname.startsWith("/login") || pathname.startsWith("/auth");

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.delete("next");
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // 排除静态资源与 API
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api|.*\\.).*)"],
};
