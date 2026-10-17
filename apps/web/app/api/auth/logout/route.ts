import { cookies } from "next/headers";
import { hasAuthCookie } from "@/lib/admin/proxy-rules";
import { cookieSessionClient } from "@/lib/server/session";
import { isSameSiteRequest } from "@/lib/server/dal";
import { errorJson, handle, json } from "@/lib/server/http";

// 편집국 로그아웃 — 이 기기의 세션을 Auth 서버에서 끝내고(refresh token 폐기) 세션 쿠키를 지운다. 같은 사이트 요청만.
export const dynamic = "force-dynamic";

export const POST = handle(async (request: Request) => {
  if (!isSameSiteRequest(request)) return errorJson(403, "다른 사이트에서 온 요청은 받지 않습니다");
  const client = await cookieSessionClient();
  await client.auth.signOut({ scope: "local" });
  // 세션이 이미 끝나 Auth 서버가 거절했어도 남은 쿠키는 지운다
  const store = await cookies();
  for (const c of store.getAll()) if (hasAuthCookie([c.name])) store.set(c.name, "", { path: "/", maxAge: 0 });
  return json({ ok: true });
});
