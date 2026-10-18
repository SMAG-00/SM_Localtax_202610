// 통합 검색 — 순수 규칙 (docs/dev/W2-d_설계.md 2·4·8장). 시험 search-logic.test.ts가 설계 문서 2장 표(값·정규화 견본·한도)를 읽어 대조한다.
//  · 정규화(squash·queryTerms)는 DB 함수 search_public과 같은 규칙이다 — 검색은 DB가 정규화하고, 여기 규칙은 빈 검색어 판정·
//    4단계 검색어 집계의 정규형에 쓴다(같은 견본 표를 DB 시험도 지난다)
//  · DB 행 → 결과 보기 값: 주소는 열린 화면만(isOpenPath — 꺼진 기능·아직 없는 화면이면 null), 유형 표시 글자, 기사 배지는 목록 카드와 같은 함수
import { INFO_LIST_MARKER_LABELS } from "@ltr/ui";
import { isoToKstDate } from "@/lib/admin/form-utils";
import { sponsorMark, type SponsorMark } from "./article-logic";
import { sponsorBadgeOf } from "./cards";
import {
  CONTENT_TYPE_NAMES,
  SECTION_INFO,
  amendmentHref,
  categoryHref,
  isOpenPath,
  isSectionKey,
  newsHref,
  personHref,
  situationHref,
  type Features,
  type SectionKey,
} from "./constants";

/** 결과 종류 — 차례 = 같은 등급 안의 종류 순서 (설계 2.1, DB c_kinds와 같다) */
export const SEARCH_KINDS = ["region", "situation", "tracker", "glossary", "category", "article", "person"] as const;
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

/** 한도 (설계 2.3 — DB 함수 상수와 같다) */
export const SEARCH_LIMITS = { queryChars: 100, maxTerms: 8, pageSize: 20, maxPageSize: 50, maxOffset: 1000, maxPerKind: 10 } as const;
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
};
/** 행사 결과(01B W6)의 표시 — 기사 유형 배지 글자를 쓰지 않는다 (원칙 ⑥) */
export const EVENT_LABEL = INFO_LIST_MARKER_LABELS.event;

// ── 정규화 (설계 4장) ─────────────────────────────────────────

/** 남기는 글자 밖 — 숫자·영문 소문자·한글 음절·한글 자모(NFKC가 호환 자모 ㄱ을 첫소리 글자 ᄀ로 바꾼다 — 둘 다)·한자만 남긴다 (DB public.search_squash와 같은 범위) */
const DROP = /[^0-9a-z가-힣ᄀ-ᇿㄱ-ㆎ一-鿿]+/gu;
const ONE_SYLLABLE = /^[가-힣]$/u;

/** 한 칸의 정규형 — NFKC → 소문자 → 남기는 글자만 */
export function squash(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(DROP, "");
}

/** 앞에서 n글자(코드 포인트) — DB left(text, n)과 같다 */
function leftChars(text: string, n: number): string {
  return Array.from(text).slice(0, n).join("");
}

const firstUnique = (xs: readonly string[], max: number) => [...new Set(xs)].slice(0, max);

export interface QueryTerms {
  /** 찾는 낱말 — 한 글자 한글 낱말을 옆 낱말에 붙인 것 */
  terms: string[];
  /** 찾는 낱말로 0건일 때 다시 찾는 낱말(띄어 쓴 그대로) — 찾는 낱말과 같으면 null */
  split: string[] | null;
}

/** 검색어 → 찾는 낱말 (설계 4장 3 — DB search_public과 같은 규칙, 2.2 견본 표) */
export function queryTerms(raw: string | null | undefined): QueryTerms {
  const parts = leftChars(raw ?? "", SEARCH_LIMITS.queryChars)
    .normalize("NFKC")
    .toLowerCase()
    .replace(DROP, " ")
    .split(" ")
    .filter((x) => x !== "");
  const work = [...parts];
  const glued: string[] = [];
  for (let i = 0; i < work.length; i++) {
    const cur = work[i]!;
    if (work.length > 1 && ONE_SYLLABLE.test(cur)) {
      const prev = glued.at(-1);
      // 앞 낱말이 숫자로 끝나면 앞에("2026 년"), 아니면 뒤 낱말이 한글·숫자로 시작하면 뒤에("재 건축"), 아니면 앞 낱말이 한글로 끝날 때 앞에("취득 세")
      if (prev !== undefined && /[0-9]$/u.test(prev)) {
        glued[glued.length - 1] = prev + cur;
        continue;
      }
      if (i + 1 < work.length && /^[가-힣0-9]/u.test(work[i + 1]!)) {
        work[i + 1] = cur + work[i + 1]!;
        continue;
      }
      if (prev !== undefined && /[가-힣]$/u.test(prev)) {
        glued[glued.length - 1] = prev + cur;
        continue;
      }
    }
    glued.push(cur);
  }
  const terms = firstUnique(glued, SEARCH_LIMITS.maxTerms);
  const split = firstUnique(parts, SEARCH_LIMITS.maxTerms);
  const same = split.length === terms.length && split.every((x, i) => x === terms[i]);
  return { terms, split: same ? null : split };
}

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
  | (HitBase & { kind: "person"; roles: string[] });

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
/** 용어사전의 용어 자리 (3단계 화면) */
export const glossaryHref = (id: string) => `/glossary#term-${encodeURIComponent(id)}`;

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
        href: open(glossaryHref(slug), features),
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
}

export const zeroCounts = (): Record<SearchKind, number> => Object.fromEntries(SEARCH_KINDS.map((k) => [k, 0])) as Record<SearchKind, number>;

export function emptySearchResult(o: Pick<SearchOptions, "q" | "page">, pageSize: number = SEARCH_LIMITS.pageSize): SearchResult {
  return { query: o.q, terms: queryTerms(o.q).terms, total: 0, counts: zeroCounts(), items: [], page: o.page, pageSize, hasMore: false };
}

/** DB 행 → 결과 (쪽 정보는 부른 인자에서) */
export function toSearchResult(rows: readonly SearchRow[], features: Features, o: Pick<SearchOptions, "q" | "page">, args: Record<string, unknown>): SearchResult {
  const pageSize = Number(args.p_limit);
  const first = rows[0];
  const counts = zeroCounts();
  for (const k of SEARCH_KINDS) {
    const n = Number(first?.kind_counts?.[k] ?? 0);
    counts[k] = Number.isFinite(n) && n > 0 ? n : 0;
  }
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
