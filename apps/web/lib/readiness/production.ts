// 기사 생산 대시보드의 세는 규칙 (NAV-14 · NAV-13 — PRD-01A 4.17.2, docs/dev/W2-c_설계.md 8.5) — 순수 모듈 (시험 production.test.ts).
// DB 함수 news_production_facts는 기사마다 사실만 모아 주고, 무엇을 세는지(내부 정의·공식 정의·비교)는 여기 한 곳에 있다.
//  · 고르는 기사(두 정의 공통): 지금 공개 중(published)이고 기간 [start, end) 안에 처음 발행된 기사. 이관(옛 사이트) 기사는 내부 정의에서 빼고,
//    공식 정의는 요건 거르개가 includeLegacy일 때만 넣는다. 보류·삭제로 내린 기사·이관 기사 수는 따로 보인다
//  · 내부 정의(이 파일 internalMetrics): 자체 취재 후보 = 보도(reported_news). 금주 핫뉴스·칼럼·광고·해설·가이드는 분자 0 (PRD-01A 4.17 ·
//    PRD_최종 §7.2 '핫뉴스·행사·분양 정보·칼럼은 자체 취재 기사로 세지 않는다'). 네이버의 자체 생산 기사 기준과 다를 수 있다 — 같다고 보이지 않는다
//  · 공식 정의(officialValue): 확정된 규정 버전 요건의 분자·분모 거르개. 기준 비교(compareCriterion)는 그 버전의 심사 대상 기간 하나에서만 한다
//  · 유사도는 중복·표절 검토용 경고 — 기준을 넘은 점검이 있었던 원고 수와 유사도를 확인하지 못한 발행 기사 수만 센다
import { inWindow, type MonthWindow } from "./windows";
import type { ArticleFilter, RequirementItem } from "./requirements";

export interface FactArticle {
  id: number;
  slug: string;
  title: string;
  section: string;
  contentType: string | null;
  reportingMethod: string | null;
  origin: string;
  status: string;
  label: string;
  authorId: number | null;
  /** 첫 발행 시각 (UTC 밀리초) */
  publishedAt: number;
  /** 연결된 기사 기획의 종류 — general·feature·investigative, 기획 없으면 null */
  assignmentKind: string | null;
  editorialStatus: string;
  taxReviewStatus: string;
  evidenceTotal: number;
  evidenceVerified: number;
  evidenceRightsUnconfirmed: number;
  /** 대표·본문 이미지 가운데 권리 확인이 안 된 수 */
  mediaUnconfirmed: number;
  /** 사람 값 (봇·편집국 제외 — article_stats, 발행 뒤 지금까지) */
  viewsHuman: number;
  engagedViews: number;
  shares: number;
  /** 가장 최근 발행 점검의 유사도 상태 — pass·blocked·no_sources·no_body, 점검 없으면 null */
  lastSimilarity: string | null;
}

export interface Facts {
  articles: FactArticle[];
  corrections: { articleId: number; kind: string; at: number }[];
  similarityChecks: { articleId: number; status: string; at: number }[];
  people: Map<number, { name: string; roles: string[]; employment: string | null }>;
  /** 기자(인물 번호) → 지금 맡은 기획 수 (assigned·reporting·fact_check·review) */
  openAssignments: Map<number, number>;
}

// ── DB 응답 읽기 ─────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : num(v));
const textOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const time = (v: unknown): number => (typeof v === "string" ? Date.parse(v) : Number.NaN);

function shapeError(): Error {
  return new Error("기사 생산 읽기 함수의 응답 모양이 틀립니다");
}

export function decodeFacts(raw: unknown): Facts {
  if (!isObj(raw)) throw shapeError();
  const lists = ["articles", "corrections", "similarity_checks", "people", "open_assignments"] as const;
  for (const k of lists) if (!Array.isArray(raw[k])) throw shapeError();
  const rows = (k: (typeof lists)[number]) =>
    (raw[k] as unknown[]).map((r) => {
      if (!isObj(r)) throw shapeError();
      return r;
    });
  const articles = rows("articles").map((a): FactArticle => {
    const publishedAt = time(a.published_at);
    if (Number.isNaN(publishedAt)) throw shapeError();
    return {
      id: num(a.id),
      slug: String(a.slug),
      title: String(a.title),
      section: String(a.section),
      contentType: textOrNull(a.content_type),
      reportingMethod: textOrNull(a.reporting_method),
      origin: String(a.origin),
      status: String(a.status),
      label: String(a.label),
      authorId: numOrNull(a.author_id),
      publishedAt,
      assignmentKind: textOrNull(a.assignment_kind),
      editorialStatus: String(a.editorial_status),
      taxReviewStatus: String(a.tax_review_status),
      evidenceTotal: num(a.evidence_total),
      evidenceVerified: num(a.evidence_verified),
      evidenceRightsUnconfirmed: num(a.evidence_rights_unconfirmed),
      mediaUnconfirmed: num(a.media_unconfirmed),
      viewsHuman: num(a.views_human),
      engagedViews: num(a.engaged_views),
      shares: num(a.shares),
      lastSimilarity: textOrNull(a.last_similarity),
    };
  });
  return {
    articles,
    corrections: rows("corrections").map((c) => ({ articleId: num(c.article_id), kind: String(c.kind), at: time(c.at) })),
    similarityChecks: rows("similarity_checks").map((c) => ({ articleId: num(c.article_id), status: String(c.status), at: time(c.at) })),
    people: new Map(rows("people").map((p) => [num(p.id), { name: String(p.name), roles: Array.isArray(p.roles) ? p.roles.map(String) : [], employment: textOrNull(p.employment) }])),
    openAssignments: new Map(rows("open_assignments").map((o) => [num(o.reporter_id), num(o.count)])),
  };
}

// ── 고르는 기사 ──────────────────────────────────────────

/** 지금 공개 중이고 기간 안에 처음 발행된 기사 — 이관 기사는 includeLegacy일 때만 */
export function windowArticles(facts: Facts, window: MonthWindow, opts: { includeLegacy?: boolean } = {}): FactArticle[] {
  return facts.articles.filter((a) => a.status === "published" && inWindow(a.publishedAt, window) && (opts.includeLegacy || a.origin !== "legacy"));
}

// ── 내부 정의 ────────────────────────────────────────────

/** 정정 이력 블록에 오르는 정정·반론·추후보도 (article_corrections — 삭제·제목 변경은 따로) */
export const CORRECTION_KINDS = ["correction", "rebuttal", "follow_up"] as const;
const OWN_CONTENT_TYPE = "reported_news";
const FEATURE_KINDS = new Set(["feature", "investigative"]);
const TAX_REVIEW_MISSING = new Set(["pending", "rejected", "held"]);
const SIMILARITY_CHECKED = new Set(["pass", "blocked"]);

export interface InternalMetrics {
  /** 총 발행 */
  total: number;
  /** 자체 취재 후보 (보도) */
  own: number;
  /** 자체 취재 후보의 취재 방식 — 비어 있으면 missing */
  methods: { quantitative: number; qualitative: number; mixed: number; missing: number };
  /** 기획·탐사 기획에서 나온 기사 */
  feature: number;
  /** 자체 취재 후보 가운데 확인된 취재 근거가 0건 */
  missingEvidence: number;
  /** 권리 확인이 안 된 이미지나 취재 근거가 있는 기사 */
  missingRights: number;
  /** 편집 승인 기록이 승인이 아닌 기사 */
  missingDesk: number;
  /** 세무 감수가 필요한 기사 · 그 가운데 감수 승인이 없는 기사 */
  taxReviewNeeded: number;
  missingTaxReview: number;
  /** 기간 안에 결정된 정정·반론·추후보도 (어느 기사든) */
  corrections: Record<(typeof CORRECTION_KINDS)[number], number>;
  /** 유사도 사전 경고 — 기간 안 점검에서 기준을 넘은 원고 수(발행 안 된 원고 포함) · 유사도를 확인하지 못한 발행 기사 수 */
  similarity: { blocked: number; unverified: number };
  /** 독자 반응 (사람 값 — 봇·편집국 제외) */
  reader: { views: number; engaged: number; shares: number };
  /** 기간 안에 처음 발행됐지만 뺀 기사 — 지금 보류·삭제 · 이관 기사 */
  excluded: { notPublished: number; legacy: number };
}

export function internalMetrics(facts: Facts, window: MonthWindow): InternalMetrics {
  const base = windowArticles(facts, window);
  const own = base.filter((a) => a.contentType === OWN_CONTENT_TYPE);
  const inside = facts.articles.filter((a) => inWindow(a.publishedAt, window));
  const corrections = { correction: 0, rebuttal: 0, follow_up: 0 };
  for (const c of facts.corrections) {
    if (inWindow(c.at, window) && (CORRECTION_KINDS as readonly string[]).includes(c.kind)) corrections[c.kind as keyof typeof corrections] += 1;
  }
  const blocked = new Set(facts.similarityChecks.filter((c) => c.status === "blocked" && inWindow(c.at, window)).map((c) => c.articleId));
  const count = (list: readonly FactArticle[], pick: (a: FactArticle) => boolean) => list.filter(pick).length;
  const sum = (pick: (a: FactArticle) => number) => base.reduce((s, a) => s + pick(a), 0);
  return {
    total: base.length,
    own: own.length,
    methods: {
      quantitative: count(own, (a) => a.reportingMethod === "quantitative"),
      qualitative: count(own, (a) => a.reportingMethod === "qualitative"),
      mixed: count(own, (a) => a.reportingMethod === "mixed"),
      missing: count(own, (a) => a.reportingMethod === null),
    },
    feature: count(base, (a) => a.assignmentKind !== null && FEATURE_KINDS.has(a.assignmentKind)),
    missingEvidence: count(own, (a) => a.evidenceVerified === 0),
    missingRights: count(base, (a) => a.mediaUnconfirmed > 0 || a.evidenceRightsUnconfirmed > 0),
    missingDesk: count(base, (a) => a.editorialStatus !== "approved"),
    taxReviewNeeded: count(base, (a) => a.taxReviewStatus !== "not_required"),
    missingTaxReview: count(base, (a) => TAX_REVIEW_MISSING.has(a.taxReviewStatus)),
    corrections,
    similarity: { blocked: blocked.size, unverified: count(base, (a) => a.lastSimilarity === null || !SIMILARITY_CHECKED.has(a.lastSimilarity)) },
    reader: { views: sum((a) => a.viewsHuman), engaged: sum((a) => a.engagedViews), shares: sum((a) => a.shares) },
    excluded: {
      notPublished: count(inside, (a) => a.status !== "published"),
      legacy: count(inside, (a) => a.status === "published" && a.origin === "legacy"),
    },
  };
}

// ── 공식 정의 ────────────────────────────────────────────

/** 거르개 — 적힌 칸은 모두 맞아야(그리고), 비운 칸은 모두. 이관 여부는 windowArticles가 본다 */
export function matchesFilter(a: FactArticle, f: ArticleFilter): boolean {
  if (f.contentTypes && (a.contentType === null || !f.contentTypes.includes(a.contentType))) return false;
  if (f.reportingMethods && (a.reportingMethod === null || !f.reportingMethods.includes(a.reportingMethod))) return false;
  if (f.assignmentKinds && (a.assignmentKind === null || !f.assignmentKinds.includes(a.assignmentKind))) return false;
  return true;
}

export interface OfficialValue {
  numerator: number;
  /** 비율의 분모 · 기자 1인당의 기자 수. 기사 수는 null */
  denominator: number | null;
  /** 비율은 0~1, 기사 수는 건, 기자 1인당은 건/명. 분모가 0이면 null */
  value: number | null;
}

export function officialValue(item: RequirementItem, facts: Facts, window: MonthWindow): OfficialValue {
  const pick = (f: ArticleFilter) => windowArticles(facts, window, { includeLegacy: f.includeLegacy === true }).filter((a) => matchesFilter(a, f));
  const numerator = pick(item.numerator);
  if (item.metric === "count") return { numerator: numerator.length, denominator: null, value: numerator.length };
  if (item.metric === "ratio") {
    const denominator = pick(item.denominator ?? {}).length;
    return { numerator: numerator.length, denominator, value: denominator === 0 ? null : numerator.length / denominator };
  }
  const authored = numerator.filter((a) => a.authorId !== null);
  const reporters = new Set(authored.map((a) => a.authorId)).size;
  return { numerator: authored.length, denominator: reporters, value: reporters === 0 ? null : authored.length / reporters };
}

/** 비교 결과 — compared는 기준과 같은 단위의 값(비율은 %, 월평균은 건/달). 값이 없으면(분모 0) 미달 */
export type Comparison = { kind: "met" | "short"; compared: number | null } | { kind: "none" };

export function compareCriterion(item: RequirementItem, v: OfficialValue, window: Pick<MonthWindow, "monthsCounted">): Comparison {
  const c = item.criterion;
  if (!c) return { kind: "none" };
  if (v.value === null) return { kind: "short", compared: null };
  const raw = item.metric === "ratio" ? v.value * 100 : c.per === "month" ? v.value / window.monthsCounted : v.value;
  const compared = Math.round(raw * 1e9) / 1e9; // 0.1+0.2 같은 부동소수 꼬리를 경계 비교에서 뺀다
  const met = c.comparator === "gte" ? compared >= c.value : compared > c.value;
  return { kind: met ? "met" : "short", compared };
}

export interface OfficialRow {
  item: RequirementItem;
  /** 대시보드 기간마다 (windows 순서) */
  values: OfficialValue[];
  /** 규정 버전의 심사 대상 기간 */
  review: OfficialValue;
  comparison: Comparison;
}

export function officialRows(items: readonly RequirementItem[], facts: Facts, windows: readonly MonthWindow[], reviewWindow: MonthWindow): OfficialRow[] {
  return items.map((item) => {
    const review = officialValue(item, facts, reviewWindow);
    return { item, values: windows.map((w) => officialValue(item, facts, w)), review, comparison: compareCriterion(item, review, reviewWindow) };
  });
}

/** NAV-13 — 요건이 지금 생산량으로 채워지지 않으면 인력·취재 역량 보강 또는 신청 연기 안내 (비슷한 기사 대량 발행으로 맞추지 않는다) */
export function needsCapacityGuidance(rows: readonly OfficialRow[]): boolean {
  return rows.some((r) => r.comparison.kind === "short");
}

// ── 기자별 취재 부담 ─────────────────────────────────────

export interface ReporterRow {
  personId: number;
  name: string;
  roles: string[];
  employment: string | null;
  /** 기간마다 발행 수 · 자체 취재 후보 수 (windows 순서) */
  published: number[];
  own: number[];
  /** 지금 맡은 기획 */
  open: number;
}

export function reporterRows(facts: Facts, windows: readonly MonthWindow[]): ReporterRow[] {
  const ids = new Set<number>([...facts.people.keys(), ...facts.openAssignments.keys()]);
  const rows: ReporterRow[] = [];
  for (const id of ids) {
    const person = facts.people.get(id);
    const published = windows.map((w) => windowArticles(facts, w).filter((a) => a.authorId === id).length);
    const own = windows.map((w) => windowArticles(facts, w).filter((a) => a.authorId === id && a.contentType === OWN_CONTENT_TYPE).length);
    const open = facts.openAssignments.get(id) ?? 0;
    if (open === 0 && published.every((n) => n === 0)) continue;
    rows.push({ personId: id, name: person?.name ?? `인물 ${id}`, roles: person?.roles ?? [], employment: person?.employment ?? null, published, own, open });
  }
  const last = windows.length - 1;
  return rows.sort((a, b) => (b.published[last] ?? 0) - (a.published[last] ?? 0) || a.name.localeCompare(b.name, "ko") || a.personId - b.personId);
}

// ── 근거 → 편집 → 정정 추적 ─────────────────────────────

export interface TraceRow {
  id: number;
  slug: string;
  title: string;
  publishedAt: number;
  reportingMethod: string | null;
  evidenceVerified: number;
  evidenceTotal: number;
  editorialStatus: string;
  taxReviewStatus: string;
  /** 읽은 기간 안의 정정·반론·추후보도·삭제·제목 변경 기록 수 */
  corrections: number;
  lastSimilarity: string | null;
}

export function traceRows(facts: Facts, window: MonthWindow, limit: number): { rows: TraceRow[]; total: number } {
  const own = windowArticles(facts, window)
    .filter((a) => a.contentType === OWN_CONTENT_TYPE)
    .sort((a, b) => b.publishedAt - a.publishedAt || b.id - a.id);
  const corrections = new Map<number, number>();
  for (const c of facts.corrections) corrections.set(c.articleId, (corrections.get(c.articleId) ?? 0) + 1);
  return {
    total: own.length,
    rows: own.slice(0, limit).map((a) => ({
      id: a.id,
      slug: a.slug,
      title: a.title,
      publishedAt: a.publishedAt,
      reportingMethod: a.reportingMethod,
      evidenceVerified: a.evidenceVerified,
      evidenceTotal: a.evidenceTotal,
      editorialStatus: a.editorialStatus,
      taxReviewStatus: a.taxReviewStatus,
      corrections: corrections.get(a.id) ?? 0,
      lastSimilarity: a.lastSimilarity,
    })),
  };
}
