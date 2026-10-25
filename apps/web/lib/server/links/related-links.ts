import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { articleBodyText } from "@/lib/law/article-text";
import { extractArticleCitations, extractCaseNumbers, keepExistingArticles, provisionKey } from "@/lib/law/citations";
import { HttpError } from "../http";
import { transitionReviewItem } from "../review/service";

// 기사 속 조문·사건번호 자동 링크 후보 (ART-12) -> 공통 검수 큐(link_candidates) -> 승인된 것만 확인된 연결 (CASE-03 · LAW-06)
//  · 추출은 패턴만 쓴다(AI 없음). 법령 이름은 DB에서 읽고, DB에 없는 조문·사건번호는 후보로 만들지 않는다.
//  · 후보는 links(status candidate)와 검수 항목 1건(기사·후보 묶음당)이다. 검수 승인 전에는 공개 뷰에 나오지 않는다(확인 전 후보 공개 0).
//  · 같은 기사를 다시 돌려도 후보·검수 항목은 늘지 않는다(link_add_candidate 멱등 + 검수 항목 키가 후보 묶음 기준).
//  · 승인 -> 반영은 별도 단계(publishApprovedCandidates)다: 검수 상태만 승인으로 바꾸고 공개 반영은 이 함수가 승인된 항목을 읽어서 한다 (W10-c 결정 7).

export interface CandidateResult {
  articleId: number;
  skipped: string | null;
  found: number;
  newCandidates: number;
  reviewItemId: number | null;
}

export async function createArticleCandidates(db: SupabaseClient, articleIds: number[], actor: string): Promise<CandidateResult[]> {
  const ids = [...new Set(articleIds)].filter((n) => Number.isInteger(n) && n > 0).slice(0, 500);
  if (ids.length === 0) return [];
  const articles = await db.from("articles").select("id, body, status").in("id", ids);
  if (articles.error) throw new HttpError(500, "기사를 읽지 못했습니다");
  const lawRows = await db.from("laws").select("id, name").eq("watch", true);
  if (lawRows.error) throw new HttpError(500, "법령 목록을 읽지 못했습니다");
  const laws = (lawRows.data ?? []).map((l) => ({ id: Number(l.id), name: String(l.name) }));
  const out: CandidateResult[] = [];

  for (const id of ids) {
    const a = (articles.data ?? []).find((x) => Number(x.id) === id);
    if (!a) {
      out.push({ articleId: id, skipped: "없는 기사", found: 0, newCandidates: 0, reviewItemId: null });
      continue;
    }
    if (a.status !== "published") {
      out.push({ articleId: id, skipped: "발행된 기사만", found: 0, newCandidates: 0, reviewItemId: null });
      continue;
    }
    const text = articleBodyText(a.body);
    const before = await db.from("links").select("id").eq("src_kind", "article").eq("src_id", id);
    const beforeIds = new Set((before.data ?? []).map((r) => Number(r.id)));

    // 조문 - 법령 이름 + 제N조(의M). DB에 있는 조문만
    const found = extractArticleCitations(text, laws);
    const exists = new Set<string>();
    for (const c of new Map(found.map((c) => [provisionKey(c.lawId, c.articleNo, c.branchNo), c])).values()) {
      const r = await db.rpc("law_provision_exists", { p_law_id: c.lawId, p_article_no: c.articleNo, p_branch_no: c.branchNo });
      if (r.data === true) exists.add(provisionKey(c.lawId, c.articleNo, c.branchNo));
    }
    const articleCites = keepExistingArticles(found, exists);

    // 사건번호 - 해석 문서 번호와 같은 것만 (공백 없는 표기가 기준)
    const caseNos = extractCaseNumbers(text);
    const docs = caseNos.length === 0 ? [] : ((await db.from("legal_docs").select("id, doc_no").in("doc_no", [...new Set(caseNos.map((c) => c.normalized))])).data ?? []);

    let total = 0;
    const add = async (dstKind: "law_provision" | "legal_doc", dstId: number, no: number | null, branch: number | null, evidence: string) => {
      const r = await db.rpc("link_add_candidate", {
        p_src_kind: "article", p_src_id: id, p_dst_kind: dstKind, p_dst_id: dstId, p_article_no: no, p_branch_no: branch, p_relation: "cites", p_evidence: evidence, p_actor: actor,
      });
      if (r.error) throw new HttpError(422, `연결 후보를 저장하지 못했습니다: ${r.error.message}`);
      total += 1;
    };
    for (const c of articleCites) await add("law_provision", c.lawId, c.articleNo, c.branchNo, c.text);
    for (const c of caseNos) {
      const d = docs.find((x) => String(x.doc_no).replace(/\s+/g, "") === c.normalized);
      if (d) await add("legal_doc", Number(d.id), null, null, c.text);
    }

    const after = await db.from("links").select("id, status, review_item_id, evidence").eq("src_kind", "article").eq("src_id", id).eq("status", "candidate");
    const open = (after.data ?? []).filter((r) => r.review_item_id === null);
    const newCandidates = open.filter((r) => !beforeIds.has(Number(r.id))).length;
    let reviewItemId: number | null = null;
    if (open.length > 0) {
      const candidateIds = open.map((r) => Number(r.id)).sort((x, y) => x - y);
      const key = `article:${id}:c${candidateIds[candidateIds.length - 1]}`;
      const summary = open.map((r) => String(r.evidence ?? "")).join(" ; ").slice(0, 1500);
      const ins = await db
        .from("review_items")
        .insert({ kind: "link_candidates", source_key: key, title: `기사 ${id} 조문·사건번호 링크 후보 ${open.length}건`, payload: { article_id: id, candidates: open.length, summary }, parts: candidateIds.map(String), created_by: actor })
        .select("id")
        .single();
      if (ins.error && ins.error.code !== "23505") throw new HttpError(500, "검수 항목을 만들지 못했습니다");
      reviewItemId = ins.data ? Number(ins.data.id) : Number(((await db.from("review_items").select("id").eq("kind", "link_candidates").eq("source_key", key).single()).data ?? {}).id);
      await db.from("links").update({ review_item_id: reviewItemId }).in("id", candidateIds).is("review_item_id", null);
    }
    out.push({ articleId: id, skipped: null, found: total, newCandidates, reviewItemId });
  }
  return out;
}

/** 이관 기사 일괄 - 아직 링크 후보를 한 번도 만들지 않은 발행 기사를 번호순으로 limit건 */
export async function pendingArticleIds(db: SupabaseClient, limit: number): Promise<number[]> {
  const n = Math.min(Math.max(Math.trunc(limit) || 1, 1), 200);
  const done = new Set(((await db.from("links").select("src_id").eq("src_kind", "article")).data ?? []).map((r) => Number(r.src_id)));
  const rows = await db.from("articles").select("id").eq("status", "published").order("id").limit(n + done.size);
  return (rows.data ?? []).map((r) => Number(r.id)).filter((id) => !done.has(id)).slice(0, n);
}

export interface PublishResult {
  confirmed: number;
  rejected: number;
}

/** 승인된 링크 후보 검수 항목을 반영 - 승인된 부분(approved_parts, 없으면 전체)은 확인, 나머지 후보는 반려. 끝나면 검수 항목을 처리 완료(published)로 */
export async function publishApprovedCandidates(db: SupabaseClient, reviewItemId: number, actor: string): Promise<PublishResult> {
  const item = await db.from("review_items").select("id, kind, status, parts, approved_parts, decided_by").eq("id", reviewItemId).single();
  if (item.error || !item.data) throw new HttpError(404, "검수 항목을 찾을 수 없습니다");
  if (item.data.kind !== "link_candidates") throw new HttpError(422, "링크 후보 검수 항목이 아닙니다");
  if (item.data.status !== "approved") throw new HttpError(409, "승인된 검수 항목만 반영할 수 있습니다");
  const approved = new Set<string>((item.data.approved_parts as string[] | null) ?? (item.data.parts as string[]));
  const cands = await db.from("links").select("id").eq("review_item_id", reviewItemId).eq("status", "candidate");
  if (cands.error) throw new HttpError(500, "후보를 읽지 못했습니다");
  const now = new Date().toISOString();
  const yes = (cands.data ?? []).map((r) => Number(r.id)).filter((id) => approved.has(String(id)));
  const no = (cands.data ?? []).map((r) => Number(r.id)).filter((id) => !approved.has(String(id)));
  if (yes.length > 0) {
    const r = await db.from("links").update({ status: "confirmed", confirmed_by: String(item.data.decided_by ?? actor), confirmed_at: now }).in("id", yes);
    if (r.error) throw new HttpError(500, "연결을 확인 처리하지 못했습니다");
  }
  if (no.length > 0) {
    const r = await db.from("links").update({ status: "rejected" }).in("id", no);
    if (r.error) throw new HttpError(500, "연결을 반려 처리하지 못했습니다");
  }
  await transitionReviewItem(db, { id: reviewItemId, to: "published", reason: `확인 ${yes.length}건 · 반려 ${no.length}건 반영`, checked: [], parts: null }, actor);
  return { confirmed: yes.length, rejected: no.length };
}

/** 실명·주민등록번호 공개 보류 풀기 - DB 함수가 공통 검수 승인 여부와 본문의 주민등록번호 패턴을 판정한다 */
export async function releaseHold(db: SupabaseClient, holdId: number, note: string, actor: string): Promise<void> {
  const r = await db.rpc("legal_doc_hold_release", { p_hold_id: holdId, p_actor: actor, p_note: note });
  if (r.error) throw new HttpError(r.error.code === "P0002" ? 404 : 422, r.error.message);
}
