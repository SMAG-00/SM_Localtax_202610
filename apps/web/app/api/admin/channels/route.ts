import { buildKit, kitText, parsePost, type ChannelKey, type KitDraft } from "@/lib/channels/kit";
import { actorOf } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { loadChannelBoard } from "@/lib/server/channels/board";
import { CHANNEL_LABELS } from "@ltr/workflows/ops";

// 채널 배포 키트·게시 기록 (W12-h h4 - CH-01, docs/dev/W12-h_설계.md). 권한 channel.record (편집 책임자·관리자).
//  · GET -> 보드(원고 목록·게시 기록·감사)  /  GET ?kit=<기사 번호>[&format=json] -> 키트 내려받기 (승인된 원고만, 내려받기는 기록)
//  · POST op=post {review_item_id, posted_url, checklist{4칸}, posted_at?} -> 게시 기록 (DB 함수가 승인 상태·UTM·체크리스트를 다시 검사, 거부 409 + 감사 1행)
// 이 경로는 외부 채널로 아무것도 보내지 않는다. 게시는 사람이 각 채널 계정으로 직접 한다.
export const dynamic = "force-dynamic";

const invalid = (errors: string[]) => errorJson(422, "입력값을 확인하세요", { errors });
const posInt = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : Number.NaN;
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
};

/** 기사 본문 이미지 블록의 대체 텍스트 목록 (없으면 빈 목록 - 체크리스트에서 사람이 확인) */
async function altTextsOf(articleId: number): Promise<string[]> {
  const { data } = await serviceDb().from("articles").select("body").eq("id", articleId).limit(1);
  const blocks = ((data?.[0] as { body?: { blocks?: unknown[] } } | undefined)?.body?.blocks ?? []) as { type?: string; alt?: unknown }[];
  return blocks.filter((b) => b?.type === "image" && typeof b.alt === "string" && b.alt.trim() !== "").map((b) => String(b.alt).trim());
}

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const url = new URL(request.url);
  const kit = url.searchParams.get("kit");
  const denied = await authorize(viewer, "channel.record", kit ? `channel:kit:${kit}` : "channel:list");
  if (denied) return denied;
  if (!kit) return json(await loadChannelBoard(serviceDb()));
  const articleId = posInt(kit);
  if (articleId === null) return invalid(["kit: 기사 번호(1 이상 정수)입니다"]);
  const { data, error } = await serviceDb().rpc("channel_kit_get", { p_article_id: articleId, p_actor: actorOf(viewer) });
  if (error) throw dbError(error, "채널 키트 조회");
  const r = data as { ok: boolean; code: string; slug?: string; items: KitDraft[] };
  if (!r.ok) return errorJson(409, r.code === "feature_off" ? "채널 배포 키트 기능이 꺼져 있습니다" : "키트를 만들 수 없습니다", { code: r.code });
  // DB 함수가 승인된 원고만 돌려주므로 status는 승인으로 표시한다 (buildKit은 한 번 더 상태를 본다)
  const bundles = buildKit(r.items.map((i) => ({ ...i, status: "approved" })), await altTextsOf(articleId), CHANNEL_LABELS as Record<ChannelKey, string>);
  if (url.searchParams.get("format") === "json") return json({ slug: r.slug, bundles });
  return new Response(kitText(r.slug ?? String(articleId), bundles), {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="channel-kit-${articleId}.txt"`, "cache-control": "no-store" },
  });
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  if (String(body.op) !== "post") return invalid(["op: post 입니다"]);
  const denied = await authorize(viewer, "channel.record", "channel:post");
  if (denied) return denied;
  const itemId = posInt(body.review_item_id);
  const p = parsePost({ postedUrl: body.posted_url, checklist: body.checklist });
  const errors: string[] = [];
  if (itemId === null) errors.push("review_item_id: 원고 번호(1 이상 정수)입니다");
  if (!p.ok) errors.push(...p.errors);
  const at = typeof body.posted_at === "string" && body.posted_at.trim() !== "" ? new Date(body.posted_at) : new Date();
  if (Number.isNaN(at.getTime())) errors.push("posted_at: 시각 형식이 아닙니다");
  if (errors.length > 0 || !p.ok) return invalid(errors);
  const { data, error } = await serviceDb().rpc("channel_post_record", { p_review_item_id: itemId, p_posted_url: p.value.postedUrl, p_checklist: p.value.checklist, p_posted_at: at.toISOString(), p_actor: actorOf(viewer) });
  if (error) throw dbError(error, "채널 게시 기록");
  const r = data as { ok: boolean; code: string; message: string; id?: number };
  if (!r.ok) return errorJson(409, r.message, { code: r.code });
  return json({ created: { id: r.id } }, 201);
});
