import { can } from "@/lib/access";
import {
  DEV_METHOD_OPS,
  FACT_COLUMNS,
  contentWarnings,
  methodWarnings,
  parseCompareDraft,
  parseFactInput,
  parseMethodDraft,
  parseReview,
  sameFactContent,
  sameMethodContent,
  type DevMethodFactRow,
} from "@/lib/admin/dev-method-rules";
import { snapshotHash } from "@/lib/source-review/fetch";
import { readSetting } from "@/lib/server/admin/backoffice";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { COMPARE_COLUMNS, METHOD_COLUMNS, latestOf, loadCompare, loadDevMethodBoard, loadFact, loadFactVersions, loadMethod } from "@/lib/server/dev-methods/board";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";

// 개발방법 비교 관리 (W4 18단계 — PRD-01B PR-09 · PR-10 · PR-11, docs/dev/W4_설계.md 1장 18단계 · 4장 `/api/admin/dev-methods` · 6장 · 7장 4 · 12장 151번~).
// 방법 7행(이름·종류·고정 순서)은 씨앗이고 바꾸지 않는다. 글·숫자 요건은 편집국이 공식 원문을 보고 적고(dev_method.manage — 편집 책임자·관리자),
// 세무 감수위원이 서명한다(review.tax_review — 감수위원만, 관리자도 역할이 없으면 403 + 감사). 그 밖의 역할은 입력을 보기 전에 403 + 거부 감사.
// 칸 이름은 DB 칸 이름과 같고 규칙 위반은 칸마다 "칸: 문장"(422 errors). 점수·순위·추천 칸 이름은 받지 않는다(422 — PR-11). 서비스를 건너뛴 쓰기는 DB 트리거가 막는다.
//  · GET — 7개 방법(고정 순서)·비교 항목 6칸·사실 행(열쇠마다 판)·공개 준비·기능 키
//  · POST op=method { slug, legal_basis_name?, summary, steps, lens? } — 방법 내용 초안. 고치면 서명이 지워진다(재감수 필요). 감사 dev_method.edit
//  · POST op=compare { slug, item, body } — 비교 항목 한 칸(없으면 만들기 201·있으면 고치기 200). 고치면 그 칸 서명 지움. 감사 dev_method.edit
//  · POST op=fact { slug, fact_key, label, value, unit?, law_ref, reference_date, source_url, snapshot_id | snapshot_payload, supersedes_id?, reason? }
//      — 숫자 요건 사실 행 첫 판, 또는 최신 판을 고치는 새 판(사유 필수 — 옛 판 그대로). 최신 판이 아니면 409. 감사 dev_method_fact.edit
//  · POST op=review { target: method·compare·fact, slug, item?, drafted_at?, fact_id? } — 세무 감수 서명. 읽은 초안 그대로일 때만(아니면 409),
//      사실 행은 최신 판·기준일이 있을 때만. 감사 dev_method.review
// 금지 표현(추천·유리 단정 — 2.11)·자리 채움 글('확인 중')은 422, 숫자 요건 표현은 저장 + warnings. 쓰기는 공개 데이터 캐시를 만료한다(기능 키가 켜져 있으면 공개 뷰가 바로 바뀐다).
export const dynamic = "force-dynamic";

type Db = ReturnType<typeof serviceDb>;

/** 금지 표현 사전 — 없으면 null(닫힌 쪽: 저장하지 않는다) */
async function forbiddenPhrases(db: Db): Promise<string[] | null> {
  const row = await readSetting(db, "forbidden_phrases");
  const v = row?.value as { phrases?: unknown } | undefined;
  return v && Array.isArray(v.phrases) ? v.phrases.filter((p): p is string => typeof p === "string" && p.trim() !== "") : null;
}

const invalid = (errors: string[]) => errorJson(422, "입력값을 확인하세요", { errors });
const short = (v: unknown, n = 40) => (typeof v === "string" ? v.slice(0, n) : "invalid");

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  // 편집 책임자·관리자(초안)와 세무 감수위원(서명) 모두 본다 — 둘 다 아니면 403 + 감사
  if (!can(viewer, "dev_method.manage") && !can(viewer, "review.tax_review")) {
    const denied = await authorize(viewer, "dev_method.manage", "dev_methods:list");
    if (denied) return denied;
  }
  return json(await loadDevMethodBoard(serviceDb()));
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  if (!(DEV_METHOD_OPS as readonly string[]).includes(op)) return errorJson(422, `op는 ${DEV_METHOD_OPS.join("·")} 중 하나입니다`, { errors: [`op: ${DEV_METHOD_OPS.join("·")} 중 하나입니다`] });
  const where = op === "compare" ? `${short(body.slug)}:${short(body.item)}` : op === "fact" ? `${short(body.slug)}:${short(body.fact_key)}` : short(body.slug);
  const denied = await authorize(viewer, op === "review" ? "review.tax_review" : "dev_method.manage", `dev_methods:${op}:${where}`);
  if (denied) return denied;

  const db = serviceDb();
  const actor = actorOf(viewer);

  if (op === "method" || op === "compare" || op === "fact") {
    const phrases = await forbiddenPhrases(db);
    if (!phrases) return errorJson(503, "금지 표현 사전(forbidden_phrases)이 없어 저장하지 않습니다");

    if (op === "method") {
      const p = parseMethodDraft(body, phrases);
      if (!p.ok) return invalid(p.errors);
      const { slug, content } = p.value;
      const before = await loadMethod(db, slug);
      if (!before) return errorJson(404, "그런 개발방법이 없습니다");
      const warnings = methodWarnings(content);
      if (before.drafted_at && sameMethodContent(before, content)) return json({ method: before, warnings, unchanged: true });
      const { data, error } = await db
        .from("dev_methods")
        .update({ legal_basis_name: content.legal_basis_name, summary: content.summary, steps: content.steps, lens: content.lens, drafted_by: actor })
        .eq("slug", slug)
        .select(METHOD_COLUMNS)
        .single();
      if (error || !data) throw dbError(error ?? {}, "dev_methods 내용");
      await writeAudit(db, {
        actor,
        action: "dev_method.edit",
        target: targetOf.devMethod(slug),
        before,
        after: data,
        reason: before.reviewed_by ? "개발방법 내용 고침 — 감수 서명 지움(재감수 필요)" : "개발방법 내용 초안 저장",
      });
      return json({ method: data, warnings });
    }

    if (op === "compare") {
      const p = parseCompareDraft(body, phrases);
      if (!p.ok) return invalid(p.errors);
      const { slug, item, body: text } = p.value;
      const method = await loadMethod(db, slug);
      if (!method) return errorJson(404, "그런 개발방법이 없습니다");
      const before = await loadCompare(db, method.id, item);
      const warnings = contentWarnings("body", [text]);
      if (before && before.body === text) return json({ compare: before, warnings, unchanged: true });
      const write = before
        ? db.from("dev_method_compare").update({ body: text, drafted_by: actor }).eq("method_id", method.id).eq("item", item).select(COMPARE_COLUMNS).single()
        : db.from("dev_method_compare").insert({ method_id: method.id, item, body: text, drafted_by: actor }).select(COMPARE_COLUMNS).single();
      const { data, error } = await write;
      if (error || !data) {
        if (error?.code === "23505") return errorJson(409, "다른 사람이 먼저 이 칸을 만들었습니다 — 새로 불러온 뒤 고치세요");
        throw dbError(error ?? {}, "dev_method_compare 쓰기");
      }
      await writeAudit(db, {
        actor,
        action: "dev_method.edit",
        target: targetOf.devMethodCompare(slug, item),
        before,
        after: data,
        reason: before?.reviewed_by ? "개발방법 비교 항목 고침 — 감수 서명 지움(재감수 필요)" : before ? "개발방법 비교 항목 고침" : "개발방법 비교 항목 초안 저장",
      });
      return json({ compare: data, warnings }, before ? 200 : 201);
    }

    // op === "fact"
    const p = parseFactInput(body, phrases);
    if (!p.ok) return invalid(p.errors);
    const v = p.value;
    const method = await loadMethod(db, v.slug);
    if (!method) return errorJson(404, "그런 개발방법이 없습니다");
    const versions = await loadFactVersions(db, method.id, v.fact_key);
    const latest = latestOf(versions);
    if (v.supersedes_id === null && latest) {
      return errorJson(409, `요건 ${v.fact_key}는 이미 있습니다 — 최신 판(${latest.id})을 고치는 새 판(supersedes_id·reason)으로 적으세요 (덮어쓰기 0)`, { latestId: latest.id });
    }
    if (v.supersedes_id !== null && (!latest || latest.id !== v.supersedes_id)) {
      return errorJson(409, latest ? `앞 판(${v.supersedes_id})은 최신 판이 아닙니다(최신 ${latest.id}) — 새로 불러와 최신 판을 고치세요` : "고칠 앞 판이 없습니다 — 첫 판은 supersedes_id 없이 적습니다", { latestId: latest?.id ?? null });
    }
    let snapshotId = v.snapshot_id;
    if (snapshotId !== null) {
      const { data, error } = await db.from("raw_snapshots").select("id").eq("id", snapshotId).limit(1);
      if (error) throw dbError(error, "raw_snapshots 조회");
      if (!data?.length) return invalid(["snapshot_id: 그런 원본 스냅샷이 없습니다 — 번호를 확인하거나 원문 글자를 붙여 넣으세요"]);
    }
    const payloadHash = v.snapshot_payload !== null ? snapshotHash(new TextEncoder().encode(v.snapshot_payload)) : null;
    if (latest && sameFactContent(latest, v)) {
      let sameSnapshot = snapshotId !== null && snapshotId === latest.snapshot_id;
      if (payloadHash !== null) {
        const { data, error } = await db.from("raw_snapshots").select("content_hash").eq("id", latest.snapshot_id).limit(1);
        if (error) throw dbError(error, "raw_snapshots 해시");
        sameSnapshot = (data?.[0] as { content_hash?: string } | undefined)?.content_hash?.toLowerCase() === payloadHash;
      }
      if (sameSnapshot) return json({ fact: latest, unchanged: true });
    }
    let madeSnapshot: number | null = null;
    if (v.snapshot_payload !== null) {
      const { data, error } = await db
        .from("raw_snapshots")
        .insert({ source: "개발방법 근거 원문", url: v.source_url, content_hash: payloadHash, payload: v.snapshot_payload })
        .select("id")
        .single();
      if (error || !data) throw dbError(error ?? {}, "raw_snapshots 추가");
      snapshotId = madeSnapshot = Number((data as { id: number }).id);
    }
    const row = {
      method_id: method.id,
      fact_key: v.fact_key,
      label: v.label,
      value: v.value,
      unit: v.unit,
      law_ref: v.law_ref,
      reference_date: v.reference_date,
      source_url: v.source_url,
      snapshot_id: snapshotId,
      supersedes_id: v.supersedes_id,
      reason: v.reason,
      recorded_by: actor,
      version: latest ? latest.version + 1 : 1,
    };
    const { data, error } = await db.from("dev_method_facts").insert(row).select(FACT_COLUMNS).single();
    if (error || !data) {
      if (madeSnapshot !== null) await db.from("raw_snapshots").delete().eq("id", madeSnapshot);
      // 동시에 들어온 새 판(최신 판이 아님·같은 열쇠 첫 판) = 충돌. 서비스 검사와 같은 문장
      if (error?.code === "23514" || error?.code === "23505") return errorJson(409, error.message);
      throw dbError(error ?? {}, "dev_method_facts 추가");
    }
    const saved = data as DevMethodFactRow;
    await writeAudit(db, {
      actor,
      action: "dev_method_fact.edit",
      target: targetOf.devMethodFact(saved.id),
      before: latest,
      after: data,
      reason: latest ? `숫자 요건 새 판 — ${v.reason}` : "숫자 요건 사실 행 첫 판",
    });
    return json({ fact: data }, 201);
  }

  // op === "review" — 세무 감수 서명
  const r = parseReview(body);
  if (!r.ok) return invalid(r.errors);
  const req = r.value;
  const method = await loadMethod(db, req.slug);
  if (!method) return errorJson(404, "그런 개발방법이 없습니다");

  if (req.target === "method") {
    if (!method.summary || !method.steps || !method.drafted_at) {
      return invalid(["summary: 한 줄 설명과 절차 단계를 저장한 뒤에 서명합니다 — 편집국이 초안을 먼저 저장합니다"]);
    }
    if (method.review_status === "reviewed") return json({ method, unchanged: true });
    const { data, error } = await db
      .from("dev_methods")
      .update({ reviewed_by: actor })
      .eq("slug", req.slug)
      .eq("drafted_at", req.draftedAt)
      .neq("review_status", "reviewed")
      .select(METHOD_COLUMNS);
    if (error) throw dbError(error, "dev_methods 서명");
    const after = (data ?? [])[0];
    if (!after) return errorJson(409, "내용이 그 사이 바뀌었습니다 — 새로 불러와 바뀐 글을 읽은 뒤 서명하세요");
    await writeAudit(db, { actor, action: "dev_method.review", target: targetOf.devMethod(req.slug), before: method, after, reason: "개발방법 내용 세무 감수 서명" });
    return json({ method: after });
  }

  if (req.target === "compare") {
    const before = await loadCompare(db, method.id, req.item);
    if (!before) return invalid([`item: ${req.item} 칸에 저장된 글이 없습니다 — 편집국이 초안을 먼저 저장해야 서명합니다`]);
    if (before.review_status === "reviewed") return json({ compare: before, unchanged: true });
    const { data, error } = await db
      .from("dev_method_compare")
      .update({ reviewed_by: actor })
      .eq("method_id", method.id)
      .eq("item", req.item)
      .eq("drafted_at", req.draftedAt)
      .neq("review_status", "reviewed")
      .select(COMPARE_COLUMNS);
    if (error) throw dbError(error, "dev_method_compare 서명");
    const after = (data ?? [])[0];
    if (!after) return errorJson(409, "글이 그 사이 바뀌었습니다 — 새로 불러와 바뀐 글을 읽은 뒤 서명하세요");
    await writeAudit(db, { actor, action: "dev_method.review", target: targetOf.devMethodCompare(req.slug, req.item), before, after, reason: "개발방법 비교 항목 세무 감수 서명" });
    return json({ compare: after });
  }

  // target === "fact"
  const fact = await loadFact(db, req.factId);
  if (!fact || fact.method_id !== method.id) return errorJson(404, "그런 사실 행이 없습니다");
  if (fact.reviewed_by) return json({ fact, unchanged: true });
  const versions = await loadFactVersions(db, method.id, fact.fact_key);
  const latest = latestOf(versions);
  if (!latest || latest.id !== fact.id) return errorJson(409, `이 판(${fact.id})은 최신 판이 아닙니다 — 최신 판(${latest?.id ?? "-"})에 서명하세요`, { latestId: latest?.id ?? null });
  if (!fact.reference_date) return invalid(["reference_date: 기준일이 없는 판은 서명하지 않습니다 — 기준일을 넣은 새 판을 적으세요 (PR-10)"]);
  const { data, error } = await db.from("dev_method_facts").update({ reviewed_by: actor }).eq("id", fact.id).is("reviewed_by", null).select(FACT_COLUMNS);
  if (error) {
    if (error.code === "23514" || error.code === "42501") return errorJson(409, error.message);
    throw dbError(error, "dev_method_facts 서명");
  }
  const after = (data ?? [])[0];
  if (!after) return errorJson(409, "이 판은 그 사이 서명됐거나 바뀌었습니다 — 새로 불러오세요");
  await writeAudit(db, { actor, action: "dev_method.review", target: targetOf.devMethodFact(fact.id), before: fact, after, reason: "숫자 요건 사실 행 세무 감수 서명" });
  return json({ fact: after });
}, { revalidatesPublic: true });
