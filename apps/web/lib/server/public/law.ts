import "server-only";
import { articleLabel, lawHref, parseArticleSegment, parseLawSegment, type ArticleRef } from "@/lib/law/article-ref";
import { earliestVersion, parseAsOf, pickVersionAsOf, previousVersion, upcomingVersions, kstToday, type AsOf } from "@/lib/law/as-of";
import { buildThreeRows, type DelegationEdge, type ProvRef, type ThreeRow } from "@/lib/law/three";
import { isAfterAsOf, reasonForProvision, type DocType, type LinkRelation, type RelatedItem } from "@/lib/law/related";
import { newsHref } from "./constants";
import { pageOf, publicDb, rowsOf } from "./db";
import { readPublicSettings } from "./reads";

// 법령 뷰어 공개 데이터 (LAW-01~05 · LAW-06 · TX-11 - docs/dev/W10-d_설계.md). 공개 뷰(public_laws · public_law_versions · public_law_articles ·
// public_law_families · public_law_delegations · public_links)만 읽는다 - 기능 키(law_viewer · law_three)와 공개 조건은 뷰 안에 있다.
// 기능 키가 꺼져 있으면 null -> 화면 404. 이 모듈은 AI를 쓰지 않는다.

export interface LawRow {
  id: number;
  name: string;
  tier: "statute" | "decree" | "rule";
  scope: "local" | "linked_national";
}
export interface LawVersionRow {
  id: number;
  law_id: number;
  promulgation_no: string;
  promulgated_on: string;
  effective_on: string;
  revision_kind: string | null;
}
export interface LawArticleRow {
  id: number;
  version_id: number;
  law_id: number;
  article_no: number;
  branch_no: number;
  title: string | null;
  body: string;
  effective_on: string | null;
}

const LAW_COLUMNS = "id, name, tier, scope";
const VERSION_COLUMNS = "id, law_id, promulgation_no, promulgated_on, effective_on, revision_kind";
const ARTICLE_COLUMNS = "id, version_id, law_id, article_no, branch_no, title, body, effective_on";

const n = (v: unknown) => Number(v);
const normLaw = (r: LawRow): LawRow => ({ ...r, id: n(r.id) });
const normVersion = (r: LawVersionRow): LawVersionRow => ({ ...r, id: n(r.id), law_id: n(r.law_id) });
const normArticle = (r: LawArticleRow): LawArticleRow => ({ ...r, id: n(r.id), version_id: n(r.version_id), law_id: n(r.law_id), article_no: n(r.article_no), branch_no: n(r.branch_no) });

export async function findLaw(segment: string): Promise<LawRow | null> {
  const key = parseLawSegment(segment);
  if (!key) return null;
  const q = publicDb().from("public_laws").select(LAW_COLUMNS);
  const rows = await rowsOf<LawRow>("id" in key ? q.eq("id", key.id) : q.eq("name", key.name), "법령");
  return rows[0] ? normLaw(rows[0]) : null;
}

async function versionsOf(lawIds: number[]): Promise<LawVersionRow[]> {
  const rows = await rowsOf<LawVersionRow>(publicDb().from("public_law_versions").select(VERSION_COLUMNS).in("law_id", lawIds).order("effective_on", { ascending: false }).order("id", { ascending: false }), "법령 연혁");
  return rows.map(normVersion);
}

async function articlesOfVersion(versionId: number): Promise<LawArticleRow[]> {
  const rows = await rowsOf<LawArticleRow>(publicDb().from("public_law_articles").select(ARTICLE_COLUMNS).eq("version_id", versionId).order("article_no").order("branch_no"), "법령 조문");
  return rows.map(normArticle);
}

// ── /law 목록 ──────────────────────────────────────────────────

export interface LawIndexEntry extends LawRow {
  /** 오늘 시행 중인 개정판의 시행일자 - 시행 중인 개정판이 아직 없으면 null */
  currentEffectiveOn: string | null;
  upcomingOn: string | null;
}
export interface LawIndexView {
  today: string;
  laws: LawIndexEntry[];
}

export async function getLawIndex(now: Date = new Date()): Promise<LawIndexView | null> {
  if (!(await readPublicSettings()).features.law_viewer) return null;
  const today = kstToday(now);
  const laws = (await rowsOf<LawRow>(publicDb().from("public_laws").select(LAW_COLUMNS).order("id"), "법령 목록")).map(normLaw);
  if (laws.length === 0) return { today, laws: [] };
  const versions = await versionsOf(laws.map((l) => l.id));
  return {
    today,
    laws: laws.map((l) => {
      const vs = versions.filter((v) => v.law_id === l.id);
      return { ...l, currentEffectiveOn: pickVersionAsOf(vs, today)?.effective_on ?? null, upcomingOn: upcomingVersions(vs, today)[0]?.effective_on ?? null };
    }),
  };
}

// ── 3단 보기 가능 여부 ───────────────────────────────────────────

/** 이 법령이 속한 법·시행령·시행규칙 묶음 - 법률 이름과 3단 보기 열림 여부 */
async function threeEntry(law: LawRow): Promise<{ statuteName: string } | null> {
  const db = publicDb();
  const col = law.tier === "statute" ? "statute_id" : law.tier === "decree" ? "decree_id" : "rule_id";
  const fam = await rowsOf<{ statute_id: number; decree_id: number | null; rule_id: number | null }>(db.from("public_law_families").select("statute_id, decree_id, rule_id").eq(col, law.id), "법령 묶음");
  const f = fam[0];
  if (!f || (f.decree_id === null && f.rule_id === null)) return null;
  const { total } = await pageOf(db.from("public_law_delegations").select("id", { count: "exact" }).in("parent_law_id", [n(f.statute_id), ...(f.decree_id === null ? [] : [n(f.decree_id)])]).limit(1), "위임 매핑");
  if (total === 0) return null;
  const statute = law.tier === "statute" ? law : await rowsOf<LawRow>(db.from("public_laws").select(LAW_COLUMNS).eq("id", n(f.statute_id)), "법률");
  const name = Array.isArray(statute) ? statute[0]?.name : statute.name;
  return name ? { statuteName: name } : null;
}

// ── /law/[lawId] ─────────────────────────────────────────────────

export interface LawPageView {
  law: LawRow;
  asOf: AsOf;
  today: string;
  versions: LawVersionRow[];
  /** 기준일에 시행 중인 개정판 - 기준일이 첫 개정판보다 앞서면 null */
  current: LawVersionRow | null;
  earliest: LawVersionRow | null;
  upcoming: LawVersionRow[];
  articles: LawArticleRow[];
  threeStatuteName: string | null;
}

export async function getLawPage(segment: string, dateParam: string | string[] | undefined, now: Date = new Date()): Promise<LawPageView | null> {
  if (!(await readPublicSettings()).features.law_viewer) return null;
  const law = await findLaw(segment);
  if (!law) return null;
  const today = kstToday(now);
  const asOf = parseAsOf(dateParam, today);
  const versions = await versionsOf([law.id]);
  const current = pickVersionAsOf(versions, asOf.date);
  const [articles, three] = await Promise.all([current ? articlesOfVersion(current.id) : Promise.resolve([]), threeEntry(law)]);
  return { law, asOf, today, versions, current, earliest: earliestVersion(versions), upcoming: upcomingVersions(versions, today), articles, threeStatuteName: (await readPublicSettings()).features.law_three ? (three?.statuteName ?? null) : null };
}

// ── /law/[lawId]/[article] ───────────────────────────────────────

export interface ArticlePageView extends Omit<LawPageView, "articles"> {
  ref: ArticleRef;
  /** 기준일 개정판의 이 조문 - 없으면 null (그 시점에 없던 조문) */
  article: LawArticleRow | null;
  /** 신구 대비의 '구' 개정판과 그 조문 */
  previous: { version: LawVersionRow; article: LawArticleRow | null } | null;
  related: RelatedItem[];
}

export async function getArticlePage(segment: string, articleSegment: string, dateParam: string | string[] | undefined, vsParam: string | string[] | undefined, now: Date = new Date()): Promise<ArticlePageView | null> {
  const ref = parseArticleSegment(articleSegment);
  if (!ref) return null;
  const base = await getLawPage(segment, dateParam, now);
  if (!base) return null;
  const { articles: _unused, ...rest } = base;
  void _unused;
  const db = publicDb();
  let article: LawArticleRow | null = null;
  if (base.current) {
    const rows = await rowsOf<LawArticleRow>(db.from("public_law_articles").select(ARTICLE_COLUMNS).eq("version_id", base.current.id).eq("article_no", ref.no).eq("branch_no", ref.branch), "법령 조문");
    article = rows[0] ? normArticle(rows[0]) : null;
  }
  let prevVersion: LawVersionRow | null = null;
  if (base.current) {
    const vs = parseAsOf(vsParam, "");
    const picked = vs.explicit ? pickVersionAsOf(base.versions, vs.date) : null;
    prevVersion = picked && picked.id !== base.current.id ? picked : previousVersion(base.versions, base.current);
  }
  let previous: ArticlePageView["previous"] = null;
  if (prevVersion) {
    const rows = await rowsOf<LawArticleRow>(db.from("public_law_articles").select(ARTICLE_COLUMNS).eq("version_id", prevVersion.id).eq("article_no", ref.no).eq("branch_no", ref.branch), "이전 조문");
    previous = { version: prevVersion, article: rows[0] ? normArticle(rows[0]) : null };
  }
  const related = article ? await getRelatedForProvision(base.law.id, ref, base.asOf.date) : [];
  return { ...rest, ref, article, previous, related };
}

// ── 관련 자료 (LAW-06 · TX-11) ───────────────────────────────────

interface LinkRow {
  id: number;
  src_kind: "legal_doc" | "article";
  src_id: number;
  relation: LinkRelation;
  origin: "auto" | "editor";
}

/** 그 조문을 가리키는 확인된 연결 -> 패널 항목. 목록 = public_links 그대로(개수·ID 일치) */
export async function getRelatedForProvision(lawId: number, ref: ArticleRef, asOfDate: string): Promise<RelatedItem[]> {
  const db = publicDb();
  const links = await rowsOf<LinkRow>(
    db.from("public_links").select("id, src_kind, src_id, relation, origin").eq("dst_kind", "law_provision").eq("dst_id", lawId).eq("dst_article_no", ref.no).eq("dst_branch_no", ref.branch).order("id"),
    "관련 자료 연결",
  );
  if (links.length === 0) return [];
  const docIds = links.filter((l) => l.src_kind === "legal_doc").map((l) => n(l.src_id));
  const articleIds = links.filter((l) => l.src_kind === "article").map((l) => n(l.src_id));
  const [docs, articles] = await Promise.all([
    docIds.length === 0 ? [] : rowsOf<{ id: number; doc_type: DocType; issuer: string; doc_no: string; decided_on: string }>(db.from("public_legal_docs").select("id, doc_type, issuer, doc_no, decided_on").in("id", docIds), "관련 해석"),
    articleIds.length === 0 ? [] : rowsOf<{ id: number; slug: string; title: string }>(db.from("public_articles").select("id, slug, title").in("id", articleIds), "관련 기사"),
  ]);
  const items: RelatedItem[] = [];
  for (const l of links) {
    if (l.src_kind === "legal_doc") {
      const d = docs.find((x) => n(x.id) === n(l.src_id));
      if (d) items.push({ linkId: n(l.id), kind: "legal_doc", docType: d.doc_type, relation: l.relation, origin: l.origin, title: `${d.issuer} ${d.doc_no}`, href: `/cases/${d.doc_type}/${n(d.id)}`, decidedOn: d.decided_on });
    } else {
      const a = articles.find((x) => n(x.id) === n(l.src_id));
      if (a) items.push({ linkId: n(l.id), kind: "article", docType: null, relation: l.relation, origin: l.origin, title: a.title, href: newsHref(a.slug), decidedOn: null });
    }
  }
  void asOfDate;
  return items;
}

export { isAfterAsOf, reasonForProvision };

// ── /law/[lawId]/three ───────────────────────────────────────────

export interface ThreeColumn {
  law: LawRow;
  version: LawVersionRow | null;
  articles: LawArticleRow[];
}
export interface ThreePageView {
  asOf: AsOf;
  today: string;
  statute: ThreeColumn;
  decree: ThreeColumn | null;
  rule: ThreeColumn | null;
  rows: ThreeRow[];
  selected: ArticleRef | null;
  related: RelatedItem[];
}

export async function getThreePage(segment: string, dateParam: string | string[] | undefined, articleParam: string | undefined, now: Date = new Date()): Promise<ThreePageView | null> {
  const settings = await readPublicSettings();
  if (!settings.features.law_viewer || !settings.features.law_three) return null;
  const law = await findLaw(segment);
  if (!law || law.tier !== "statute") return null;
  const db = publicDb();
  const fam = await rowsOf<{ statute_id: number; decree_id: number | null; rule_id: number | null }>(db.from("public_law_families").select("statute_id, decree_id, rule_id").eq("statute_id", law.id), "법령 묶음");
  const f = fam[0];
  if (!f || (f.decree_id === null && f.rule_id === null)) return null;
  // 관문(위임 50건 표본 48 이상)과 위임 매핑이 공개 뷰 안에 있다 - 관문이 닫혀 있으면 위임 뷰가 비고, 3단 보기는 열지 않는다
  const gate = await rowsOf<{ passed: boolean }>(db.from("public_quality_gates").select("passed").eq("kind", "delegation_mapping"), "표본 검사 관문");
  if (!gate[0]?.passed) return null;
  const today = kstToday(now);
  const asOf = parseAsOf(dateParam, today);
  const ids = [law.id, ...(f.decree_id === null ? [] : [n(f.decree_id)]), ...(f.rule_id === null ? [] : [n(f.rule_id)])];
  const [laws, versions] = await Promise.all([rowsOf<LawRow>(db.from("public_laws").select(LAW_COLUMNS).in("id", ids), "법령"), versionsOf(ids)]);
  const column = async (id: number | null): Promise<ThreeColumn | null> => {
    if (id === null) return null;
    const l = laws.map(normLaw).find((x) => x.id === id);
    if (!l) return null;
    const version = pickVersionAsOf(versions.filter((v) => v.law_id === id), asOf.date);
    return { law: l, version, articles: version ? await articlesOfVersion(version.id) : [] };
  };
  const [statute, decree, rule] = await Promise.all([column(law.id), column(f.decree_id === null ? null : n(f.decree_id)), column(f.rule_id === null ? null : n(f.rule_id))]);
  if (!statute) return null;
  const edgesRaw = await rowsOf<{ parent_law_id: number; parent_article_no: number; parent_branch_no: number; child_law_id: number; child_article_no: number; child_branch_no: number }>(
    db.from("public_law_delegations").select("parent_law_id, parent_article_no, parent_branch_no, child_law_id, child_article_no, child_branch_no").in("parent_law_id", ids.slice(0, 2)),
    "위임 매핑",
  );
  const edges: DelegationEdge[] = edgesRaw.map((e) => ({
    parent: { lawId: n(e.parent_law_id), no: n(e.parent_article_no), branch: n(e.parent_branch_no) },
    child: { lawId: n(e.child_law_id), no: n(e.child_article_no), branch: n(e.child_branch_no) },
  }));
  const statuteRefs: ProvRef[] = statute.articles.map((a) => ({ lawId: law.id, no: a.article_no, branch: a.branch_no }));
  const rows = buildThreeRows(statuteRefs, edges, decree?.law.id ?? null, rule?.law.id ?? null);
  const parsed = articleParam ? parseArticleSegment(articleParam) : null;
  const selected = parsed && statuteRefs.some((r) => r.no === parsed.no && r.branch === parsed.branch) ? parsed : (rows[0] ? { no: rows[0].statute.no, branch: rows[0].statute.branch } : null);
  const related = selected ? await getRelatedForProvision(law.id, selected, asOf.date) : [];
  return { asOf, today, statute, decree, rule, rows, selected, related };
}

/** FAM-06 - 근거 칩이 법령 뷰어로 여는 주소. 법령·조문이 DB에 없으면 null(링크하지 않고 글자로 둔다). 상속세·증여세 법령은 이름만으로 거절 */
export async function resolveLawChip(lawName: string, ref: ArticleRef, asOfDate: string): Promise<{ href: string; label: string } | null> {
  if (/(상속세|증여세)/.test(lawName)) return null;
  if (!(await readPublicSettings()).features.law_viewer) return null;
  const law = await findLaw(lawName);
  if (!law) return null;
  const rows = await rowsOf<{ id: number }>(publicDb().from("public_law_articles").select("id").eq("law_id", law.id).eq("article_no", ref.no).eq("branch_no", ref.branch).limit(1), "근거 조문");
  if (rows.length === 0) return null;
  return { href: lawHref(law.name, { article: ref, date: asOfDate }), label: `${law.name} ${articleLabel(ref.no, ref.branch)}` };
}
