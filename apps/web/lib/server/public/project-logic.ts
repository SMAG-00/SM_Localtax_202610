// 프로젝트 공개 화면 (W4 15단계 — PRD-01B PR-01 · PR-02 · PR-03 · PR-05 · REG1-10, docs/dev/W4_설계.md 1장 15단계 · 4장 · 5장 · 12장 #99 · #103 · #120~) — 순수 모듈
// (시험 project-logic.test.ts). 공개 뷰(public_projects · public_project_events · public_project_stage_lists — 마이그레이션 …47·…49)의 줄을 화면·API 값으로 바꾼다.
//  · 카드 = 지역(행정구역 이름·표준코드)·사업 유형·현재 단계·데이터 출처·기준일(현재 단계 고시일)·정보 확인일 — 하나라도 비면 카드 0(빈 칸 카드 0 — PR-01)
//  · 타임라인 = 그 사업 유형의 전체 단계 목록(첫 단계 … 마지막 단계 — #99) + 단계마다 공개 기록(고시 번호·고시일·고시 기관·원문 주소·공공누리 유형·확인일·검토 중) 또는 해당 없음.
//    원문은 링크만(스냅샷 글자 0 — #19), 원문 주소가 http(s)가 아니거나 고시 칸이 빈 기록은 기록으로 치지 않는다(링크 없는 단계 0)
//  · 가격·분양가·분담금·수익률·시세 값은 공개 뷰에 칸이 없어 화면·API·구조화 데이터 어디에도 없다(PR-05) — 값을 만드는 함수 0
//  · 목록 거르개 ?region=(법정동코드 10자리 — 시·도는 그 아래 시·군·구 포함)·?type=(사업 유형 키)·?stage=(현재 단계 키, 유형을 고른 뒤) — 모양 밖 값은 전체(JS 없이 링크)
//  · GET /api/projects/{slug} 요청 검사 — 모양 밖 주소·모르는 쿼리 칸은 400, 어떤 입력에도 500 0 (DB를 부르기 전에 끝난다)
import type { BreadcrumbView } from "@ltr/structured-data";
import { isoToKstDate } from "@/lib/admin/form-utils";
import { licenseBadge } from "@/lib/admin/official-source-rules";
import { isValidOn, regionHref, sidoCodeOf } from "@/lib/site/region-route";
import { SECTION_INFO } from "./constants";
import type { RegionRow } from "./rows";

/** 프로젝트 트래커 주소 (5장) — 목록 · 한 건 */
export const PROJECTS_HREF = "/realestate/projects";
export const projectHref = (slug: string) => `${PROJECTS_HREF}/${encodeURIComponent(slug)}`;
/** 화면 이름 (목록 제목 · 이동 줄 · 검색 결과 종류 글자와 같은 낱말) */
export const PROJECTS_TITLE = "프로젝트 트래커";

/** 주소 모양 — DB projects.slug check와 같다 */
export const PROJECT_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;
const CODE_RE = /^\d{10}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HTTP = /^https?:\/\/\S+$/i;

/** 화면 한도 (12장 #120·#122) */
export const PROJECT_PUBLIC_LIMITS = { list: 200, hubCards: 4, relatedArticles: 10, slugChars: 120 } as const;

export const PUBLIC_PROJECT_COLUMNS =
  "id, slug, name, region_code, project_type, project_type_label, landmark, summary, source_name, last_verified_at, current_stage, current_stage_label, current_stage_position, current_stage_notice_date";
export const PUBLIC_PROJECT_EVENT_COLUMNS = "id, project_id, kind, stage, stage_label, stage_position, notice_no, notice_date, issuer, source_url, license_type, verified_at, under_review, recorded_at";
export const STAGE_LIST_COLUMNS = "project_type, stage_position, stage, stage_label";

export interface PublicProjectRow {
  id: number | string;
  slug: string;
  name: string;
  region_code: string;
  project_type: string;
  project_type_label: string | null;
  landmark: boolean;
  summary: string | null;
  source_name: string | null;
  last_verified_at: string | null;
  current_stage: string | null;
  current_stage_label: string | null;
  current_stage_position: number | null;
  current_stage_notice_date: string | null;
}

export interface PublicProjectEventRow {
  id: number | string;
  project_id: number | string;
  kind: string;
  stage: string | null;
  stage_label: string | null;
  stage_position: number | null;
  notice_no: string | null;
  notice_date: string | null;
  issuer: string | null;
  source_url: string | null;
  license_type: string | null;
  verified_at: string | null;
  under_review: boolean;
  recorded_at: string | null;
}

export interface StageListRow {
  project_type: string;
  stage_position: number;
  stage: string;
  stage_label: string;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

// ── 지역 ──

export interface ProjectRegionView {
  code: string;
  /** 시·도 이름, 시·군·구면 '시·도 시·군·구' */
  name: string;
  /** 지역 허브 주소 — region_hubs가 열렸고 오늘 유효할 때만, 아니면 null(글자만 — 404 링크 0) */
  href: string | null;
}

/** 프로젝트 지역 → 이름·허브 주소. 행정구역 행이 없으면 null(카드 0) */
export function projectRegion(code: string, regions: readonly RegionRow[], today: string, hubsOpen: boolean): ProjectRegionView | null {
  const r = regions.find((x) => x.code === code);
  if (!r) return null;
  const parent = r.parent_code ? regions.find((x) => x.code === r.parent_code) : undefined;
  if (r.level === "sigungu" && !parent) return null;
  const open = hubsOpen && isValidOn(r, today) && (!parent || isValidOn(parent, today));
  return {
    code: r.code,
    name: parent ? `${parent.name} ${r.name}` : r.name,
    href: open ? (parent ? regionHref(parent.slug, r.slug) : regionHref(r.slug)) : null,
  };
}

// ── 카드 ──

export interface ProjectCard {
  id: number;
  slug: string;
  name: string;
  href: string;
  summary: string | null;
  landmark: boolean;
  type: { key: string; label: string };
  region: ProjectRegionView;
  /** 현재 단계 — 키·글자·고시일(카드의 '기준일' — 12장 #121) */
  stage: { key: string; label: string; noticeDate: string };
  /** 데이터 출처 (projects.source_name) */
  source: string;
  /** 정보 확인일 (projects.last_verified_at — 한국 날짜) */
  verifiedOn: string;
}

/** 공개 뷰 한 줄 → 카드. 지역·유형 글자·현재 단계·출처·기준일·확인일 가운데 하나라도 비면 null (빈 칸 카드 0 — PR-01) */
export function projectCard(row: PublicProjectRow, region: ProjectRegionView | null): ProjectCard | null {
  const name = text(row.name);
  const typeLabel = text(row.project_type_label);
  const stageKey = text(row.current_stage);
  const stageLabel = text(row.current_stage_label);
  const noticeDate = text(row.current_stage_notice_date);
  const source = text(row.source_name);
  const verifiedOn = row.last_verified_at ? isoToKstDate(row.last_verified_at) : "";
  if (!region || !name || !PROJECT_SLUG_RE.test(row.slug) || !typeLabel || !stageKey || !stageLabel || !noticeDate || !ISO_DATE.test(noticeDate) || !source || !ISO_DATE.test(verifiedOn)) return null;
  return {
    id: Number(row.id),
    slug: row.slug,
    name,
    href: projectHref(row.slug),
    summary: text(row.summary),
    landmark: row.landmark === true,
    type: { key: row.project_type, label: typeLabel },
    region,
    stage: { key: stageKey, label: stageLabel, noticeDate },
    source,
    verifiedOn,
  };
}

/** 목록 차례 — 대표(랜드마크) 먼저, 현재 단계 고시일이 늦은 것, 번호가 큰 것 (12장 #120) */
export function sortProjects(cards: readonly ProjectCard[]): ProjectCard[] {
  return [...cards].sort((a, b) => Number(b.landmark) - Number(a.landmark) || b.stage.noticeDate.localeCompare(a.stage.noticeDate) || b.id - a.id);
}

// ── 목록 거르개 ──

export interface ProjectFilter {
  region: string | null;
  type: string | null;
  stage: string | null;
}
export const NO_FILTER: ProjectFilter = { region: null, type: null, stage: null };

type Params = Record<string, string | string[] | undefined>;
const single = (v: string | string[] | undefined): string | null => (typeof v === "string" ? v : null);

/** 쿼리 → 거르개. 모양 밖 값·두 번 보낸 칸은 그 칸 전체(null), 단계는 유형을 고른 뒤에만 */
export function parseProjectFilter(params: Params): ProjectFilter {
  const region = single(params.region);
  const type = single(params.type);
  const stage = single(params.stage);
  const t = type && KEY_RE.test(type) ? type : null;
  return { region: region && CODE_RE.test(region) ? region : null, type: t, stage: t && stage && KEY_RE.test(stage) ? stage : null };
}

/** 지역 거르개 — 같은 코드, 시·도 코드면 그 아래 시·군·구 (검색 함수 지역 거르개와 같은 규칙) */
const inRegion = (code: string, filter: string) => code === filter || (filter.endsWith("00000000") && sidoCodeOf(code) === filter);

export function filterProjects(cards: readonly ProjectCard[], f: ProjectFilter): ProjectCard[] {
  return cards.filter((c) => (!f.region || inRegion(c.region.code, f.region)) && (!f.type || c.type.key === f.type) && (!f.stage || c.stage.key === f.stage));
}

/** 거르개 주소 (기본값은 쓰지 않는다 — 칸 차례 region·type·stage) */
export function projectListHref(f: ProjectFilter): string {
  const p = new URLSearchParams();
  if (f.region) p.set("region", f.region);
  if (f.type) p.set("type", f.type);
  if (f.type && f.stage) p.set("stage", f.stage);
  const q = p.toString();
  return q ? `${PROJECTS_HREF}?${q}` : PROJECTS_HREF;
}

export interface FilterChip {
  value: string | null;
  label: string;
  count: number;
  href: string;
  current: boolean;
}
export interface ProjectFilterChips {
  regions: FilterChip[];
  types: FilterChip[];
  /** 유형을 골랐을 때만 — 그 유형 단계 목록 차례, 프로젝트가 있는 단계만 */
  stages: FilterChip[];
}

/** 거르개 칩 — 공개 프로젝트가 있는 값만(데이터 없는 칩 0). '전체' 칩이 앞에 하나 */
export function projectFilterChips(cards: readonly ProjectCard[], f: ProjectFilter, regions: readonly RegionRow[], stageLists: readonly StageListRow[]): ProjectFilterChips {
  const sidoCount = new Map<string, number>();
  for (const c of cards) sidoCount.set(sidoCodeOf(c.region.code), (sidoCount.get(sidoCodeOf(c.region.code)) ?? 0) + 1);
  const regionChips: FilterChip[] = [...sidoCount.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([code, count]) => {
      const name = regions.find((r) => r.code === code)?.name;
      return name ? [{ value: code, label: name, count, href: projectListHref({ ...f, region: code }), current: f.region === code }] : [];
    });
  const typeCount = new Map<string, { label: string; count: number }>();
  for (const c of cards) typeCount.set(c.type.key, { label: c.type.label, count: (typeCount.get(c.type.key)?.count ?? 0) + 1 });
  const typeChips: FilterChip[] = [...typeCount.entries()]
    .sort(([, a], [, b]) => a.label.localeCompare(b.label, "ko"))
    .map(([key, v]) => ({ value: key, label: v.label, count: v.count, href: projectListHref({ ...f, type: key, stage: null }), current: f.type === key }));
  const stageChips: FilterChip[] = f.type
    ? stageLists
        .filter((s) => s.project_type === f.type)
        .sort((a, b) => a.stage_position - b.stage_position)
        .flatMap((s) => {
          const count = cards.filter((c) => c.type.key === f.type && c.stage.key === s.stage).length;
          return count ? [{ value: s.stage, label: s.stage_label, count, href: projectListHref({ ...f, stage: s.stage }), current: f.stage === s.stage }] : [];
        })
    : [];
  const all = (chips: FilterChip[], over: Partial<ProjectFilter>, current: boolean): FilterChip[] =>
    chips.length ? [{ value: null, label: "전체", count: 0, href: projectListHref({ ...f, ...over }), current }, ...chips] : [];
  return {
    regions: all(regionChips, { region: null }, f.region === null),
    types: all(typeChips, { type: null, stage: null }, f.type === null),
    stages: all(stageChips, { stage: null }, f.stage === null),
  };
}

// ── 타임라인 ──

export interface StageRecordView {
  noticeNo: string;
  noticeDate: string;
  issuer: string;
  sourceUrl: string;
  licenseType: string;
  /** 공공누리 유형 글자 (모르는 값이면 null — 지어내지 않는다) */
  licenseLabel: string | null;
  /** 확인일 = 그 단계 원본 스냅샷을 받은 날 (한국 날짜 — #95) */
  checkedOn: string;
  underReview: boolean;
}

export type StageStatus = "recorded" | "not_applicable" | "none";

export interface TimelineStage {
  key: string;
  label: string;
  position: number;
  status: StageStatus;
  record: StageRecordView | null;
}

/** 공개 기록 한 줄 → 단계 기록 보기 값. 고시 칸·원문 주소(http·https)·확인일 가운데 하나라도 없으면 null */
export function stageRecord(e: PublicProjectEventRow): StageRecordView | null {
  const noticeNo = text(e.notice_no);
  const noticeDate = text(e.notice_date);
  const issuer = text(e.issuer);
  const sourceUrl = text(e.source_url);
  const license = text(e.license_type);
  const checkedOn = e.verified_at ? isoToKstDate(e.verified_at) : "";
  if (e.kind !== "stage" || !noticeNo || !noticeDate || !ISO_DATE.test(noticeDate) || !issuer || !sourceUrl || !HTTP.test(sourceUrl) || !license || !ISO_DATE.test(checkedOn)) return null;
  return { noticeNo, noticeDate, issuer, sourceUrl, licenseType: license, licenseLabel: licenseBadge(license), checkedOn, underReview: e.under_review === true };
}

/**
 * 전체 단계 목록 + 공개 기록 → 타임라인 (첫 단계 … 마지막 단계 — #99). 목록을 읽지 못하면 기록된 단계만(차례 = 기록의 단계 차례).
 * 단계마다 기록(stage) · 해당 없음(not_applicable) · 기록 없음(none)
 */
export function projectTimeline(list: readonly StageListRow[], events: readonly PublicProjectEventRow[]): TimelineStage[] {
  const base =
    list.length > 0
      ? [...list].sort((a, b) => a.stage_position - b.stage_position).map((s) => ({ key: s.stage, label: s.stage_label, position: s.stage_position }))
      : [...new Map(events.filter((e) => e.stage && e.stage_label && e.stage_position !== null).map((e) => [e.stage!, { key: e.stage!, label: e.stage_label!, position: Number(e.stage_position) }])).values()].sort(
          (a, b) => a.position - b.position,
        );
  return base.map((s) => {
    const own = events.filter((e) => e.stage === s.key);
    const record = own.map(stageRecord).find((r) => r !== null) ?? null;
    if (record) return { ...s, status: "recorded" as const, record };
    if (own.some((e) => e.kind === "not_applicable")) return { ...s, status: "not_applicable" as const, record: null };
    return { ...s, status: "none" as const, record: null };
  });
}

/** 단계 기록의 원문 연결률 (W4 증거 '단계 원문 100%') — 기록 수·원문이 있는 기록 수 */
export function sourceCoverage(timeline: readonly TimelineStage[]): { recorded: number; linked: number } {
  const recorded = timeline.filter((s) => s.status === "recorded");
  return { recorded: recorded.length, linked: recorded.filter((s) => s.record && HTTP.test(s.record.sourceUrl)).length };
}

// ── 이동 줄 · 구조화 데이터 ──

export interface ProjectCrumb {
  name: string;
  href: string;
}

/** 이동 줄 — 홈 > 부동산 > 프로젝트 트래커 (> 프로젝트 이름). 구조화 데이터 BreadcrumbList가 같은 값을 쓴다 */
export function projectCrumbs(project?: { name: string; href: string }): ProjectCrumb[] {
  return [
    { name: "홈", href: "/" },
    { name: SECTION_INFO.realestate.name, href: SECTION_INFO.realestate.href },
    { name: PROJECTS_TITLE, href: PROJECTS_HREF },
    ...(project ? [{ name: project.name, href: project.href }] : []),
  ];
}

/** 이동 줄 → BreadcrumbList 입력 — 사이트 주소가 없으면 null (틀린 주소 0) */
export function projectBreadcrumb(crumbs: readonly ProjectCrumb[], siteUrl: string | undefined): BreadcrumbView | null {
  if (!siteUrl) return null;
  return { items: crumbs.map((c) => ({ name: c.name, url: `${siteUrl}${c.href}` })) };
}

// ── 관련 기사 (확인된 연결 — 두 방향, 12장 #122) ──

export interface ProjectLinkRow {
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  confirmed_at: string | null;
}

/** 프로젝트 ↔ 기사 확인된 연결의 기사 번호 — 프로젝트 → 기사 · 기사 → 프로젝트 둘 다, 최근 확인 순, 한 번씩, 최대 relatedArticles */
export function relatedArticleIds(rows: readonly ProjectLinkRow[], projectId: number, limit: number = PROJECT_PUBLIC_LIMITS.relatedArticles): number[] {
  const id = String(projectId);
  const picked = rows
    .flatMap((r) => {
      if (r.from_type === "project" && r.from_id === id && r.to_type === "article") return [{ article: Number(r.to_id), at: Date.parse(r.confirmed_at ?? "") || 0 }];
      if (r.to_type === "project" && r.to_id === id && r.from_type === "article") return [{ article: Number(r.from_id), at: Date.parse(r.confirmed_at ?? "") || 0 }];
      return [];
    })
    .filter((x) => Number.isSafeInteger(x.article) && x.article > 0)
    .sort((a, b) => b.at - a.at || b.article - a.article);
  return [...new Set(picked.map((x) => x.article))].slice(0, limit);
}

// ── 지역 허브 ③ 프로젝트 카드 (12장 #120) ──

/** 지역 허브 ③ 카드 — 그 지역에서 출발한 확인된 연결의 프로젝트 먼저(편집자 확인 순), 그다음 목록 차례. 최대 hubCards장 */
export function hubProjectCards(cards: readonly ProjectCard[], linkedIds: readonly number[], limit: number = PROJECT_PUBLIC_LIMITS.hubCards): ProjectCard[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const linked = [...new Set(linkedIds)].flatMap((id) => byId.get(id) ?? []);
  const rest = sortProjects(cards.filter((c) => !linked.includes(c)));
  return [...linked, ...rest].slice(0, limit);
}

// ── GET /api/projects/{slug} ──

export const PROJECT_API = { params: [] as readonly string[] } as const;

export type ProjectApiRequest = { ok: true; slug: string } | { ok: false; errors: string[] };

/** 경로 주소 + 쿼리 → 조건. 쿼리 칸은 받지 않는다(모르는 칸 400) */
export function parseProjectApiRequest(slug: string, params: URLSearchParams): ProjectApiRequest {
  const errors: string[] = [];
  if (slug.length > PROJECT_PUBLIC_LIMITS.slugChars || !PROJECT_SLUG_RE.test(slug)) errors.push(`slug: 영문 소문자·숫자·하이픈 주소입니다 (${PROJECT_PUBLIC_LIMITS.slugChars}자까지)`);
  for (const key of new Set(params.keys())) errors.push(`${key}: 모르는 칸입니다 — 이 API는 쿼리 칸을 받지 않습니다`);
  return errors.length ? { ok: false, errors } : { ok: true, slug };
}

export const PROJECT_API_STATUSES = ["public", "under_review"] as const;

export interface ProjectApiBody {
  slug: string;
  name: string;
  url: string;
  summary: string | null;
  landmark: boolean;
  projectType: { key: string; label: string };
  region: { code: string; name: string };
  currentStage: { key: string; label: string; noticeDate: string };
  stages: { key: string; label: string; position: number; status: StageStatus; record: (Omit<StageRecordView, "licenseLabel" | "checkedOn"> & { verifiedAt: string }) | null }[];
  /** 데이터 출처 (5.6 — 공개 응답은 source·verifiedAt·status) */
  source: string;
  /** 정보 확인일 (한국 날짜) */
  verifiedAt: string;
  /** public · under_review(원문 검수 중인 단계 기록이 있음 — `검토 중`) */
  status: (typeof PROJECT_API_STATUSES)[number];
}

export function projectApiBody(card: ProjectCard, timeline: readonly TimelineStage[]): ProjectApiBody {
  return {
    slug: card.slug,
    name: card.name,
    url: card.href,
    summary: card.summary,
    landmark: card.landmark,
    projectType: card.type,
    region: { code: card.region.code, name: card.region.name },
    currentStage: card.stage,
    stages: timeline.map((s) => ({
      key: s.key,
      label: s.label,
      position: s.position,
      status: s.status,
      record: s.record
        ? { noticeNo: s.record.noticeNo, noticeDate: s.record.noticeDate, issuer: s.record.issuer, sourceUrl: s.record.sourceUrl, licenseType: s.record.licenseType, verifiedAt: s.record.checkedOn, underReview: s.record.underReview }
        : null,
    })),
    source: card.source,
    verifiedAt: card.verifiedOn,
    status: timeline.some((s) => s.record?.underReview) ? "under_review" : "public",
  };
}
