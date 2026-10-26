import "server-only";
import { articleLabel, lawHref } from "@/lib/law/article-ref";
import { buildDiagram, type Diagram, type DiagramEdge, type DiagramNode, type Relation } from "@/lib/issues/diagram";
import { publicDb, rowsOf } from "./db";
import { readPublicSettings } from "./reads";

// 쟁점 연결 지도 공개 데이터 (LINK-01 · TRU-05 · RDV-08 - docs/dev/W11-d_설계.md 6장). 공개 뷰(public_issue_graphs · public_issue_graph_nodes ·
// public_issue_tags · public_case_issue_tags · public_legal_docs · public_guides)만 읽는다 - 서명 전·승인 전 행은 뷰 안에서 이미 걸러져 있다.
// 기능 키(issue_graph)가 꺼져 있으면 null -> 화면 404. 법령명·조문 번호·시행일·결정일은 모두 원문 DB 뷰 값이고 이 모듈에 글자 상수가 없다. AI는 쓰지 않는다.

export const ISSUE_HUBS = ["trust", "redevelopment", "inheritance_gift"] as const;
export const ISSUE_HUB_LABEL: Record<string, string> = { trust: "신탁", redevelopment: "정비", inheritance_gift: "상속·증여" };
const DOC_TYPE_LABEL: Record<string, string> = { ruling: "예규", circular: "통칙", interpretation: "유권해석", tribunal: "심판", case: "판례" };
export const isIssueHub = (v: string | null | undefined): v is (typeof ISSUE_HUBS)[number] => (ISSUE_HUBS as readonly string[]).includes(v ?? "");

export interface IssueSummary {
  slug: string;
  version: number;
  hub: string;
  title: string;
  summary: string | null;
  as_of: string | null;
  last_reviewed_at: string;
  stale: boolean;
}
export interface IssueIndexView {
  hub: string | null;
  items: IssueSummary[];
}

export async function getIssueIndex(hub: string | null): Promise<IssueIndexView | null> {
  if (!(await readPublicSettings()).features.issue_graph) return null;
  let q = publicDb().from("public_issue_graphs").select("slug, version, hub, title, summary, as_of, last_reviewed_at, stale").order("published_at", { ascending: false });
  if (isIssueHub(hub)) q = q.eq("hub", hub);
  const rows = await rowsOf<IssueSummary>(q, "쟁점 지도 목록");
  return { hub: isIssueHub(hub) ? hub : null, items: rows.map((r) => ({ ...r, version: Number(r.version) })) };
}

interface NodeRow {
  node_id: string;
  kind: "law_article" | "case";
  ref_id: number;
  law_id: number | null;
  law_name: string | null;
  article_no: number | null;
  branch_no: number | null;
  promulgation_no: string | null;
  effective_on: string | null;
  doc_type: string | null;
  issuer: string | null;
  doc_no: string | null;
  decided_on: string | null;
}
export interface IssueNodeLink {
  id: string;
  href: string;
  /** 조문 노드의 법령 번호 - 결정례 노드는 null (측정 issue_map_source_opened용) */
  lawId: number | null;
  /** 이 노드에 닿는 첫 연결선의 관계 라벨 */
  relation: Relation | null;
}
export const ISSUE_ENTRIES = ["hub", "guide", "case_list", "direct"] as const;
export type IssueEntry = (typeof ISSUE_ENTRIES)[number];
export const parseIssueEntry = (v: unknown): IssueEntry => ((ISSUE_ENTRIES as readonly string[]).includes(String(v)) ? (v as IssueEntry) : "direct");
export interface IssuePageView {
  slug: string;
  version: number;
  hub: string;
  title: string;
  summary: string | null;
  as_of: string | null;
  last_reviewed_at: string;
  stale: boolean;
  diagram: Diagram;
  /** 노드 id -> 원문 주소 (조문은 시행일 기준일, 결정례는 상세) */
  links: IssueNodeLink[];
  guides: Array<{ slug: string; anchor: string | null; title: string | null }>;
}

export async function getIssuePage(slug: string): Promise<IssuePageView | null> {
  if (!(await readPublicSettings()).features.issue_graph) return null;
  const db = publicDb();
  const graphs = await rowsOf<Omit<IssueSummary, "summary"> & { summary: string | null; nodes: unknown; edges: unknown; guide_refs: Array<{ slug: string; anchor?: string }> }>(
    db.from("public_issue_graphs").select("slug, version, hub, title, summary, as_of, last_reviewed_at, stale, nodes, edges, guide_refs").eq("slug", slug).limit(1),
    "쟁점 지도",
  );
  const g = graphs[0];
  if (!g) return null;
  const nodeRows = await rowsOf<NodeRow & { ord: number }>(
    db.from("public_issue_graph_nodes").select("ord, node_id, kind, ref_id, law_id, law_name, article_no, branch_no, promulgation_no, effective_on, doc_type, issuer, doc_no, decided_on").eq("slug", slug).eq("version", g.version).order("ord"),
    "쟁점 지도 노드",
  );
  const rawEdges = (Array.isArray(g.edges) ? g.edges : []) as Array<{ from: string; to: string; relation: Relation; note?: string }>;
  const relationOf = (id: string): Relation | null => rawEdges.find((e) => e.from === id || e.to === id)?.relation ?? null;
  const links: IssueNodeLink[] = [];
  const nodes: DiagramNode[] = nodeRows.map((r) => {
    if (r.kind === "law_article") {
      const ref = { no: Number(r.article_no), branch: Number(r.branch_no) };
      links.push({ id: r.node_id, href: lawHref(r.law_name as string, { article: ref, date: r.effective_on }), lawId: r.law_id === null ? null : Number(r.law_id), relation: relationOf(r.node_id) });
      return { id: r.node_id, kind: "law_article", group: r.law_name as string, title: `${r.law_name} ${articleLabel(ref.no, ref.branch)}`, sub: `시행 ${r.effective_on}` };
    }
    links.push({ id: r.node_id, href: `/cases/${r.doc_type}/${r.ref_id}`, lawId: null, relation: relationOf(r.node_id) });
    return { id: r.node_id, kind: "case", group: DOC_TYPE_LABEL[r.doc_type as string] ?? (r.doc_type as string), title: `${r.issuer} ${r.doc_no}`, sub: `${DOC_TYPE_LABEL[r.doc_type as string] ?? r.doc_type} ${r.decided_on}` };
  });
  const edges: DiagramEdge[] = rawEdges.map((e) => ({ from: e.from, to: e.to, relation: e.relation, note: e.note ?? null }));
  const refs = Array.isArray(g.guide_refs) ? g.guide_refs : [];
  const guideRows = refs.length ? await rowsOf<{ slug: string; title: string }>(db.from("public_guides").select("slug, title").in("slug", refs.map((r) => r.slug)), "쟁점 지도 가이드") : [];
  return {
    slug: g.slug,
    version: Number(g.version),
    hub: g.hub,
    title: g.title,
    summary: g.summary,
    as_of: g.as_of,
    last_reviewed_at: g.last_reviewed_at,
    stale: g.stale,
    diagram: buildDiagram(g.title, nodes, edges),
    links,
    guides: refs.map((r) => ({ slug: r.slug, anchor: r.anchor ?? null, title: guideRows.find((x) => x.slug === r.slug)?.title ?? null })),
  };
}

// ── TRU-05 · RDV-08 쟁점 태그로 거른 결정례·해석 모음 ───────────────────────────

export interface IssueCaseItem {
  id: number;
  doc_type: string;
  issuer: string;
  doc_no: string;
  decided_on: string;
  tags: Array<{ tag_key: string; label: string }>;
}
export interface IssueCaseListView {
  hub: (typeof ISSUE_HUBS)[number];
  tagKey: string | null;
  tags: Array<{ tag_key: string; label: string }>;
  items: IssueCaseItem[];
}

export async function getIssueCaseList(hub: string, tagKey: string | null): Promise<IssueCaseListView | null> {
  if (!(await readPublicSettings()).features.issue_graph || !isIssueHub(hub)) return null;
  const db = publicDb();
  const [tags, links] = await Promise.all([
    rowsOf<{ tag_key: string; label: string }>(db.from("public_issue_tags").select("tag_key, label").eq("hub", hub).order("label"), "쟁점 태그"),
    rowsOf<{ case_id: number; tag_key: string; label: string }>(db.from("public_case_issue_tags").select("case_id, tag_key, label").eq("hub", hub), "결정례 태그"),
  ]);
  const wanted = tagKey && tags.some((t) => t.tag_key === tagKey) ? tagKey : null;
  const picked = wanted ? links.filter((l) => l.tag_key === wanted) : links;
  const ids = [...new Set(picked.map((l) => Number(l.case_id)))];
  const docs = ids.length
    ? await rowsOf<{ id: number; doc_type: string; issuer: string; doc_no: string; decided_on: string }>(
        db.from("public_legal_docs").select("id, doc_type, issuer, doc_no, decided_on").in("id", ids).order("decided_on", { ascending: false }),
        "태그 결정례",
      )
    : [];
  const items = docs.map((d) => ({
    id: Number(d.id),
    doc_type: d.doc_type,
    issuer: d.issuer,
    doc_no: d.doc_no,
    decided_on: d.decided_on,
    tags: links.filter((l) => Number(l.case_id) === Number(d.id)).map((l) => ({ tag_key: l.tag_key, label: l.label })),
  }));
  return { hub, tagKey: wanted, tags, items };
}
