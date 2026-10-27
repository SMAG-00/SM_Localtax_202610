import { deleteMySession, memberSaveSet, saveOff } from "@/lib/server/agent/d-store";
import { getViewer } from "@/lib/server/dal";
import { adminClient } from "@/lib/server/supabase";

// 내 대화 기록 관리 (W12-d d5 - ASK-12): 삭제, 저장 끄기, 저장 켜기. 로그인한 본인 것만.
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const H = { "cache-control": "no-store", "x-robots-tag": "noindex" } as const;

export async function POST(request: Request) {
  const viewer = await getViewer(request).catch(() => null);
  const admin = adminClient();
  if (!viewer || !admin) return Response.json({ error: "unauthorized" }, { status: 401, headers: H });
  let b: { action?: unknown; sessionId?: unknown };
  try {
    b = (await request.json()) as typeof b;
  } catch {
    return Response.json({ error: "JSON이 아닙니다" }, { status: 400, headers: H });
  }
  const sid = typeof b.sessionId === "string" && UUID.test(b.sessionId) ? b.sessionId : null;
  if (b.action === "delete" && sid) return Response.json({ ok: await deleteMySession(admin, viewer.userId, sid) }, { headers: H });
  if (b.action === "save_off") {
    const ok = sid ? await saveOff(admin, { sessionId: sid, userId: viewer.userId, remember: true }) : await memberSaveSet(admin, viewer.userId, false);
    return Response.json({ ok }, { headers: H });
  }
  if (b.action === "save_on") return Response.json({ ok: await memberSaveSet(admin, viewer.userId, true) }, { headers: H });
  return Response.json({ error: "요청 값이 틀립니다" }, { status: 400, headers: H });
}
