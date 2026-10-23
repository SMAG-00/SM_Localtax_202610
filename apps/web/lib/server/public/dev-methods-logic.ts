// 개발방법 비교 공개 화면 (W4 19단계 — PRD-01B PR-09 · PR-10 · PR-11, docs/dev/W4_설계.md 1장 19단계 · 2.1 · 5장 · 12장 163번~) — 순수 모듈
// (시험 dev-methods-logic.test.ts). 공개 뷰 public_dev_methods · public_dev_method_compare · public_dev_method_facts(마이그레이션 …52 — 기능 키 dev_methods 켜짐 +
// 방법 서명 + 비교 항목 6칸 서명 + 서명자가 지금도 감수위원)의 줄을 화면 값으로 바꾼다. 이 모듈은 내용을 만들지 않는다 — 글·숫자는 전부 줄에서 온다.
//  · 비교표 7 × 6 — 방법 순서는 2.1 slug 고정 편집 순서(DB가 준 순서·정렬 요청과 무관), 비교 항목은 2.1 6칸 순서. 점수·순위·추천·정렬 값 0
//  · 비교 항목 6칸 중 하나라도 빈 방법은 열째 빠진다('확인 중' 채움 0). 숫자 요건 값은 기준일·감수자가 있는 사실 행만(공개 뷰가 이미 거르고, 여기서 한 번 더 본다)
//  · 신속통합기획은 사업 유형이 아니라 계획 지원 절차 — 칩은 @ltr/ui 비교표가 붙인다(관련 프로젝트 = 사업 유형 6개에만, 이 방법은 0)
//  · 방법 상세 = 절차 단계 목록 · 「지방세로 읽기」(서명본 — 16단계와 같은 박스 규칙) · 관련 프로젝트 · 관련 기사(없으면 줄째 0)
import type { BreadcrumbView } from "@ltr/structured-data";
import type { DevMethodEntry, DevMethodFact, DevMethodId } from "@ltr/ui";
import { isoToKstDate } from "@/lib/admin/form-utils";
import { DEV_METHOD_ITEMS, DEV_METHOD_ITEM_LABELS, DEV_METHOD_SLUGS, type DevMethodItem, type DevMethodSlug } from "@/lib/admin/dev-method-rules";
import { SECTION_INFO, type Features } from "./constants";
import { stageLensView, type PublicStageLensRow, type StageLensView } from "./project-logic";

/** 목록 주소 (12장 #11 — 기존 하위 분야 주소 재사용) · 한 방법 */
export const DEV_METHODS_HREF = "/realestate/development-methods";
export const devMethodHref = (slug: string) => `${DEV_METHODS_HREF}/${slug}`;
export const DEV_METHODS_TITLE = "개발방법 비교";
/** 방법 주소 모양 — 2.1 slug와 같다 */
export const isMethodSlug = (v: string): v is DevMethodSlug => (DEV_METHOD_SLUGS as readonly string[]).includes(v);

/** 화면 한도 — 방법 상세의 관련 프로젝트·기사 (12장 #165) */
export const DEV_METHOD_PUBLIC_LIMITS = { projects: 4, articles: 5 } as const;

export const PUBLIC_METHOD_COLUMNS = "slug, name, kind, sort, legal_basis_name, summary, steps, lens, reviewed_at, reviewer_name";
export const PUBLIC_COMPARE_COLUMNS = "slug, sort, item, item_position, body, reviewed_at, reviewer_name, special_law_basis";
export const PUBLIC_FACT_COLUMNS = "slug, sort, fact_key, label, value, unit, law_ref, reference_date, source_url, version, reviewed_at, reviewer_name, under_review, special_law_basis";

export interface PublicMethodRow {
  slug: string;
  name: string | null;
  kind: string | null;
  sort: number | null;
  legal_basis_name: string | null;
  summary: string | null;
  steps: unknown;
  lens: unknown;
  reviewed_at: string | null;
  reviewer_name: string | null;
}
export interface PublicCompareRow {
  slug: string;
  sort: number | null;
  item: string;
  item_position: number | null;
  body: string | null;
  reviewed_at: string | null;
  reviewer_name: string | null;
  /** 특례법 근거 표시 + 공포 확인 + 이 행 확인이 모두 맞을 때만 true (마이그레이션 …53) */
  special_law_basis?: boolean | null;
}
export interface PublicFactRow {
  slug: string;
  sort: number | null;
  fact_key: string;
  label: string | null;
  value: string | null;
  unit: string | null;
  law_ref: string | null;
  reference_date: string | null;
  source_url: string | null;
  version: number | null;
  reviewed_at: string | null;
  reviewer_name: string | null;
  special_law_basis?: boolean | null;
  under_review: boolean | null;
}

/** 2.1 slug → @ltr/ui 비교표가 쓰는 방법 열쇠 (이름이 다른 둘) */
export const UI_METHOD_ID: Record<DevMethodSlug, DevMethodId> = {
  redevelopment: "redevelopment",
  reconstruction: "reconstruction",
  "small-scale": "small_scale",
  public: "public",
  trust: "trust",
  renewal: "renewal",
  "rapid-planning": "speed_integrated",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const strings = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === "string" && x.trim() !== "") ? (v as string[]).map((x) => x.trim()) : null);

export interface PublicFact {
  key: string;
  label: string;
  value: string;
  unit: string;
  lawRef: string;
  basisDate: string;
  reviewer: string;
  sourceUrl: string;
  underReview: boolean;
}

export interface PublicMethod {
  slug: DevMethodSlug;
  id: DevMethodId;
  name: string;
  kind: "project_type" | "planning_support";
  href: string;
  legalBasisName: string | null;
  summary: string;
  steps: string[];
  /** 비교 항목 6칸 — 2.1 순서 */
  compare: { item: DevMethodItem; label: string; body: string }[];
  facts: PublicFact[];
  reviewer: string;
  /** 서명일 (한국 날짜) */
  reviewedOn: string;
  lens: PublicStageLensRow | null;
}

const fixedOrder = (slug: string) => (DEV_METHOD_SLUGS as readonly string[]).indexOf(slug);

/** 공개 뷰 줄 → 방법들 (고정 편집 순서). 비교 항목 6칸·서명자 이름·서명일·한 줄 설명·절차 단계 중 하나라도 비면 그 방법은 빠진다 */
export function publicMethods(methods: readonly PublicMethodRow[], compare: readonly PublicCompareRow[], facts: readonly PublicFactRow[]): PublicMethod[] {
  const out: PublicMethod[] = [];
  for (const m of methods) {
    if (!isMethodSlug(m.slug)) continue;
    if (out.some((o) => o.slug === m.slug)) continue;
    const name = text(m.name);
    const summary = text(m.summary);
    const steps = strings(m.steps);
    const reviewer = text(m.reviewer_name);
    const reviewedOn = m.reviewed_at ? isoToKstDate(m.reviewed_at) : "";
    const kind = m.kind === "planning_support" || m.kind === "project_type" ? m.kind : null;
    if (!name || !summary || !steps || steps.length === 0 || !reviewer || !ISO_DATE.test(reviewedOn) || !kind) continue;
    const items = DEV_METHOD_ITEMS.map((item) => {
      const row = compare.find((c) => c.slug === m.slug && c.item === item);
      const body = text(row?.body);
      return body ? { item, label: DEV_METHOD_ITEM_LABELS[item], body } : null;
    });
    if (items.some((i) => i === null)) continue;
    const factList = facts
      .filter((f) => f.slug === m.slug)
      .flatMap((f): PublicFact[] => {
        const label = text(f.label);
        const value = text(f.value);
        const lawRef = text(f.law_ref);
        const basisDate = text(f.reference_date);
        const by = text(f.reviewer_name);
        const url = text(f.source_url);
        if (!label || !value || !lawRef || !basisDate || !ISO_DATE.test(basisDate) || !by || !url) return [];
        return [{ key: f.fact_key, label, value, unit: text(f.unit) ?? "", lawRef, basisDate, reviewer: by, sourceUrl: url, underReview: f.under_review === true }];
      })
      .sort((a, b) => a.key.localeCompare(b.key));
    const lens = m.lens && typeof m.lens === "object" && !Array.isArray(m.lens) ? (m.lens as Record<string, unknown>) : null;
    out.push({
      slug: m.slug,
      id: UI_METHOD_ID[m.slug],
      name,
      kind,
      href: devMethodHref(m.slug),
      legalBasisName: text(m.legal_basis_name),
      summary,
      steps,
      compare: items as PublicMethod["compare"],
      facts: factList.filter((f, i, all) => all.findIndex((x) => x.key === f.key) === i),
      reviewer,
      reviewedOn,
      lens: lens ? { project_type: "", stage: "", stage_position: null, topics: lens.topics, points: lens.points, links: lens.links, base_date: text(lens.base_date), reviewed_at: m.reviewed_at, reviewer_name: reviewer } : null,
    });
  }
  return out.sort((a, b) => fixedOrder(a.slug) - fixedOrder(b.slug));
}

/** 비교표 입력 — @ltr/ui 비교표가 7개 고정 순서로 그린다. 숫자 요건 값은 원문 검토 중이면 이름 옆에 그 사실을 적는다 */
export function comparisonMethods(methods: readonly PublicMethod[]): Partial<Record<DevMethodId, DevMethodEntry>> {
  const body = (m: PublicMethod, item: DevMethodItem) => m.compare.find((c) => c.item === item)!.body;
  return Object.fromEntries(
    methods.map((m) => {
      const facts: DevMethodFact[] = m.facts.map((f) => ({ label: f.underReview ? `${f.label} (원문 검토 중)` : f.label, value: f.value, unit: f.unit, article: f.lawRef, basisDate: f.basisDate, reviewer: f.reviewer }));
      const entry: DevMethodEntry = {
        law: body(m, "legal_basis"),
        operator: body(m, "actor"),
        target: body(m, "target"),
        procedure: body(m, "procedure"),
        factsNote: body(m, "numeric_requirements"),
        facts,
        taxIssue: body(m, "tax_issues"),
        href: m.href,
      };
      return [m.id, entry];
    }),
  ) as Partial<Record<DevMethodId, DevMethodEntry>>;
}

/** 감수 줄 — 서명한 감수위원 이름(겹침 0)·가장 이른 서명일 */
export function reviewLine(methods: readonly PublicMethod[]): { reviewers: string[]; reviewedOn: string } | null {
  if (methods.length === 0) return null;
  return { reviewers: [...new Set(methods.map((m) => m.reviewer))], reviewedOn: methods.map((m) => m.reviewedOn).reduce((a, b) => (b < a ? b : a)) };
}

/** 「지방세로 읽기」 박스 — 16단계와 같은 규칙(세액 표현·열린 링크·서명자·기준일). 규칙에 걸리면 null(박스 0) */
export function methodLens(m: PublicMethod, features: Features): StageLensView | null {
  return m.lens ? stageLensView(m.lens, features) : null;
}

/** 사업 유형 방법 → 프로젝트 사업 유형 키 후보 (project_type 키는 밑줄만 쓴다 — 방법 slug는 줄표) */
export function projectTypeKeys(m: Pick<PublicMethod, "slug" | "kind">): string[] {
  return m.kind === "planning_support" ? [] : [...new Set([m.slug, m.slug.replace(/-/g, "_")])];
}

// ── 이동 줄 · 구조화 데이터 ──

export interface DevMethodCrumb {
  name: string;
  href: string;
}
export function devMethodCrumbs(method?: { name: string; href: string }): DevMethodCrumb[] {
  return [
    { name: "홈", href: "/" },
    { name: SECTION_INFO.realestate.name, href: SECTION_INFO.realestate.href },
    { name: DEV_METHODS_TITLE, href: DEV_METHODS_HREF },
    ...(method ? [{ name: method.name, href: method.href }] : []),
  ];
}
export function devMethodBreadcrumb(crumbs: readonly DevMethodCrumb[], siteUrl: string | undefined): BreadcrumbView | null {
  if (!siteUrl) return null;
  return { items: crumbs.map((c) => ({ name: c.name, url: `${siteUrl}${c.href}` })) };
}

/** 특례법 근거 표시 — 표시 + 공포 확인 + 그 행 확인이 모두 맞는 행만. 없으면 null(화면에 특례법 요소 0) */
export interface SpecialLawView {
  promulgationUrl: string;
  promulgatedOn: string;
  items: { slug: string; method: string; label: string }[];
}

export function specialLawView(law: { promulgation_url: string | null; promulgated_on: string | null }[], methods: PublicMethod[], compare: PublicCompareRow[], facts: PublicFactRow[], only?: string): SpecialLawView | null {
  const l = law[0];
  if (!l?.promulgation_url || !l.promulgated_on) return null;
  const names = new Map<string, string>(methods.map((m) => [m.slug, m.name]));
  const items = [
    ...compare.flatMap((c) => (c.special_law_basis === true && names.has(c.slug) ? [{ slug: c.slug, method: names.get(c.slug) as string, label: DEV_METHOD_ITEM_LABELS[c.item as DevMethodItem] ?? c.item }] : [])),
    ...facts.flatMap((f) => (f.special_law_basis === true && names.has(f.slug) && f.label ? [{ slug: f.slug, method: names.get(f.slug) as string, label: f.label }] : [])),
  ].filter((i) => only === undefined || i.slug === only);
  return items.length === 0 ? null : { promulgationUrl: l.promulgation_url, promulgatedOn: l.promulgated_on, items };
}
