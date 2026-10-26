import "server-only";
import { articleLabel, lawHref, parseArticleSegment } from "@/lib/law/article-ref";
import { extractArticleCitations, keepExistingArticles, provisionKey, segmentText } from "@/lib/law/citations";
import { DOC_TYPE_NOUN, reasonForArticleOfDoc, type DocType, type LinkRelation } from "@/lib/law/related";
import { isRealIsoDate } from "@/lib/law/as-of";
import { newsHref } from "./constants";
import { findLaw } from "./law";
import { publicDb, publicSearchDb, rowsOf } from "./db";
import { readPublicSettings } from "./reads";

// 해석 DB 공개 데이터 (CASE-01 · CASE-02 · TX-10 - docs/dev/W10-d_설계.md). 공개 뷰와 검색 함수 2개만 읽는다 - 스냅샷 없는 문서·이용 조건 미확인 원천·
// 공개 보류(실명·주민등록번호)·기능 키(case_db)는 뷰 안에서 이미 걸러져 있다. 기능 키가 꺼져 있으면 null -> 화면 404. 이 모듈은 AI를 쓰지 않는다.

export const DOC_TYPES: readonly DocType[] = ["ruling", "circular", "interpretation", "tribunal", "case"];
export const isDocType = (v: unknown): v is DocType => typeof v === "string" && (DOC_TYPES as readonly string[]).includes(v);
export const DECISION_KINDS = ["accepted", "rejected", "dismissed", "remanded", "other"] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];
/** 결정 유형 칩 글자 - 'remanded'의 표시 이름은 [확인 필요: 편집 용어] */
export const DECISION_LABELS: Readonly<Record<DecisionKind, string>> = { accepted: "인용", rejected: "기각", dismissed: "각하", remanded: "재조사·경정", other: "그 밖" };
export const PAGE_SIZE = 20;

export interface CaseFilter {
  q: string;
  type: DocType | null;
  tax: string | null;
  decision: DecisionKind | null;
  from: string | null;
  to: string | null;
  law: string | null;
  article: string | null;
  page: number;
}

const one = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** URL 쿼리 -> 필터 (모르는 값은 무시, 길이는 자른다) */
export function parseCaseFilter(sp: Record<string, string | string[] | undefined>): CaseFilter {
  const type = one(sp.type);
  const decision = one(sp.decision);
  const from = one(sp.from);
  const to = one(sp.to);
  const page = Number(one(sp.page) ?? 1);
  return {
    q: (one(sp.q) ?? "").slice(0, 100),
    type: isDocType(type) ? type : null,
    tax: one(sp.tax)?.slice(0, 40) ?? null,
    decision: (DECISION_KINDS as readonly string[]).includes(decision ?? "") ? (decision as DecisionKind) : null,
    from: isRealIsoDate(from) ? from : null,
    to: isRealIsoDate(to) ? to : null,
    law: one(sp.law)?.slice(0, 100) ?? null,
    article: one(sp.article)?.slice(0, 10) ?? null,
    page: Number.isInteger(page) && page >= 1 && page <= 500 ? page : 1,
  };
}

export interface CaseListItem {
  id: number;
  doc_type: DocType;
  issuer: string;
  doc_no: string;
  decided_on: string;
  tax_kinds: string[];
  decision_kind: DecisionKind | null;
}
export interface CaseSearchView {
  filter: CaseFilter;
  items: CaseListItem[];
  total: number;
  typeCounts: Array<{ type: DocType; n: number }>;
  /** 조문 필터가 가리키는 조문 이름(법령 + 조) - 찾지 못하면 null */
  provisionLabel: string | null;
  provisionMissing: boolean;
}

export async function searchCases(filter: CaseFilter): Promise<CaseSearchView | null> {
  if (!(await readPublicSettings()).features.case_db) return null;
  let lawId: number | null = null;
  let provisionLabel: string | null = null;
  let articleNo: number | null = null;
  let branchNo = 0;
  let provisionMissing = false;
  if (filter.law && filter.article) {
    const law = await findLaw(filter.law);
    const ref = parseArticleSegment(filter.article);
    if (law && ref) {
      lawId = law.id;
      articleNo = ref.no;
      branchNo = ref.branch;
      provisionLabel = `${law.name} ${articleLabel(ref.no, ref.branch)}`;
    } else provisionMissing = true;
  }
  const db = publicSearchDb();
  const common = { p_q: filter.q || null, p_tax: filter.tax, p_law_id: lawId, p_article_no: articleNo, p_branch_no: branchNo, p_decision: filter.decision, p_from: filter.from, p_to: filter.to };
  if (provisionMissing) return { filter, items: [], total: 0, typeCounts: DOC_TYPES.map((type) => ({ type, n: 0 })), provisionLabel, provisionMissing };
  const [rows, counts] = await Promise.all([
    rowsOf<CaseListItem & { total: number }>(db.rpc("search_legal_docs", { ...common, p_type: filter.type, p_limit: PAGE_SIZE, p_offset: (filter.page - 1) * PAGE_SIZE }), "해석 검색"),
    rowsOf<{ doc_type: DocType; n: number }>(db.rpc("legal_doc_type_counts", common), "해석 유형 개수"),
  ]);
  return {
    filter,
    items: rows.map((r) => ({ id: Number(r.id), doc_type: r.doc_type, issuer: r.issuer, doc_no: r.doc_no, decided_on: r.decided_on, tax_kinds: r.tax_kinds, decision_kind: r.decision_kind })),
    total: rows[0] ? Number(rows[0].total) : 0,
    typeCounts: counts.map((c) => ({ type: c.doc_type, n: Number(c.n) })),
    provisionLabel,
    provisionMissing,
  };
}

// ── 상세 ────────────────────────────────────────────────────────

export interface BodySegment {
  text: string;
  /** 조문 인용 링크 - 결정일을 기준일로 연다. 관문(case_citation) 통과 전·DB에 없는 조문은 null */
  href: string | null;
}
export interface CaseDetailView {
  doc: CaseListItem & { source_url: string; collected_on: string; checked_on: string; provisions: string[] };
  paragraphs: BodySegment[][];
  citationLinksActive: boolean;
  /** 이 문서가 확인된 연결로 가리키는 조문 */
  provisions: Array<{ linkId: number; label: string; href: string; origin: "auto" | "editor" }>;
  /** 이 문서를 해설·인용한 기사 (확인된 연결, 공개 기사만) */
  articles: Array<{ linkId: number; title: string; href: string; reason: string }>;
  /** 검수를 마친 요지 3줄 (CASE-05) - 승인 전·원문이 바뀐 뒤·기능 키 꺼짐이면 null. 사건번호·일자는 doc 값 */
  summary: { lines: string[]; resultType: string; approvedOn: string } | null;
}

/** 승인된 결정례 요지 - 공개 뷰가 승인 ∧ 원문 해시 일치 ∧ 기능 키를 판정한다. 읽지 못하면 요지 없이 문서만 보인다 */
async function readSummary(db: ReturnType<typeof publicDb>, id: number): Promise<CaseDetailView["summary"]> {
  try {
    const rows = await rowsOf<{ summary_lines: string[]; result_type: string; approved_on: string }>(db.from("public_case_summaries").select("summary_lines, result_type, approved_on").eq("case_id", id), "결정례 요지");
    const r = rows[0];
    return r ? { lines: r.summary_lines, resultType: r.result_type, approvedOn: r.approved_on } : null;
  } catch {
    return null;
  }
}

interface PublicLink {
  id: number;
  src_kind: string;
  src_id: number;
  dst_kind: string;
  dst_id: number;
  dst_article_no: number | null;
  dst_branch_no: number | null;
  relation: LinkRelation;
  origin: "auto" | "editor";
}

export async function getCaseDetail(kind: string, idParam: string): Promise<CaseDetailView | null> {
  if (!(await readPublicSettings()).features.case_db) return null;
  if (!isDocType(kind) || !/^[1-9]\d{0,15}$/.test(idParam)) return null;
  const id = Number(idParam);
  const db = publicDb();
  const docs = await rowsOf<CaseDetailView["doc"]>(
    db.from("public_legal_docs").select("id, doc_type, issuer, doc_no, decided_on, tax_kinds, provisions, source_url, decision_kind, collected_on, checked_on").eq("id", id).eq("doc_type", kind),
    "해석 문서",
  );
  const doc = docs[0];
  if (!doc) return null;
  const bodies = await rowsOf<{ body: string }>(db.from("public_legal_doc_bodies").select("body").eq("id", id), "해석 원문");
  const body = bodies[0]?.body;
  if (body === undefined) return null;

  // 본문 속 조문 인용 자동 링크 - 표본 검사 관문(조문 인용 100건 중 95)을 통과한 뒤에만, DB에 있는 조문만
  const gate = await rowsOf<{ passed: boolean }>(db.from("public_quality_gates").select("passed").eq("kind", "case_citation"), "표본 검사 관문");
  const active = gate[0]?.passed === true;
  const lines = body.split(/\r?\n/).filter((l) => l.trim() !== "");
  let paragraphs: BodySegment[][] = lines.map((l) => [{ text: l, href: null }]);
  if (active) {
    const laws = (await rowsOf<{ id: number; name: string }>(db.from("public_laws").select("id, name"), "법령 이름")).map((l) => ({ id: Number(l.id), name: l.name }));
    const found = lines.map((l) => extractArticleCitations(l, laws));
    const flat = found.flat();
    const exists = new Set<string>();
    if (flat.length > 0) {
      const rows = await rowsOf<{ law_id: number; article_no: number; branch_no: number }>(
        db.from("public_law_articles").select("law_id, article_no, branch_no").in("law_id", [...new Set(flat.map((c) => c.lawId))]).in("article_no", [...new Set(flat.map((c) => c.articleNo))]),
        "인용 조문 확인",
      );
      for (const r of rows) exists.add(provisionKey(Number(r.law_id), Number(r.article_no), Number(r.branch_no)));
    }
    paragraphs = lines.map((l, i) => {
      const kept = keepExistingArticles(found[i]!, exists);
      return segmentText(l, kept).map((s) => ({
        text: s.text,
        href: s.match ? lawHref(s.match.lawName, { article: { no: s.match.articleNo, branch: s.match.branchNo }, date: doc.decided_on, anchor: s.match.paragraph ? `p${s.match.paragraph}` : null }) : null,
      }));
    });
  }

  // 확인된 연결 - 조문(이 문서 -> 조문)과 기사(기사 -> 이 문서)
  const out = await rowsOf<PublicLink>(db.from("public_links").select("id, src_kind, src_id, dst_kind, dst_id, dst_article_no, dst_branch_no, relation, origin").eq("src_kind", "legal_doc").eq("src_id", id).eq("dst_kind", "law_provision").order("id"), "연결 조문");
  const inc = await rowsOf<PublicLink>(db.from("public_links").select("id, src_kind, src_id, dst_kind, dst_id, dst_article_no, dst_branch_no, relation, origin").eq("src_kind", "article").eq("dst_kind", "legal_doc").eq("dst_id", id).order("id"), "연결 기사");
  const lawIds = [...new Set(out.map((l) => Number(l.dst_id)))];
  const lawRows = lawIds.length === 0 ? [] : await rowsOf<{ id: number; name: string }>(db.from("public_laws").select("id, name").in("id", lawIds), "연결 법령");
  const artIds = inc.map((l) => Number(l.src_id));
  const artRows = artIds.length === 0 ? [] : await rowsOf<{ id: number; slug: string; title: string }>(db.from("public_articles").select("id, slug, title").in("id", artIds), "연결 기사 제목");
  const summary = await readSummary(db, id);
  return {
    summary,
    doc: { ...doc, id: Number(doc.id) },
    paragraphs,
    citationLinksActive: active,
    provisions: out.flatMap((l) => {
      const law = lawRows.find((r) => Number(r.id) === Number(l.dst_id));
      if (!law || l.dst_article_no === null || l.dst_branch_no === null) return [];
      const ref = { no: Number(l.dst_article_no), branch: Number(l.dst_branch_no) };
      return [{ linkId: Number(l.id), label: `${law.name} ${articleLabel(ref.no, ref.branch)}`, href: lawHref(law.name, { article: ref, date: doc.decided_on }), origin: l.origin }];
    }),
    articles: inc.flatMap((l) => {
      const a = artRows.find((r) => Number(r.id) === Number(l.src_id));
      return a ? [{ linkId: Number(l.id), title: a.title, href: newsHref(a.slug), reason: reasonForArticleOfDoc(l.relation) }] : [];
    }),
  };
}

export const docTypeLabel = (t: DocType) => DOC_TYPE_NOUN[t];
