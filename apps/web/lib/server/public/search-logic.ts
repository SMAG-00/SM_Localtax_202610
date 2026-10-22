// 통합 검색 — 순수 규칙 (docs/dev/W2-d_설계.md 2·4·8장). 시험 search-logic.test.ts가 설계 문서 2장 표(값·정규화 견본·한도)를 읽어 대조한다.
//  · 정규화(squash·queryTerms)는 DB 함수 search_public과 같은 규칙이다 — 검색은 DB가 정규화하고, 여기 규칙은 빈 검색어 판정·
//    4단계 검색어 집계의 정규형에 쓴다(같은 견본 표를 DB 시험도 지난다)
//  · DB 행 → 결과 보기 값: 주소는 열린 화면만(isOpenPath — 꺼진 기능·아직 없는 화면이면 null), 유형 표시 글자, 기사 배지는 목록 카드와 같은 함수
import { INFO_LIST_MARKER_LABELS } from "@ltr/ui";
import { isoToKstDate } from "@/lib/admin/form-utils";
import { LEGAL_DOC_TYPES, LEGAL_DOC_TYPE_LABELS, type LegalDocType } from "@/lib/admin/legal-doc-rules";
import { SEARCH_LIMITS, leftChars, queryTerms } from "./search-normalize";
import type { SearchClassification } from "./search-classify";
import { sponsorMark, type SponsorMark } from "./article-logic";
import { sponsorBadgeOf } from "./cards";
import {
  CONTENT_TYPE_NAMES,
  SECTION_INFO,
  amendmentHref,
  categoryHref,
  glossaryTermHref,
  isOpenPath,
  isSectionKey,
  newsHref,
  personHref,
  situationHref,
  type Features,
  type SectionKey,
} from "./constants";

/** 결과 종류 — 차례 = 같은 등급 안의 종류 순서 (설계 2.1, DB c_kinds와 같다). interpretation(해석 원문)은 W3 10단계 */
export const SEARCH_KINDS = ["region", "situation", "tracker", "glossary", "category", "article", "person", "interpretation"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

/** 기사 유형 거르개 (설계 2.1 — 금주 핫뉴스는 기사 결과에 없다) */
export const SEARCH_CONTENT_TYPES = ["reported_news", "explainer", "guide", "opinion", "sponsored"] as const;
export type SearchContentType = (typeof SEARCH_CONTENT_TYPES)[number];

/** 검색 화면 탭 (SRCH-02 · 설계 2.1) — 종류가 없는 탭(행사·전문가 — 01B·01C 전)은 DB를 부르지 않는다 */
export const SEARCH_TABS = ["all", "article", "tracker", "region", "event", "glossary", "expert"] as const;
export type SearchTab = (typeof SEARCH_TABS)[number];
export const TAB_KINDS: Readonly<Record<SearchTab, readonly SearchKind[]>> = {
  all: SEARCH_KINDS,
  article: ["article"],
  tracker: ["tracker"],
  region: ["region"],
  event: [],
  glossary: ["glossary"],
  expert: [],
};

/** 검색 화면 값 (설계 2.4) — 전체 탭은 종류마다 앞 allPerKind개, 결과 없음 화면의 추천 검색어 suggestions개 */
export const SEARCH_SCREEN = { allPerKind: 5, suggestions: 3 } as const;

/** 쪽 번호 최대 — 건너뛰기 최대 ÷ 한 쪽 + 1 */
export const SEARCH_MAX_PAGE = Math.floor(SEARCH_LIMITS.maxOffset / SEARCH_LIMITS.pageSize) + 1;

/** 결과 유형 표시 글자 (SRCH-01 '결과마다 유형 표시') — 기사는 유형 배지 글자, 행사(01B)는 정보 목록 표시 */
export const KIND_LABELS: Readonly<Record<SearchKind, string>> = {
  region: "지역",
  situation: "상황",
  tracker: "개정 트래커",
  glossary: "용어",
  category: "분야",
  article: "기사",
  person: "기자·필자",
  interpretation: "해석 원문",
};
/** 행사 결과(01B W6)의 표시 — 기사 유형 배지 글자를 쓰지 않는다 (원칙 ⑥) */
export const EVENT_LABEL = INFO_LIST_MARKER_LABELS.event;

// ── 정규화 (설계 4장) — 규칙은 search-normalize.ts 한 곳(상황 별칭·동의어 편집 화면도 같이 쓴다) ──
export { SEARCH_LIMITS, queryTerms, squash, type QueryTerms } from "./search-normalize";

// ── URL 쿼리 → 검색 옵션 (설계 8장) ────────────────────────────

export interface SearchOptions {
  /** 앞뒤 공백을 뗀 검색어 (앞 100글자) */
  q: string;
  tab: SearchTab;
  section: SectionKey | null;
  contentType: SearchContentType | null;
  /** 법정동코드 10자리 */
  region: string | null;
  /** 한국 날짜 YYYY-MM-DD — 그날 포함 */
  from: string | null;
  to: string | null;
  page: number;
}

type ParamSource = URLSearchParams | Readonly<Record<string, string | readonly string[] | undefined>>;

function param(src: ParamSource, key: string): string | null {
  if (src instanceof URLSearchParams) return src.get(key);
  const v = src[key];
  if (typeof v === "string") return v;
  return Array.isArray(v) && typeof v[0] === "string" ? v[0] : null;
}

function isoDate(v: string | null): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== v ? null : v;
}

/** 검색 화면 URL 쿼리(q·tab·section·type·region·from·to·page) → 옵션. 모르는 값은 닫힌 쪽(전체 탭·거르개 없음·1쪽) */
export function parseSearchParams(src: ParamSource): SearchOptions {
  const tab = param(src, "tab");
  const section = param(src, "section");
  const type = param(src, "type");
  const region = param(src, "region");
  let from = isoDate(param(src, "from"));
  let to = isoDate(param(src, "to"));
  if (from && to && to < from) from = to = null;
  const pageRaw = param(src, "page");
  const page = pageRaw && /^\d{1,5}$/.test(pageRaw) && Number(pageRaw) >= 1 ? Number(pageRaw) : 1;
  return {
    q: leftChars((param(src, "q") ?? "").trim(), SEARCH_LIMITS.queryChars).trim(),
    tab: (SEARCH_TABS as readonly string[]).includes(tab ?? "") ? (tab as SearchTab) : "all",
    section: isSectionKey(section) ? section : null,
    contentType: (SEARCH_CONTENT_TYPES as readonly string[]).includes(type ?? "") ? (type as SearchContentType) : null,
    region: region && /^\d{10}$/.test(region) ? region : null,
    from,
    to,
    page,
  };
}

/** 검색 화면이 쓰는 옵션 — 종류 없는 탭(행사·전문가)은 전체 탭으로(탭이 화면에 없다), 전체 탭은 종류별 묶음이라 쪽이 없다(1쪽) */
export function screenOptions(o: SearchOptions): SearchOptions {
  const tab = TAB_KINDS[o.tab].length > 0 ? o.tab : "all";
  return { ...o, tab, page: tab === "all" ? 1 : o.page };
}

/** search_public 인자 — 부를 것이 없으면(검색어 없음·종류 없는 탭·쪽 끝 넘음) null */
export function searchArgs(o: SearchOptions, mode: { perKind?: number; pageSize?: number } = {}): Record<string, unknown> | null {
  if (queryTerms(o.q).terms.length === 0) return null;
  const kinds = TAB_KINDS[o.tab];
  if (kinds.length === 0) return null;
  const pageSize = Math.min(Math.max(1, Math.floor(mode.pageSize ?? SEARCH_LIMITS.pageSize)), SEARCH_LIMITS.maxPageSize);
  const offset = (o.page - 1) * pageSize;
  if (mode.perKind === undefined && offset > SEARCH_LIMITS.maxOffset) return null;
  return {
    p_query: o.q,
    p_kinds: o.tab === "all" ? null : kinds,
    p_section: o.section,
    p_content_type: o.contentType,
    p_region: o.region,
    p_from: o.from,
    p_to: o.to,
    p_limit: pageSize,
    p_offset: mode.perKind === undefined ? offset : 0,
    p_per_kind: mode.perKind === undefined ? null : Math.min(Math.max(1, Math.floor(mode.perKind)), SEARCH_LIMITS.maxPerKind),
  };
}

/**
 * 탭 숫자만 읽는 인자 (2단계) — 고른 탭·쪽에 행이 없으면 kind_counts(탭 숫자)도 오지 않는다. 같은 거르개로 종류 거르개 없이 한 행만 읽는다.
 * 탭·쪽은 보지 않는다(탭 숫자는 탭과 상관없다 — 설계 7장 kind_counts). 남는 글자 없는 검색어면 null
 */
export function countArgs(o: SearchOptions): Record<string, unknown> | null {
  if (queryTerms(o.q).terms.length === 0) return null;
  return {
    p_query: o.q,
    p_kinds: null,
    p_section: o.section,
    p_content_type: o.contentType,
    p_region: o.region,
    p_from: o.from,
    p_to: o.to,
    p_limit: 1,
    p_offset: 0,
    p_per_kind: null,
  };
}

/** 탭 숫자가 빠졌나 — 행이 0인데 종류 탭이거나 2쪽 이후(다른 종류·앞 쪽에 결과가 있을 수 있다). 전체 탭 1쪽 0건은 정말 0건 */
export function countsMissing(rows: readonly unknown[], args: Record<string, unknown>): boolean {
  return rows.length === 0 && (args.p_kinds !== null || Number(args.p_offset) > 0);
}

// ── DB 행 → 결과 보기 값 ───────────────────────────────────────

/** search_public 한 행 (설계 7장) */
export interface SearchRow {
  kind: string;
  ref: string;
  slug: string | null;
  title: string | null;
  snippet: string | null;
  section: string | null;
  content_type: string | null;
  published_at: string | null;
  tier: number;
  meta: Record<string, unknown> | null;
  total_count: number | string;
  kind_counts: Record<string, number> | null;
  query_terms: string[] | null;
}

interface HitBase {
  ref: string;
  title: string;
  snippet: string | null;
  /** 열린 화면 주소 — 꺼진 기능·아직 없는 화면이면 null (링크 0) */
  href: string | null;
  /** 결과 유형 표시 글자 (SRCH-01) */
  typeLabel: string;
  /** 순위 등급 — 0 이름 같음 · 1 이름에 있음 · 2 본문에만 */
  tier: number;
}

export type SearchHit =
  | (HitBase & {
      kind: "article";
      section: SectionKey;
      sectionName: string;
      contentType: string | null;
      format: string | null;
      sponsor: SponsorMark;
      sponsorBadge: string | null;
      publishedOn: string | null;
      regionCodes: string[];
    })
  | (HitBase & { kind: "situation"; section: SectionKey; sectionName: string; pictogram: string | null })
  | (HitBase & { kind: "tracker"; stage: string | null; stageOn: string | null; sourceUrl: string | null })
  | (HitBase & { kind: "glossary"; reading: string | null; sections: SectionKey[] })
  | (HitBase & { kind: "region"; code: string; level: "sido" | "sigungu"; parentName: string | null })
  | (HitBase & { kind: "category"; section: SectionKey; sectionName: string })
  | (HitBase & { kind: "person"; roles: string[] })
  | (HitBase & {
      kind: "interpretation";
      section: "tax";
      sectionName: string;
      docType: LegalDocType;
      /** 유형 글자 — 예규·통칙·유권해석·심판·판례 */
      docTypeLabel: string;
      /** 결정·회신일 (한국 날짜) */
      decidedOn: string | null;
      /** 원문 주소 — 해설 화면이 닫혀 있을 때(기능 키 interpretations 꺼짐) 대신 보이는 원문 링크 */
      sourceUrl: string | null;
    });

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const httpUrl = (v: unknown): string | null => {
  const s = str(v);
  return s && /^https?:\/\//i.test(s) ? s : null;
};
const open = (href: string, features: Features) => (isOpenPath(href, features) ? href : null);

/** 지자체 허브 주소 (01B W4 — 기능 키 region_hubs) */
export const regionHref = (slug: string, parentSlug: string | null) =>
  parentSlug ? `${SECTION_INFO.local.href}/${encodeURIComponent(parentSlug)}/${encodeURIComponent(slug)}` : `${SECTION_INFO.local.href}/${encodeURIComponent(slug)}`;

/** 한 행 → 보기 값. 모르는 종류·필수 칸이 빈 행은 null (화면에 그리지 않는다) */
export function searchHitView(row: SearchRow, features: Features): SearchHit | null {
  const title = str(row.title);
  const slug = str(row.slug);
  if (!title || !slug || !(SEARCH_KINDS as readonly string[]).includes(row.kind)) return null;
  const meta = row.meta ?? {};
  const base = { ref: String(row.ref), title, snippet: str(row.snippet), tier: Number(row.tier) };
  const kind = row.kind as SearchKind;
  switch (kind) {
    case "article": {
      if (!isSectionKey(row.section)) return null;
      const label = typeof meta.label === "string" ? meta.label : "none";
      const partner = str(meta.partner_badge_name);
      const sponsor = sponsorMark(label, partner);
      const format = str(meta.format);
      // 공동 기획은 유형 배지 대신 '공동 기획 ○○' (W2-b #49), 유형 없는 이관 기사는 '기사'
      const typeLabel =
        sponsor?.kind === "co_planned" ? (sponsorBadgeOf(label, partner) ?? KIND_LABELS.article) : row.content_type ? (CONTENT_TYPE_NAMES[row.content_type] ?? KIND_LABELS.article) : KIND_LABELS.article;
      return {
        ...base,
        kind,
        href: open(newsHref(slug), features),
        typeLabel,
        section: row.section,
        sectionName: SECTION_INFO[row.section].name,
        contentType: row.content_type,
        format: format && format !== "general" ? format : null,
        sponsor,
        sponsorBadge: sponsorBadgeOf(label, partner),
        publishedOn: row.published_at ? isoToKstDate(row.published_at) || null : null,
        regionCodes: strs(meta.region_codes),
      };
    }
    case "situation":
      if (!isSectionKey(row.section)) return null;
      return {
        ...base,
        kind,
        href: open(situationHref(slug), features),
        typeLabel: KIND_LABELS.situation,
        section: row.section,
        sectionName: SECTION_INFO[row.section].name,
        pictogram: str(meta.pictogram),
      };
    case "tracker":
      return {
        ...base,
        kind,
        href: open(amendmentHref(slug), features),
        typeLabel: KIND_LABELS.tracker,
        stage: str(meta.stage),
        stageOn: str(meta.stage_on),
        sourceUrl: httpUrl(meta.source_url),
      };
    case "glossary":
      return {
        ...base,
        kind,
        href: open(glossaryTermHref(slug), features),
        typeLabel: KIND_LABELS.glossary,
        reading: str(meta.reading),
        sections: strs(meta.sections).filter(isSectionKey),
      };
    case "region": {
      const level = meta.level === "sido" || meta.level === "sigungu" ? meta.level : null;
      if (!level) return null;
      const parentSlug = level === "sigungu" ? str(meta.parent_slug) : null;
      if (level === "sigungu" && !parentSlug) return null;
      return {
        ...base,
        kind,
        href: open(regionHref(slug, parentSlug), features),
        typeLabel: KIND_LABELS.region,
        code: String(row.ref),
        level,
        parentName: str(meta.parent_name),
      };
    }
    case "category":
      if (!isSectionKey(row.section) || row.section === "local") return null;
      return { ...base, kind, href: open(categoryHref(row.section, slug), features), typeLabel: KIND_LABELS.category, section: row.section, sectionName: SECTION_INFO[row.section].name };
    case "person":
      return { ...base, kind, href: open(personHref(slug), features), typeLabel: KIND_LABELS.person, roles: strs(meta.roles) };
    case "interpretation": {
      // 해석 원문 (W3 10단계) — 주소는 그 원문을 다루는 가장 최근 발행 해설 기사. 해설 화면(원문 블록)은 기능 키 interpretations가 켜져야 열리므로
      // 꺼져 있으면 링크 0, 대신 원문 링크(권리 확인된 공개 원문의 출처 — 트래커의 현재 단계 원문 링크와 같다)
      const docType = (LEGAL_DOC_TYPES as readonly string[]).includes(String(meta.doc_type)) ? (meta.doc_type as LegalDocType) : null;
      if (!docType) return null;
      return {
        ...base,
        kind,
        href: features.interpretations ? open(newsHref(slug), features) : null,
        typeLabel: KIND_LABELS.interpretation,
        section: "tax",
        sectionName: SECTION_INFO.tax.name,
        docType,
        docTypeLabel: LEGAL_DOC_TYPE_LABELS[docType],
        decidedOn: str(meta.decided_on),
        sourceUrl: httpUrl(meta.source_url),
      };
    }
  }
  return null;
}

export interface SearchResult {
  /** 화면에 되보이는 검색어 */
  query: string;
  /** 검색에 쓴 낱말 (DB가 다시 찾았으면 띄어 쓴 낱말) */
  terms: string[];
  /** 고른 탭(종류) 안의 전체 결과 수 */
  total: number;
  /** 종류별 결과 수 — 탭과 상관없이 (탭 숫자) */
  counts: Readonly<Record<SearchKind, number>>;
  items: SearchHit[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  /**
   * 지역 + 주제 분류 (W4 10단계 — search-classify.ts, DB search_classify와 같은 규칙). 검색 서버 함수가 공개 행정구역·주제 사전으로 붙인다 —
   * DB를 부르지 않은 결과·분류 자료를 읽지 못한 결과에는 없다
   */
  classification?: SearchClassification;
}

/** 지역 결과를 뺀 결과 수 (탭과 상관없이) — 지역으로 분류됐는데 이것이 0이면 결과 0건 제안(상위 지역·다른 표기·상황 카드 — REG1-11) */
export const nonRegionCount = (counts: Readonly<Record<SearchKind, number>>): number => SEARCH_KINDS.reduce((n, k) => (k === "region" ? n : n + (counts[k] ?? 0)), 0);

/** 지역으로 분류됐고(후보 1개 이상) 지역 밖 결과가 0건인가 */
export const regionOnlyResult = (result: Pick<SearchResult, "counts" | "classification">): boolean =>
  (result.classification?.regions.length ?? 0) > 0 && nonRegionCount(result.counts) === 0;

/**
 * 지역 분류 여부 (W4 10단계 — search_submitted.region_classified · API regionClassified) — 검색어에 지역 이름·별칭이 있어 지역 후보가 1개 이상인가
 * (동명처럼 하나로 정하지 않은 것도 참 — 12장 #74). 분류를 붙이지 못한 결과(분류 자료를 읽지 못함)는 W2-d 대리값(지역 결과가 있는가)
 */
export const regionClassified = (result: Pick<SearchResult, "counts" | "classification">): boolean =>
  result.classification ? result.classification.regions.length > 0 : (result.counts.region ?? 0) > 0;

export const zeroCounts = (): Record<SearchKind, number> => Object.fromEntries(SEARCH_KINDS.map((k) => [k, 0])) as Record<SearchKind, number>;

/** 첫 행의 종류별 수 (탭 숫자) — 모르는 값·음수는 0 */
function countsOf(first: SearchRow | undefined): Record<SearchKind, number> {
  const counts = zeroCounts();
  for (const k of SEARCH_KINDS) {
    const n = Number(first?.kind_counts?.[k] ?? 0);
    counts[k] = Number.isFinite(n) && n > 0 ? n : 0;
  }
  return counts;
}

/** 탭 숫자 다시 읽기(countArgs)의 행으로 탭 숫자와 쓴 낱말만 채운다 — 결과 목록·쪽은 그대로. 읽은 행이 없으면 그대로 */
export function withCounts(result: SearchResult, countRows: readonly SearchRow[]): SearchResult {
  const first = countRows[0];
  if (!first) return result;
  return { ...result, counts: countsOf(first), terms: first.query_terms ?? result.terms };
}

export function emptySearchResult(o: Pick<SearchOptions, "q" | "page">, pageSize: number = SEARCH_LIMITS.pageSize): SearchResult {
  return { query: o.q, terms: queryTerms(o.q).terms, total: 0, counts: zeroCounts(), items: [], page: o.page, pageSize, hasMore: false };
}

/** DB 행 → 결과 (쪽 정보는 부른 인자에서) */
export function toSearchResult(rows: readonly SearchRow[], features: Features, o: Pick<SearchOptions, "q" | "page">, args: Record<string, unknown>): SearchResult {
  const pageSize = Number(args.p_limit);
  const first = rows[0];
  const counts = countsOf(first);
  const total = first ? Number(first.total_count) : 0;
  const perKind = args.p_per_kind !== null && args.p_per_kind !== undefined;
  return {
    query: o.q,
    terms: first?.query_terms ?? queryTerms(o.q).terms,
    total,
    counts,
    items: rows.flatMap((r) => searchHitView(r, features) ?? []),
    page: o.page,
    pageSize,
    // 다음 쪽이 건너뛰기 한도 안일 때만 (설계 2.3)
    hasMore: !perKind && Number(args.p_offset) + rows.length < total && Number(args.p_offset) + pageSize <= SEARCH_LIMITS.maxOffset,
  };
}
