import { createHash } from "node:crypto";
import { parseDocLink, parseId, parseLegalDoc } from "@/lib/admin/legal-doc-rules";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";

// 해석 원문·해설 관리 (TX-09 — docs/dev/W3_설계.md 3·4장). 편집 책임자(editor)만. body.op = create | update | link | unlink | mark | unmark | resolve.
// 원문 글자는 편집국이 붙여 넣는다(snapshotPayload → raw_snapshots + 해시). 이 API는 원문·해설을 만들지 않는다.
// 공개 조건(필수 칸·권리 확인·비실명 확인)과 발행 조건(원문 연결·세무 감수)은 DB(legal_doc_public·트리거)가 마지막으로 막는다.
export const dynamic = "force-dynamic";

const COLUMNS = "id, doc_type, issuer, doc_no, decided_on, tax_kinds, provisions, source_url, snapshot_id, rights_status, anonymity_check, content_hash, hash_changed_at";

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "legal_doc.manage", "legal_docs:list");
  if (denied) return denied;
  const db = serviceDb();
  const [d, q] = await Promise.all([
    db.from("legal_docs").select(COLUMNS).order("id", { ascending: false }),
    db.from("legal_doc_review_queue").select("id, legal_doc_id, article_id, content_hash, created_at, resolved_at").is("resolved_at", null).order("id"),
  ]);
  if (d.error) throw dbError(d.error, "legal_docs 목록");
  if (q.error) throw dbError(q.error, "legal_doc_review_queue 목록");
  return json({ legalDocs: d.data ?? [], reviewQueue: q.data ?? [] });
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  const denied = await authorize(viewer, "legal_doc.manage", `legal_docs:${op}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);

  if (op === "create" || op === "update") {
    const p = parseLegalDoc(body);
    if (!p.ok) return errorJson(422, "입력값을 확인하세요", { errors: p.errors });
    const v = p.value;
    let id: number | null = null;
    if (op === "update") {
      const pid = parseId(body, "id");
      if (!pid.ok) return errorJson(422, "입력값을 확인하세요", { errors: pid.errors });
      id = pid.value;
    }
    let snapshotId = v.snapshotId;
    let contentHash: string | null = null;
    if (v.snapshotPayload !== null) {
      contentHash = createHash("sha256").update(v.snapshotPayload).digest("hex");
      const { data, error } = await db
        .from("raw_snapshots")
        .insert({ source: "해석 원문", url: v.sourceUrl ?? "(주소 없음)", content_hash: contentHash, payload: v.snapshotPayload })
        .select("id")
        .single();
      if (error || !data) throw dbError(error ?? {}, "raw_snapshots 추가");
      snapshotId = Number((data as { id: number }).id);
    } else if (snapshotId !== null) {
      const { data, error } = await db.from("raw_snapshots").select("id, content_hash").eq("id", snapshotId).limit(1);
      if (error) throw dbError(error, "raw_snapshots 조회");
      if (!data?.length) return errorJson(422, "그런 원본 스냅샷이 없습니다", { errors: ["snapshotId: 번호를 확인하세요"] });
      contentHash = String((data[0] as { content_hash: string }).content_hash);
    }
    const row: Record<string, unknown> = {
      doc_type: v.docType,
      issuer: v.issuer,
      doc_no: v.docNo,
      decided_on: v.decidedOn,
      tax_kinds: v.taxKinds,
      provisions: v.provisions,
      source_url: v.sourceUrl,
      rights_status: v.rightsStatus,
      anonymity_check: v.anonymityCheck,
    };
    if (snapshotId !== null) {
      row.snapshot_id = snapshotId;
      row.content_hash = contentHash;
    }
    const res = id === null ? await db.from("legal_docs").insert(row).select(COLUMNS).single() : await db.from("legal_docs").update(row).eq("id", id).select(COLUMNS).single();
    if (res.error?.code === "PGRST116") return errorJson(404, "그런 원문이 없습니다");
    if (res.error || !res.data) throw dbError(res.error ?? {}, "legal_docs 저장");
    const saved = res.data as unknown as { id: number };
    await writeAudit(db, { actor, action: "legal_doc.edit", target: `legal_docs:${saved.id}`, before: null, after: res.data, reason: op === "create" ? "원문 입력" : "원문 수정" });
    return json({ legalDoc: res.data }, op === "create" ? 201 : 200);
  }

  if (op === "link" || op === "unlink") {
    const p = parseDocLink(body);
    if (!p.ok) return errorJson(422, "입력값을 확인하세요", { errors: p.errors });
    const { articleId, legalDocId, role } = p.value;
    if (op === "link") {
      const { error } = await db.from("article_legal_docs").insert({ article_id: articleId, legal_doc_id: legalDocId, role });
      if (error?.code === "23505") return errorJson(409, "이미 연결되어 있습니다");
      if (error?.code === "23503") return errorJson(422, "기사 또는 원문 번호를 확인하세요");
      if (error) throw dbError(error, "article_legal_docs 추가");
    } else {
      const { error } = await db.from("article_legal_docs").delete().match({ article_id: articleId, legal_doc_id: legalDocId });
      if (error?.code === "23514") return errorJson(409, error.message);
      if (error) throw dbError(error, "article_legal_docs 삭제");
    }
    await writeAudit(db, { actor, action: "legal_doc.edit", target: `article_legal_docs:${articleId}:${legalDocId}`, before: null, after: { articleId, legalDocId, role }, reason: op === "link" ? "기사-원문 연결" : "기사-원문 연결 해제" });
    return json({ link: { articleId, legalDocId, role }, linked: op === "link" }, op === "link" ? 201 : 200);
  }

  if (op === "mark" || op === "unmark") {
    const p = parseId(body, "articleId");
    if (!p.ok) return errorJson(422, "입력값을 확인하세요", { errors: p.errors });
    const articleId = p.value;
    if (op === "mark") {
      const { error } = await db.from("interpretation_articles").insert({ article_id: articleId });
      if (error?.code === "23505") return errorJson(409, "이미 해석 해설로 지정되어 있습니다");
      if (error?.code === "23503") return errorJson(422, "기사 번호를 확인하세요");
      if (error) throw dbError(error, "interpretation_articles 추가");
    } else {
      const { error } = await db.from("interpretation_articles").delete().eq("article_id", articleId);
      if (error) throw dbError(error, "interpretation_articles 삭제");
    }
    await writeAudit(db, { actor, action: "legal_doc.edit", target: `interpretation_articles:${articleId}`, before: null, after: { articleId }, reason: op === "mark" ? "해석 해설 지정" : "해석 해설 지정 해제" });
    return json({ articleId, marked: op === "mark" }, op === "mark" ? 201 : 200);
  }

  if (op === "resolve") {
    const p = parseId(body, "queueId");
    if (!p.ok) return errorJson(422, "입력값을 확인하세요", { errors: p.errors });
    const { data, error } = await db.from("legal_doc_review_queue").update({ resolved_at: nowIso(), resolved_by: actor }).eq("id", p.value).is("resolved_at", null).select("id, article_id").limit(1);
    if (error) throw dbError(error, "legal_doc_review_queue 갱신");
    if (!data?.length) return errorJson(404, "열린 검수 항목이 없습니다");
    await writeAudit(db, { actor, action: "legal_doc.edit", target: `legal_doc_review_queue:${p.value}`, before: null, after: data[0], reason: "원문 변경 검수 완료" });
    return json({ resolved: p.value });
  }

  return errorJson(422, "op는 create·update·link·unlink·mark·unmark·resolve 중 하나입니다");
}, { revalidatesPublic: true });
