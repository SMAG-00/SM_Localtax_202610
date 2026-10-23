import { FEEDBACK_KINDS, recordFeedback, type FeedbackKind } from "@/lib/server/assistant/store";
import { resolveExposure } from "@/lib/server/assistant/service";

// 대화 끝맺음 표시 (CHAT-13) — 도움됨·아니에요·링크 클릭·전문가/고객센터 버튼. 질문 원문은 받지 않는다 (세션 id + 종류만).
export const dynamic = "force-dynamic";
const HEADERS = { "cache-control": "no-store", "x-robots-tag": "noindex" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function POST(request: Request) {
  const { exposure, client } = await resolveExposure(request);
  if (exposure === "off" || !client) return Response.json({ error: "not found" }, { status: 404, headers: HEADERS });
  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return Response.json({ error: "JSON이 아닙니다" }, { status: 400, headers: HEADERS });
  }
  const o = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const extra = Object.keys(o).find((k) => k !== "sessionId" && k !== "kind");
  if (extra || typeof o.sessionId !== "string" || !UUID.test(o.sessionId) || !(FEEDBACK_KINDS as readonly unknown[]).includes(o.kind)) {
    return Response.json({ error: "요청 모양이 틀립니다" }, { status: 400, headers: HEADERS });
  }
  const ok = await recordFeedback(client, o.sessionId, o.kind as FeedbackKind);
  return Response.json({ ok }, { headers: HEADERS });
}
