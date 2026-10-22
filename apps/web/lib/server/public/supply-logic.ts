// 분양 정보 공개 화면 (W4 17단계 — PRD-01B PR-04 · PR-01 · PR-05 · REG1-10, docs/dev/W4_설계.md 1장 17단계 · 2.3 · 5장 · 12장 #11 · #140~) — 순수 모듈
// (시험 supply-logic.test.ts). 공개 뷰 public_supply_notices(…51 — 기능 키 supply_notices 켜짐 + 공개 + 확인일 + 공급 규모)의 줄을 화면 값으로 바꾼다.
//  · 예정 목록(/realestate/supply·지역 허브 ③)은 청약 마감일이 오늘(KST) 이후인 항목만 — 마감일 23:59(KST)까지 있고 다음 날 00:00(KST)부터 빠진다(2.3).
//    프로젝트 화면은 지난 항목도 '청약 마감' 기록으로 남긴다(PR-04)
//  · 카드 = 사업명·지역(행정구역 이름·표준코드)·청약 단계(청약 예정·청약 접수 중·청약 마감)·공급 규모·청약 일정·출처(공고 기관)·기준일(모집공고일)·확인일·[공식 공고 ↗].
//    하나라도 비거나 공식 공고 주소가 http(s)가 아니면 카드 0(빈 칸 카드 0 — PR-01)
//  · 가격·분양가·분담금·수익률·시세 값은 공개 뷰에 칸이 없어 화면 어디에도 없다(PR-05) — 사업명·공급 규모에 금액·가격 표현이 든 줄도 카드 0(DB 저장 검사와 같은 식)
//  · 기사가 아니다 — 기사 유형 배지·NewsArticle 0, '정보 목록' 표시(5장). 목록 거르개 ?region=(법정동코드 10자리 — 시·도는 그 아래 시·군·구 포함)
import type { BreadcrumbView } from "@ltr/structured-data";
import { isoToKstDate } from "@/lib/admin/form-utils";
import { licenseBadge } from "@/lib/admin/official-source-rules";
import { supplyTextHasPrice } from "@/lib/admin/supply-rules";
import { sidoCodeOf } from "@/lib/site/region-route";
import { SECTION_INFO, isOpenPath, type Features } from "./constants";
import { projectHref, projectRegion, type FilterChip, type ProjectRegionView } from "./project-logic";
import type { RegionRow } from "./rows";

/** 분양 정보 목록 주소 (12장 #11 — 기존 하위 분야 주소 재사용) */
export const SUPPLY_HREF = "/realestate/supply";
/** 화면 이름 (목록 제목·이동 줄) */
export const SUPPLY_TITLE = "분양 정보";
/** 화면 한도 (12장 #144) */
export const SUPPLY_LIMITS = { list: 200, hubCards: 4, project: 20 } as const;

export const PUBLIC_SUPPLY_COLUMNS =
  "id, name, region_code, supply_scale, apply_start, apply_end, notice_date, notice_issuer, official_notice_url, verified_at, license_type, project_id, project_slug, project_name";

export interface PublicSupplyRow {
  id: number | string;
  name: string | null;
  region_code: string | null;
  supply_scale: string | null;
  apply_start: string | null;
  apply_end: string | null;
  notice_date: string | null;
  notice_issuer: string | null;
  official_notice_url: string | null;
  verified_at: string | null;
  license_type: string | null;
  project_id: number | string | null;
  project_slug: string | null;
  project_name: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HTTP = /^https?:\/\/\S+$/i;
const CODE_RE = /^\d{10}$/;
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** 그 시각의 한국 날짜 (YYYY-MM-DD) */
export const kstDateOf = (now: Date): string => isoToKstDate(now.toISOString());

/** 예정 목록에 있는가 — 청약 마감일(KST 날짜)이 오늘(KST) 이후. 마감일 23:59:59 = 있음, 다음 날 00:00 = 없음 (2.3) */
export function isUpcoming(applyEnd: string, now: Date): boolean {
  return ISO_DATE.test(applyEnd) && applyEnd >= kstDateOf(now);
}

export type SupplyPhase = "upcoming" | "open" | "closed";
export const SUPPLY_PHASE_LABELS: Readonly<Record<SupplyPhase, string>> = { upcoming: "청약 예정", open: "청약 접수 중", closed: "청약 마감" };

/** 청약 단계 — 시작 전 = 예정, 시작일~마감일 = 접수 중, 마감일 다음 날부터 = 마감 (한국 날짜) */
export function supplyPhase(applyStart: string, applyEnd: string, today: string): SupplyPhase {
  if (today < applyStart) return "upcoming";
  if (today <= applyEnd) return "open";
  return "closed";
}

export interface SupplyCard {
  id: number;
  name: string;
  region: ProjectRegionView;
  phase: { key: SupplyPhase; label: string };
  supplyScale: string;
  applyStart: string;
  applyEnd: string;
  /** 기준일 = 모집공고일 */
  noticeDate: string;
  /** 출처 = 공고 기관 */
  issuer: string;
  noticeUrl: string;
  /** 확인일 (한국 날짜) */
  verifiedOn: string;
  /** 공공누리 유형 글자 (모르는 값이면 null) */
  license: string | null;
  /** 연결 프로젝트 — 공개 프로젝트이고 그 화면이 열렸을 때만 */
  project: { name: string; href: string } | null;
}

/** 공개 뷰 줄 → 카드. 칸이 하나라도 비거나 모양이 틀리면 null (빈 칸 카드 0) */
export function supplyCard(row: PublicSupplyRow, regions: readonly RegionRow[], today: string, features: Features): SupplyCard | null {
  const name = text(row.name);
  const scale = text(row.supply_scale);
  const issuer = text(row.notice_issuer);
  const url = text(row.official_notice_url);
  const code = text(row.region_code);
  const start = text(row.apply_start);
  const end = text(row.apply_end);
  const noticeDate = text(row.notice_date);
  const verified = text(row.verified_at);
  if (!name || !scale || !issuer || !url || !HTTP.test(url) || !code || !CODE_RE.test(code) || !verified) return null;
  if (!start || !end || !noticeDate || ![start, end, noticeDate].every((d) => ISO_DATE.test(d)) || end < start) return null;
  if (supplyTextHasPrice(name) || supplyTextHasPrice(scale) || supplyTextHasPrice(issuer)) return null;
  const region = projectRegion(code, regions, today, features.region_hubs);
  if (!region) return null;
  const phase = supplyPhase(start, end, today);
  const slug = text(row.project_slug);
  const pName = text(row.project_name);
  const pHref = slug ? projectHref(slug) : null;
  const project = pHref && pName && features.realestate_projects && isOpenPath(pHref, features) ? { name: pName, href: pHref } : null;
  return {
    id: Number(row.id),
    name,
    region,
    phase: { key: phase, label: SUPPLY_PHASE_LABELS[phase] },
    supplyScale: scale,
    applyStart: start,
    applyEnd: end,
    noticeDate,
    issuer,
    noticeUrl: url,
    verifiedOn: isoToKstDate(verified),
    license: licenseBadge(row.license_type),
    project,
  };
}

/** 예정 목록 차례 — 마감일 이른 순 → 시작일 → 번호 */
export function sortUpcoming(cards: readonly SupplyCard[]): SupplyCard[] {
  return [...cards].sort((a, b) => a.applyEnd.localeCompare(b.applyEnd) || a.applyStart.localeCompare(b.applyStart) || a.id - b.id);
}

/** 프로젝트 화면 차례 — 예정·접수 중(마감 이른 순) 먼저, 그다음 마감 기록(마감 늦은 순 — 최근 것 위) */
export function sortProjectSupply(cards: readonly SupplyCard[]): SupplyCard[] {
  const live = sortUpcoming(cards.filter((c) => c.phase.key !== "closed"));
  const closed = [...cards.filter((c) => c.phase.key === "closed")].sort((a, b) => b.applyEnd.localeCompare(a.applyEnd) || b.id - a.id);
  return [...live, ...closed];
}

/** 공개 뷰 줄 → 예정 목록 카드 (마감일 지난 줄 0) */
export function upcomingCards(rows: readonly PublicSupplyRow[], regions: readonly RegionRow[], now: Date, features: Features): SupplyCard[] {
  const today = kstDateOf(now);
  return sortUpcoming(rows.flatMap((r) => (r.apply_end && isUpcoming(r.apply_end, now) ? (supplyCard(r, regions, today, features) ?? []) : [])));
}

// ── 목록 거르개 ──

export interface SupplyFilter {
  region: string | null;
}
type Params = Record<string, string | string[] | undefined>;
const single = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export function parseSupplyFilter(params: Params): SupplyFilter {
  const region = single(params.region);
  return { region: region && CODE_RE.test(region) ? region : null };
}
/** 지역 거르개 — 같은 코드, 시·도 코드면 그 아래 시·군·구 (프로젝트 목록과 같은 규칙) */
const inRegion = (code: string, filter: string) => code === filter || (filter.endsWith("00000000") && sidoCodeOf(code) === filter);
export function filterSupply(cards: readonly SupplyCard[], f: SupplyFilter): SupplyCard[] {
  return cards.filter((c) => !f.region || inRegion(c.region.code, f.region));
}
export function supplyListHref(f: SupplyFilter): string {
  return f.region ? `${SUPPLY_HREF}?region=${f.region}` : SUPPLY_HREF;
}
/** 지역 칩 — 예정 카드가 있는 시·도만, '전체' 앞 */
export function supplyRegionChips(cards: readonly SupplyCard[], f: SupplyFilter, regions: readonly RegionRow[]): FilterChip[] {
  const count = new Map<string, number>();
  for (const c of cards) count.set(sidoCodeOf(c.region.code), (count.get(sidoCodeOf(c.region.code)) ?? 0) + 1);
  const chips: FilterChip[] = [...count.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([code, n]) => {
      const name = regions.find((r) => r.code === code)?.name;
      return name ? [{ value: code, label: name, count: n, href: supplyListHref({ region: code }), current: f.region === code }] : [];
    });
  return chips.length ? [{ value: null, label: "전체", count: 0, href: SUPPLY_HREF, current: f.region === null }, ...chips] : [];
}

/** 지역 허브 ③ 카드 — 그 지역 범위(#26)의 예정 카드 최대 4장 + 더 있으면 목록(지역 거르개) 주소 */
export function hubSupplyCards(cards: readonly SupplyCard[], regionCode: string): { cards: SupplyCard[]; more: string | null } {
  const shown = cards.slice(0, SUPPLY_LIMITS.hubCards);
  return { cards: shown, more: cards.length > shown.length ? supplyListHref({ region: regionCode }) : null };
}

// ── 이동 줄·출처 줄 ──

export interface SupplyCrumb {
  name: string;
  href: string;
}
/** 이동 줄 — 홈 > 부동산 > 분양 정보. 구조화 데이터 BreadcrumbList가 같은 값을 쓴다(주 유형 0 — NewsArticle·Offer·Event 0) */
export function supplyCrumbs(): SupplyCrumb[] {
  return [
    { name: "홈", href: "/" },
    { name: SECTION_INFO.realestate.name, href: SECTION_INFO.realestate.href },
    { name: SUPPLY_TITLE, href: SUPPLY_HREF },
  ];
}
export function supplyBreadcrumb(crumbs: readonly SupplyCrumb[], siteUrl: string | undefined): BreadcrumbView | null {
  if (!siteUrl) return null;
  return { items: crumbs.map((c) => ({ name: c.name, url: `${siteUrl}${c.href}` })) };
}

/** 데이터 출처 줄 — 보이는 카드의 공고 기관(겹침 0)·가장 이른 기준일(모집공고일)·가장 이른 확인일 (REG-10과 같은 방식) */
export function supplySourceLine(cards: readonly SupplyCard[]): { source: string; baseDate: string; checkedAt: string } | null {
  if (!cards.length) return null;
  const earliest = (xs: string[]) => xs.reduce((a, b) => (b < a ? b : a));
  return { source: [...new Set(cards.map((c) => c.issuer))].join(" · "), baseDate: earliest(cards.map((c) => c.noticeDate)), checkedAt: earliest(cards.map((c) => c.verifiedOn)) };
}
