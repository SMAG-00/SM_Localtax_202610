import { createHash } from "node:crypto";
import { parseCorrect, parseCreate, parseEvent, parseLink, type AmendmentEventInput } from "@/lib/admin/amendment-rules";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import type { SupabaseClient } from "@supabase/supabase-js";

// 개정 트래커 관리 (TX-07·08 — docs/dev/W3_설계.md 4·6장). 편집 책임자(editor)만. body.op = create | event | correct | link | unlink.
// 단계 기록은 날짜·원문 URL·원본 스냅샷이 모두 있어야 한다(DB 제약이 마지막으로 막는다). 앞 순서·같은 단계 재기록은 DB 트리거가 409로 막고,
// 정정은 사유 필수 + 한 기록당 1회. 이 API는 개정안 문구·세율을 만들지 않는다 — 입력된 값만 저장한다.
export const dynamic = "force-dynamic";

const EVENT_COLUMNS = "id, amendment_id, stage, occurred_on, source_url, snapshot_id, skipped, skip_reason, correction_of, reason, recorded_by, recorded_at";

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "amendment.record_event", "amendments:list");
  if (denied) return denied;
  const db = serviceDb();
  const [a, e] = await Promise.all([
    db.from("amendments").select("id, slug, title, law_names, summary, status").order("id", { ascending: false }),
    db.from("amendment_events").select(EVENT_COLUMNS).order("id"),
  ]);
  if (a.error) throw dbError(a.error, "amendments 목록");
  if (e.error) throw dbError(e.error, "amendment_events 목록");
  return json({ amendments: a.data ?? [], events: e.data ?? [] });
});

async function snapshotFor(db: SupabaseClient, input: AmendmentEventInput): Promise<number | Response> {
  const ev = input.evidence!;
  if (ev.snapshotId !== null) {
    const { data, error } = await db.from("raw_snapshots").select("id").eq("id", ev.snapshotId).limit(1);
    if (error) throw dbError(error, "raw_snapshots 조회");
    return data?.length ? ev.snapshotId : errorJson(422, "그런 원본 스냅샷이 없습니다", { errors: ["snapshotId: 번호를 확인하세요"] });
  }
  const payload = ev.snapshotPayload!;
  const { data, error } = await db
    .from("raw_snapshots")
    .insert({ source: "개정 단계 원문", url: ev.sourceUrl, content_hash: createHash("sha256").update(payload).digest("hex"), payload })
    .select("id")
    .single();
  if (error || !data) throw dbError(error ?? {}, "raw_snapshots 추가");
  return Number((data as { id: number }).id);
}

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = body.op;
  const action = op === "correct" ? "amendment.correct_event" : "amendment.record_event";
  const denied = await authorize(viewer, action, `amendments:${String(op)}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);

  if (op === "create") {
    const p = parseCreate(body);
    if (!p.ok) return errorJson(422, "입력값을 확인하세요", { errors: p.errors });
    const { data, error } = await db
      .from("amendments")
      .insert({ slug: p.value.slug, title: p.value.title, law_names: p.value.lawNames, summary: p.value.summary, status: "draft" })
      .select("id, slug, title, status")
      .single();
    if (error?.code === "23505") return errorJson(409, "이미 있는 주소(slug)입니다");
    if (error || !data) throw dbError(error ?? {}, "amendments 추가");
    await writeAudit(db, { actor, action: "amendment.create", target: targetOf.amendment((data as { id: number }).id), before: null, after: data, reason: "개정안 만들기(공개 전 초안 — 공개 전환은 PO)" });
    return json({ amendment: data }, 201);
  }

  if (op === "event" || op === "correct") {
    const p = op === "event" ? parseEvent(body) : parseCorrect(body);
    if (!p.ok) return errorJson(422, "입력값을 확인하세요", { errors: p.errors });
    const v = p.value;
    const found = await db.from("amendments").select("id").eq("id", v.amendmentId).limit(1);
    if (found.error) throw dbError(found.error, "amendments 조회");
    if (!found.data?.length) return errorJson(404, "그런 개정안이 없습니다");
    let snapshotId: number | null = null;
    if (!v.skipped) {
      const s = await snapshotFor(db, v);
      if (s instanceof Response) return s;
      snapshotId = s;
    }
    const correctionOf = "correctionOf" in v ? v.correctionOf : null;
    const { data, error } = await db
      .from("amendment_events")
      .insert({
        amendment_id: v.amendmentId,
        stage: v.stage,
        occurred_on: v.evidence?.occurredOn ?? null,
        source_url: v.evidence?.sourceUrl ?? null,
        snapshot_id: snapshotId,
        skipped: v.skipped,
        skip_reason: v.skipReason,
        correction_of: correctionOf,
        reason: "reason" in v ? v.reason : null,
        recorded_by: actor,
        recorded_at: nowIso(),
      })
      .select(EVENT_COLUMNS)
      .single();
    // DB 규칙 위반(앞 순서·같은 단계 재기록·이미 정정된 기록·다른 개정안의 기록) = 충돌
    if (error?.code === "23514" || error?.code === "23505") return errorJson(409, error.message);
    if (error || !data) throw dbError(error ?? {}, "amendment_events 추가");
    await writeAudit(db, {
      actor,
      action,
      target: targetOf.amendmentEvent((data as { id: number }).id),
      before: null,
      after: data,
      reason: correctionOf === null ? "개정 단계 기록" : `개정 단계 정정 — ${"reason" in v ? v.reason : ""}`,
    });
    return json({ event: data }, 201);
  }

  if (op === "link" || op === "unlink") {
    const p = parseLink(body);
    if (!p.ok) return errorJson(422, "입력값을 확인하세요", { errors: p.errors });
    const { articleId, amendmentId } = p.value;
    const row = { article_id: articleId, amendment_id: amendmentId };
    if (op === "link") {
      const { error } = await db.from("article_amendments").insert(row);
      if (error?.code === "23505") return errorJson(409, "이미 연결되어 있습니다");
      if (error?.code === "23503") return errorJson(422, "기사 또는 개정안 번호를 확인하세요");
      if (error) throw dbError(error, "article_amendments 추가");
    } else {
      const { error } = await db.from("article_amendments").delete().match(row);
      if (error) throw dbError(error, "article_amendments 삭제");
    }
    await writeAudit(db, { actor, action: "amendment.record_event", target: targetOf.articleAmendment(articleId, amendmentId), before: null, after: row, reason: op === "link" ? "기사-개정안 연결" : "기사-개정안 연결 해제" });
    return json({ link: row, linked: op === "link" }, op === "link" ? 201 : 200);
  }

  return errorJson(422, "op는 create·event·correct·link·unlink 중 하나입니다");
}, { revalidatesPublic: true });
