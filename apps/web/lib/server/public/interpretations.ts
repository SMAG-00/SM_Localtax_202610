import "server-only";
import { LEGAL_DOC_TYPES, type LegalDocType } from "@/lib/admin/legal-doc-rules";
import type { ArticleListItem } from "./cards";
import { publicDb, rowsOf } from "./db";
import { readArticleList, readPublicSettings } from "./reads";
import { num } from "./rows";

// 해석 해설 공개 화면 데이터 (TX-09 — docs/dev/W3_설계.md 1장 5단계). 공개 읽기는 RLS(legal_doc_public: 필수 칸·권리 확인·비실명 확인)만 거친 행.
// 기능 키 interpretations가 꺼져 있으면 null → 화면은 지금까지처럼 분야 목록으로 보인다.

export interface LegalDocRow {
  id: number;
  doc_type: LegalDocType;
  issuer: string;
  doc_no: string;
  decided_on: string;
  tax_kinds: string[];
  provisions: string[];
  source_url: string;
}
const DOC_COLUMNS = "id, doc_type, issuer, doc_no, decided_on, tax_kinds, provisions, source_url";

export interface InterpretationFilter {
  type: LegalDocType | null;
  taxKind: string | null;
  provision: string | null;
}
export interface InterpretationCard {
  article: ArticleListItem;
  docs: LegalDocRow[];
}
export interface InterpretationListView {
  filter: InterpretationFilter;
  items: InterpretationCard[];
}

/** URL 쿼리 → 필터 (모르는 값은 무시) */
export function parseInterpretationFilter(q: Record<string, string | string[] | undefined>): InterpretationFilter {
  const one = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, 60) : null);
  const type = one(q.type);
  return { type: type !== null && (LEGAL_DOC_TYPES as readonly string[]).includes(type) ? (type as LegalDocType) : null, taxKind: one(q.tax), provision: one(q.provision) };
}

export async function getInterpretationList(filter: InterpretationFilter): Promise<InterpretationListView | null> {
  const settings = await readPublicSettings();
  if (!settings.features.interpretations) return null;
  const db = publicDb();
  let q = db.from("legal_docs").select(DOC_COLUMNS);
  if (filter.type) q = q.eq("doc_type", filter.type);
  if (filter.taxKind) q = q.contains("tax_kinds", [filter.taxKind]);
  if (filter.provision) q = q.contains("provisions", [filter.provision]);
  const docs = await rowsOf<LegalDocRow>(q.order("decided_on", { ascending: false }).limit(500), "해석 원문");
  if (docs.length === 0) return { filter, items: [] };
  const links = await rowsOf<{ article_id: number; legal_doc_id: number }>(
    db.from("article_legal_docs").select("article_id, legal_doc_id").eq("role", "subject").in("legal_doc_id", docs.map((d) => num(d.id))),
    "원문 연결",
  );
  const articleIds = [...new Set(links.map((l) => num(l.article_id)))];
  if (articleIds.length === 0) return { filter, items: [] };
  const marked = await rowsOf<{ article_id: number }>(db.from("interpretation_articles").select("article_id").in("article_id", articleIds), "해석 해설 지정");
  const markedIds = marked.map((m) => num(m.article_id));
  const { items } = await readArticleList(db, { ids: markedIds, limit: 50 });
  const byDoc = new Map(docs.map((d) => [num(d.id), d]));
  return {
    filter,
    items: items.map((article) => ({
      article,
      docs: links.filter((l) => num(l.article_id) === article.id).flatMap((l) => byDoc.get(num(l.legal_doc_id)) ?? []),
    })),
  };
}

/** 기사 상세의 원문 블록 — 해석 해설로 지정된 공개 기사의 공개 가능한 원문(subject·related). 기능 키가 꺼져 있거나 해당 없으면 빈 목록 */
export async function getArticleLegalDocs(articleId: number): Promise<{ subject: LegalDocRow[]; related: LegalDocRow[] }> {
  const empty = { subject: [], related: [] };
  const settings = await readPublicSettings();
  if (!settings.features.interpretations) return empty;
  const db = publicDb();
  const marked = await rowsOf<{ article_id: number }>(db.from("interpretation_articles").select("article_id").eq("article_id", articleId), "해석 해설 지정");
  if (marked.length === 0) return empty;
  const links = await rowsOf<{ legal_doc_id: number; role: string }>(db.from("article_legal_docs").select("legal_doc_id, role").eq("article_id", articleId), "원문 연결");
  if (links.length === 0) return empty;
  const docs = await rowsOf<LegalDocRow>(db.from("legal_docs").select(DOC_COLUMNS).in("id", links.map((l) => num(l.legal_doc_id))), "해석 원문");
  const pick = (role: string) => links.filter((l) => l.role === role).flatMap((l) => docs.filter((d) => num(d.id) === num(l.legal_doc_id)));
  return { subject: pick("subject"), related: pick("related") };
}
