import { readModeGate, submitFeedback } from "@/lib/server/agent/d-store";
import { askAllowed } from "@/lib/agent/rollout";
import { parseFeedback } from "@/lib/agent/feedback";
import { viewerIsInternal } from "@/lib/server/assistant/service";
import { db } from "@/lib/server/assistant/store";
import { getViewer } from "@/lib/server/dal";

// 지방세봇 피드백·오류 신고 (W12-d d4 - ASK-11). 모드 버튼과 같은 공개 판정을 쓰고, 자유 글은 받지 않는다.
export const dynamic = "force-dynamic";
const H = { "cache-control": "no-store", "x-robots-tag": "noindex" } as const;

export async function POST(request: Request) {
  const client = db();
  if (!client) return Response.json({ error: "not found" }, { status: 404, headers: H });
  const internal = await viewerIsInternal(request);
  const viewer = await getViewer(request).catch(() => null);
  if (!askAllowed(await readModeGate(client), internal ? "internal" : viewer ? "member" : "guest")) return Response.json({ error: "not found" }, { status: 404, headers: H });
  const raw = await request.text();
  if (raw.length > 1000) return Response.json({ error: "요청이 너무 깁니다" }, { status: 413, headers: H });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "JSON이 아닙니다" }, { status: 400, headers: H });
  }
  const p = parseFeedback(body);
  if (!p.ok) return Response.json({ error: p.error }, { status: 400, headers: H });
  const ok = await submitFeedback(client, p.value);
  return Response.json({ ok }, { status: ok ? 200 : 404, headers: H });
}
