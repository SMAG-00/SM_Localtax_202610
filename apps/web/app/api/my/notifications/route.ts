import { getViewer, isSameSiteRequest } from "@/lib/server/dal";
import { featureOn } from "@/lib/server/brief/policy";
import { followRegion, markRead, saveNotiPrefs } from "@/lib/server/notify/service";
import { adminClient } from "@/lib/server/supabase";
import { BRIEFING_MODES, NOTI_FREQUENCIES, NOTI_UI_KINDS, type BriefingMode, type NotiFrequency, type NotiKind } from "@/lib/notify/logic";

// 알림 설정·읽음·지역 따르기 (W13-d, NOTI-01) - 로그인한 본인만, 같은 사이트 요청만. 기능 키 my_notifications가 꺼지면 404.
// 동의 문구는 여기서 만들지 않는다 - 수신 동의(receive)가 없으면 DB 함수가 거부(no_consent)한다.
export const dynamic = "force-dynamic";
const H = { "cache-control": "private, no-store", "x-robots-tag": "noindex" } as const;

function back(request: Request, query: string): Response {
  return new Response(null, { status: 303, headers: { ...H, location: `/my/notifications${query}` } });
}

export async function POST(request: Request) {
  const db = adminClient();
  if (!db) return Response.json({ error: "server_config" }, { status: 503, headers: H });
  if (!isSameSiteRequest(request)) return Response.json({ error: "cross_site" }, { status: 403, headers: H });
  if (!(await featureOn(db, "my_notifications").catch(() => false))) return Response.json({ error: "not_found" }, { status: 404, headers: H });
  const viewer = await getViewer(request).catch(() => null);
  if (!viewer) return Response.json({ error: "unauthorized" }, { status: 401, headers: H });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400, headers: H });
  }
  const action = form.get("action");
  if (action === "save") {
    const kinds = form.getAll("kinds").filter((k): k is NotiKind => typeof k === "string" && (NOTI_UI_KINDS as readonly string[]).includes(k));
    const freq = form.get("frequency");
    const briefing = form.get("briefing");
    if (typeof freq !== "string" || !(NOTI_FREQUENCIES as readonly string[]).includes(freq) || typeof briefing !== "string" || !(BRIEFING_MODES as readonly string[]).includes(briefing)) {
      return Response.json({ error: "bad_request" }, { status: 400, headers: H });
    }
    const r = await saveNotiPrefs(db, viewer.userId, { kinds, frequency: freq as NotiFrequency, briefing: briefing as BriefingMode });
    return back(request, r.ok ? "?saved=1" : `?error=${r.code ?? "invalid"}`);
  }
  if (action === "follow") {
    const code = form.get("region");
    const r = await followRegion(db, viewer.userId, typeof code === "string" ? code : "");
    return back(request, r.ok ? "?saved=1" : `?error=${r.code ?? "invalid"}`);
  }
  if (action === "read") {
    const id = Number(form.get("id"));
    if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "bad_request" }, { status: 400, headers: H });
    const kind = await markRead(db, viewer.userId, id, new Date());
    if (!kind) return Response.json({ error: "not_found" }, { status: 404, headers: H });
    return Response.json({ ok: true, kind }, { status: 200, headers: H });
  }
  return Response.json({ error: "bad_request" }, { status: 400, headers: H });
}
