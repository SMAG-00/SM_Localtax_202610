import { getViewer, isSameSiteRequest } from "@/lib/server/dal";
import { adminClient } from "@/lib/server/supabase";
import { MODE_COOKIE, parseMode } from "@/lib/server/workspace/logic";
import { loadAccess, writeMode } from "@/lib/server/workspace/store";

// 모드 토글 (W13-b, WS-01) - 로그인 회원은 계정(workspace_prefs)에, 비로그인은 기기 쿠키에 저장한다.
// 모드는 표현 밀도 선호일 뿐이다 - 이 API는 권한을 바꾸지 않고, 다른 어떤 판정도 모드를 읽지 않는다.
export const dynamic = "force-dynamic";
const H = { "cache-control": "private, no-store", "x-robots-tag": "noindex" } as const;

export async function POST(request: Request) {
  const db = adminClient();
  if (!db) return Response.json({ error: "server_config" }, { status: 503, headers: H });
  if (!isSameSiteRequest(request)) return Response.json({ error: "cross_site" }, { status: 403, headers: H });
  const viewer = await getViewer(request).catch(() => null);
  const { view } = await loadAccess(db, viewer?.userId ?? null);
  if (view === "closed") return Response.json({ error: "not_found" }, { status: 404, headers: H });
  let raw: unknown;
  const type = request.headers.get("content-type") ?? "";
  try {
    raw = type.includes("application/json") ? ((await request.json()) as { mode?: unknown }).mode : ((await request.formData()).get("mode") as unknown);
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400, headers: H });
  }
  if (raw !== "general" && raw !== "expert") return Response.json({ error: "bad_request" }, { status: 400, headers: H });
  const mode = parseMode(raw);
  if (viewer) await writeMode(db, viewer.userId, mode);
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  const headers = new Headers(H);
  headers.append("set-cookie", `${MODE_COOKIE}=${mode}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`);
  if (!type.includes("application/json")) {
    headers.set("location", "/workspace");
    return new Response(null, { status: 303, headers });
  }
  return Response.json({ ok: true, mode }, { status: 200, headers });
}
