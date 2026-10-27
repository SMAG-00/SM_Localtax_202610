import "server-only";
import { articleLabel, lawHref, parseArticleSegment, articleSegment, type ArticleRef } from "@/lib/law/article-ref";
import { kstToday } from "@/lib/law/as-of";
import { isLocked, reasonFor, type OriginV2, type PanelItemV2, type PanelKindV2 } from "@/lib/law/panel-v2";
import type { DocType, LinkRelation } from "@/lib/law/related";
import { buildTimeline, timelineKindOfDoc, type TimelineItem } from "@/lib/law/timeline";
import type { AccountMappingRow } from "@/lib/law/accounts";
import type { PanelSpec } from "@/lib/law/split";
import { newsHref } from "./constants";
import { publicDb, rowsOf } from "./db";
import { readPublicSettings } from "./reads";

// 관련 자료 패널 v2 · 쟁점 타임라인 · 분할 화면 패널 · 계정과목 연결 읽기 (W13-c). 공개 뷰만 읽는다 - 본문 칸은 패널·타임라인 어디에도 없다.
// 지식창고 본문은 이 모듈이 읽지 않는다(분할 화면은 library_read 한 곳으로 받는다 - lib/server/library/read.ts).
const n = (v: unknown): number => Number(v);

interface LinkV2Row {
  id: number;
  src_kind: "legal_doc" | "article" | "pub_node" | "issue_article";
  src_id: number;
  relation: LinkRelation;
  origin: OriginV2;
  reason: string | null;
  similarity: number | null;
  src_tier: "public" | "premium" | null;
}

/** 그 조문을 가리키는 확인된 연결 -> 패널 v2 항목. 권한(library)이 없으면 프리미엄 카드는 잠금 표시(제목·이유만) */
export async function getRelatedV2(lawId: number, ref: ArticleRef, libraryEntitled: boolean): Promise<PanelItemV2[]> {
  const db = publicDb();
  const links = await rowsOf<LinkV2Row>(
    db.from("public_links_v2").select("id, src_kind, src_id, relation, origin, reason, similarity, src_tier").eq("dst_kind", "law_provision").eq("dst_id", lawId).eq("dst_article_no", ref.no).eq("dst_branch_no", ref.branch).order("id"),
    "관련 자료 연결 v2",
  );
  if (links.length === 0) return [];
  const ids = (k: LinkV2Row["src_kind"]) => links.filter((l) => l.src_kind === k).map((l) => n(l.src_id));
  const [docs, articles, nodes, issueArticles] = await Promise.all([
    ids("legal_doc").length === 0 ? [] : rowsOf<{ id: number; doc_type: DocType; issuer: string; doc_no: string; decided_on: string }>(db.from("public_legal_docs").select("id, doc_type, issuer, doc_no, decided_on").in("id", ids("legal_doc")), "관련 해석"),
    ids("article").length === 0 ? [] : rowsOf<{ id: number; slug: string; title: string }>(db.from("public_articles").select("id, slug, title").in("id", ids("article")), "관련 기사"),
    ids("pub_node").length === 0 ? [] : rowsOf<{ id: number; title: string }>(db.from("public_library_nodes").select("id, title").in("id", ids("pub_node")), "관련 지식창고"),
    ids("issue_article").length === 0 ? [] : rowsOf<{ id: number; issue_id: number; title: string }>(db.from("public_library_issue_articles").select("id, issue_id, title").in("id", ids("issue_article")), "관련 월간지"),
  ]);
  const items: PanelItemV2[] = [];
  for (const l of links) {
    const base = { linkId: n(l.id), origin: l.origin, relation: l.relation, similarity: l.similarity === null ? null : Number(l.similarity), locked: isLocked(l.src_tier, libraryEntitled) };
    if (l.src_kind === "legal_doc") {
      const d = docs.find((x) => n(x.id) === n(l.src_id));
      if (!d) continue;
      const kind: PanelKindV2 = d.doc_type === "case" ? "case" : d.doc_type === "tribunal" ? "tribunal" : "interpretation";
      items.push({ ...base, kind, title: `${d.issuer} ${d.doc_no}`, reason: reasonFor(l.reason, { kind, relation: l.relation, docType: d.doc_type }), href: `/cases/${d.doc_type}/${n(d.id)}`, decidedOn: d.decided_on, splitSpec: `case:${n(d.id)}` });
    } else if (l.src_kind === "article") {
      const a = articles.find((x) => n(x.id) === n(l.src_id));
      if (a) items.push({ ...base, kind: "article", title: a.title, reason: reasonFor(l.reason, { kind: "article", relation: l.relation }), href: newsHref(a.slug), decidedOn: null, splitSpec: null });
    } else if (l.src_kind === "pub_node") {
      const x = nodes.find((v) => n(v.id) === n(l.src_id));
      if (x) items.push({ ...base, kind: "node", title: x.title, reason: reasonFor(l.reason, { kind: "node", relation: l.relation }), href: `/library/wiki/${n(x.id)}`, decidedOn: null, splitSpec: `node:${n(x.id)}` });
    } else {
      const x = issueArticles.find((v) => n(v.id) === n(l.src_id));
      if (x) items.push({ ...base, kind: "issue_article", title: x.title, reason: reasonFor(l.reason, { kind: "issue_article", relation: l.relation }), href: `/library/magazine/${n(x.issue_id)}`, decidedOn: null, splitSpec: null });
    }
  }
  // 기준 점수 이상만 보이게 하는 것은 뷰(public_links_v2)의 일이다. 점수가 없는 유사도 카드는 화면에도 올리지 않는다
  return items.filter((i) => i.origin !== "similarity" || i.similarity !== null);
}

// ── 쟁점 타임라인 ────────────────────────────────────────────
export interface TimelineView {
  tagKey: string;
  label: string;
  items: TimelineItem[];
}

const CONCLUSION: Readonly<Record<string, string>> = { granted: "인용", dismissed: "기각", rejected: "각하", partial: "일부 인용" };

export async function getTimeline(tagKey: string): Promise<TimelineView | null> {
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(tagKey)) return null;
  if (!(await readPublicSettings()).features.law_timeline) return null;
  const db = publicDb();
  const tags = await rowsOf<{ tag_key: string; label: string }>(db.from("public_issue_tags").select("tag_key, label").eq("tag_key", tagKey), "쟁점 태그");
  if (tags.length === 0) return null;
  const tagged = await rowsOf<{ case_id: number }>(db.from("public_case_issue_tags").select("case_id").eq("tag_key", tagKey), "태그된 결정례");
  const caseIds = tagged.map((t) => n(t.case_id));
  const raw: TimelineItem[] = [];
  if (caseIds.length > 0) {
    const [docs, links] = await Promise.all([
      rowsOf<{ id: number; doc_type: string; issuer: string; doc_no: string; decided_on: string; decision_kind: string | null }>(db.from("public_legal_docs").select("id, doc_type, issuer, doc_no, decided_on, decision_kind").in("id", caseIds), "타임라인 결정례"),
      rowsOf<{ src_id: number; dst_id: number; dst_article_no: number; dst_branch_no: number; origin: string }>(db.from("public_links").select("src_id, dst_id, dst_article_no, dst_branch_no, origin").eq("src_kind", "legal_doc").eq("dst_kind", "law_provision").in("src_id", caseIds), "타임라인 연결"),
    ]);
    for (const d of docs) {
      const kind = timelineKindOfDoc(d.doc_type);
      if (!kind) continue;
      raw.push({ key: `doc:${n(d.id)}`, kind, date: d.decided_on, title: `${d.issuer} ${d.doc_no}`, origin: "tag", conclusion: d.decision_kind ? (CONCLUSION[d.decision_kind] ?? null) : null, href: `/cases/${d.doc_type}/${n(d.id)}`, splitSpec: `case:${n(d.id)}`, numericId: n(d.id) });
    }
    const provisions = new Map<string, { law: number; no: number; branch: number; origin: "editor" | "auto" }>();
    for (const l of links) {
      const k = `${n(l.dst_id)}:${n(l.dst_article_no)}:${n(l.dst_branch_no)}`;
      const prev = provisions.get(k);
      const origin = l.origin === "editor" || prev?.origin === "editor" ? "editor" : "auto";
      provisions.set(k, { law: n(l.dst_id), no: n(l.dst_article_no), branch: n(l.dst_branch_no), origin });
    }
    if (provisions.size > 0) {
      const lawIds = [...new Set([...provisions.values()].map((p) => p.law))];
      const [laws, arts] = await Promise.all([
        rowsOf<{ id: number; name: string }>(db.from("public_laws").select("id, name").in("id", lawIds), "타임라인 법령"),
        rowsOf<{ id: number; version_id: number; law_id: number; article_no: number; branch_no: number }>(db.from("public_law_articles").select("id, version_id, law_id, article_no, branch_no").in("law_id", lawIds), "타임라인 조문"),
      ]);
      const versionIds = [...new Set(arts.map((a) => n(a.version_id)))];
      const versions = versionIds.length === 0 ? [] : await rowsOf<{ id: number; effective_on: string | null }>(db.from("public_law_versions").select("id, effective_on").in("id", versionIds), "타임라인 개정판");
      for (const a of arts) {
        const p = provisions.get(`${n(a.law_id)}:${n(a.article_no)}:${n(a.branch_no)}`);
        const v = versions.find((x) => n(x.id) === n(a.version_id));
        const law = laws.find((x) => n(x.id) === n(a.law_id));
        if (!p || !v || !v.effective_on || !law) continue;
        const ref = { no: n(a.article_no), branch: n(a.branch_no) };
        raw.push({ key: `law:${n(a.id)}`, kind: "law", date: v.effective_on, title: `${law.name} ${articleLabel(ref.no, ref.branch)} 시행`, origin: p.origin, conclusion: null, href: lawHref(law.name, { article: ref, date: v.effective_on }), splitSpec: `law:${n(a.law_id)}:${articleSegment(ref.no, ref.branch)}`, numericId: n(a.id) });
      }
    }
  }
  return { tagKey, label: tags[0].label, items: buildTimeline(raw) };
}

// ── 분할 화면 패널 ───────────────────────────────────────────
export type PanelContent =
  | { status: "ok"; kind: PanelSpec["kind"]; title: string; text: string; href: string; locked?: boolean; reason?: string }
  | { status: "denied" | "not_found"; kind: PanelSpec["kind"] };

/** 공개 법령·결정례 패널 (받는 사람 권한과 무관하게 공개 자료만). 지식창고·메모는 호출하는 쪽이 권한 판정을 한다 */
export async function loadPublicPanel(spec: PanelSpec): Promise<PanelContent> {
  const db = publicDb();
  if (spec.kind === "law") {
    const ref = parseArticleSegment(spec.article ?? "");
    if (!ref) return { status: "not_found", kind: "law" };
    const laws = await rowsOf<{ id: number; name: string }>(db.from("public_laws").select("id, name").eq("id", spec.id), "분할 법령");
    if (laws.length === 0) return { status: "not_found", kind: "law" };
    const today = kstToday(new Date());
    const versions = await rowsOf<{ id: number; effective_on: string }>(db.from("public_law_versions").select("id, effective_on").eq("law_id", spec.id).lte("effective_on", today).order("effective_on", { ascending: false }).limit(1), "분할 개정판");
    if (versions.length === 0) return { status: "not_found", kind: "law" };
    const arts = await rowsOf<{ title: string | null; body: string }>(db.from("public_law_articles").select("title, body").eq("version_id", versions[0].id).eq("article_no", ref.no).eq("branch_no", ref.branch), "분할 조문");
    if (arts.length === 0) return { status: "not_found", kind: "law" };
    return { status: "ok", kind: "law", title: `${laws[0].name} ${articleLabel(ref.no, ref.branch)}${arts[0].title ? ` (${arts[0].title})` : ""}`, text: arts[0].body, href: lawHref(laws[0].name, { article: ref }) };
  }
  if (spec.kind === "case") {
    const docs = await rowsOf<{ id: number; doc_type: string; issuer: string; doc_no: string }>(db.from("public_legal_docs").select("id, doc_type, issuer, doc_no").eq("id", spec.id), "분할 결정례");
    if (docs.length === 0) return { status: "not_found", kind: "case" };
    const bodies = await rowsOf<{ body: string }>(db.from("public_legal_doc_bodies").select("body").eq("id", spec.id), "분할 결정례 본문");
    if (bodies.length === 0) return { status: "not_found", kind: "case" };
    return { status: "ok", kind: "case", title: `${docs[0].issuer} ${docs[0].doc_no}`, text: bodies[0].body, href: `/cases/${docs[0].doc_type}/${n(docs[0].id)}` };
  }
  return { status: "denied", kind: spec.kind };
}

// ── 계정과목 연결 ────────────────────────────────────────────
const ACCOUNT_COLUMNS = "id, account_code, account_name, target_type, target_id, target_article_no, target_branch_no, relation, std_ref, version, signed_at";
export async function getAccountMappings(): Promise<AccountMappingRow[] | null> {
  if (!(await readPublicSettings()).features.account_links) return null;
  const rows = await rowsOf<AccountMappingRow>(publicDb().from("public_account_mappings").select(ACCOUNT_COLUMNS).order("account_name"), "계정과목 연결");
  return rows.map((r) => ({ ...r, id: n(r.id), target_id: n(r.target_id) }));
}
