import { getViewer, isSameSiteRequest } from "@/lib/server/dal";
import { featureOn } from "@/lib/server/brief/policy";
import { openBriefing } from "@/lib/server/notify/service";
import { adminClient } from "@/lib/server/supabase";

// 브리핑 열람 표시 (W13-d, WS-06) - 본인 브리핑만. 기능 키 my_briefings가 꺼지면 404.
export const dynamic = "force-dynamic";
const H = { "cache-control": "private, no-store", "x-robots-tag": "noindex" } as const;

export async function POST(request: Request) {
  const db = adminClient();
  if (!db) return Response.json({ error: "server_config" }, { status: 503, headers: H });
  if (!isSameSiteRequest(request)) return Response.json({ error: "cross_site" }, { status: 403, headers: H });
  if (!(await featureOn(db, "my_briefings").catch(() => false))) return Response.json({ error: "not_found" }, { status: 404, headers: H });
  const viewer = await getViewer(request).catch(() => null);
  if (!viewer) return Response.json({ error: "unauthorized" }, { status: 401, headers: H });
  const id = Number((await request.json().catch(() => ({}))).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "bad_request" }, { status: 400, headers: H });
  const channel = await openBriefing(db, viewer.userId, id, new Date());
  if (!channel) return Response.json({ error: "not_found" }, { status: 404, headers: H });
  return Response.json({ ok: true, channel }, { status: 200, headers: H });
}
