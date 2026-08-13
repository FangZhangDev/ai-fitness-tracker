// 服务端通用助手: 获取当前登录用户 (未登录抛错, 由中间件拦截)
import { createClient } from "@/lib/supabase/server";

export async function getCurrentUser() {
  const supabase = await createClient();
  // 用 getClaims 而非 getUser: 本项目 JWT 为 ES256 非对称签名, getClaims 会
  // 拉一次 JWKS 后在本地验签(实测首次 ~570ms, 之后 ~1ms), 而 getUser 每次都要
  // 往返境外 auth 服务器(实测 ~550ms)。页面渲染前 proxy.ts 已调用 getUser 完成
  // 校验与会话刷新, 这里只需取出已验证的身份, 无需再打一次网络。
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) throw new Error("未登录");
  return { supabase, userId };
}
