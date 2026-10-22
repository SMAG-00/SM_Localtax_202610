// 지역 색인 판정·시범 지역·최소선 리포트 (W4 11단계) — 순수 모듈 (시험 region-index-logic.test.ts).
// docs/dev/W4_설계.md 1장 11단계 · 2.2 · 12장 #6·#26·#27·#35·#81~#86, PRD-01B REG-09 · REG1-01 · REG1-12 · 9.2:
//  · 판정은 DB 뷰 region_index_status(…46)가 렌더 때 계산한다 — 이 모듈은 설정 모양 검사(DB 트리거와 같은 규칙), 화면 robots·제목·메타 설명, /local 칩, 리포트 모양만 정한다
//  · 지역 허브의 검색 노출: 빈 지역(기사 0) → 고른 분야 0건 → 최소선 미달 순으로 사유 하나(주소에 가까운 사유 먼저). 사유가 없고 SITE_INDEXING=on이면 색인, 아니면 루트 설정(운영 전환 전 noindex) 그대로
//  · 제목 = '{시·도[ 시·군·구]} · 지자체뉴스'(분야를 골랐으면 분야 글자를 더한다), 메타 설명 = 그 지역 코드 하나만 단 최신 자체 취재 기사 제목 2건(편집자 한 줄 자리는 아직 없다) —
//    지명만 바꾼 템플릿 문장 0, 허브마다 다른 기사라 허브끼리 같은 설명 0 (12장 #27·#83)
//  · 최소선 판정 리포트 — 시범 지역마다 두 수와 최소선, 서로 다른 시·도 2곳 이상(9.2 시·도 분포). 비면 '시범 지역 미지정'
import { isValidOn, sidoCodeOf, type RegionRouteRow } from "@/lib/site/region-route";

/** 설계 2.2 — 임계값 칸 (마이그레이션 …46 region_index_settings_guard와 같다) */
export const REGION_INDEX_KEYS = ["reported_news", "official_sources"] as const;
export type RegionIndexKey = (typeof REGION_INDEX_KEYS)[number];
export const REGION_INDEX_KEY_LABELS: Readonly<Record<RegionIndexKey, string>> = { reported_news: "자체 취재 기사", official_sources: "공식 원문/자료" };
/** 한도 — 임계값 1~1000 정수(0은 빈 지역을 색인한다 — REG1-01), 시범 지역 0~20곳 */
export const REGION_INDEX_LIMITS = { min: 1, max: 1000, pilots: 20 } as const;
/** 설계 2.2 씨앗 — 9.2 최소선 */
export const REGION_INDEX_THRESHOLD_SEED: Readonly<Record<RegionIndexKey, number>> = { reported_news: 1, official_sources: 1 };
/** 9.2 시·도 분포 — 시범 지역이 서로 다른 2개 이상 시·도 */
export const PILOT_MIN_SIDO = 2;
/** 보도자료 재게시 경고(8단계 REG1-14) — 마지막 발행 기록에 이 경고가 있는 보도기사는 자체 취재 수에 0 (뷰와 같은 값) */
export const REPOST_WARNING_ID = "reg1_14.press-release-repost";
/** 메타 설명에 쓰는 기사 제목 수 (12장 #27) · 글자 상한 */
export const DESCRIPTION_TITLES = 2;
export const DESCRIPTION_MAX_CHARS = 160;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const CODE_RE = /^[0-9]{10}$/;

// ── 설정 검사 (DB 트리거와 같은 규칙 — 운영 설정 화면·API가 같은 함수) ─────────────────

/** region_index_threshold 검사 — 문장 목록 (빈 목록이면 통과) */
export function regionIndexThresholdErrors(value: unknown): string[] {
  if (!isObj(value)) return ['값은 {"reported_news": 정수, "official_sources": 정수} 객체여야 합니다'];
  const errors: string[] = [];
  for (const k of Object.keys(value)) if (!(REGION_INDEX_KEYS as readonly string[]).includes(k)) errors.push(`${k}: 모르는 칸입니다 — reported_news(자체 취재 기사)·official_sources(공식 원문/자료)뿐입니다`);
  for (const k of REGION_INDEX_KEYS) {
    const v = value[k];
    if (typeof v !== "number" || !Number.isInteger(v) || v < REGION_INDEX_LIMITS.min || v > REGION_INDEX_LIMITS.max) {
      errors.push(`${k}: ${REGION_INDEX_LIMITS.min}~${REGION_INDEX_LIMITS.max} 정수여야 합니다 — 0이면 빈 지역이 색인됩니다 (REG1-01)`);
    }
  }
  return errors;
}

/** pilot_regions 모양 검사 — 목록·10자리 코드·중복 0·개수 (있는 지역인지는 pilotRegionsRegionErrors) */
export function pilotRegionsErrors(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > REGION_INDEX_LIMITS.pilots) return [`법정동코드 0~${REGION_INDEX_LIMITS.pilots}개 목록이어야 합니다 — 예: ["1100000000", "2600000000"]`];
  const errors: string[] = [];
  const seen = new Set<string>();
  value.forEach((c, i) => {
    if (typeof c !== "string" || !CODE_RE.test(c)) errors.push(`[${i}]: 10자리 숫자 글자여야 합니다`);
    else if (seen.has(c)) errors.push(`[${i}]: ${c}가 두 번 있습니다`);
    else seen.add(c);
  });
  return errors;
}

/** pilot_regions — 새로 넣는 코드는 오늘 유효한 행정구역이어야 한다 (이미 있던 코드는 폐지돼도 남는다 — DB 트리거와 같다) */
export function pilotRegionsRegionErrors(value: readonly string[], previous: unknown, regions: readonly RegionRouteRow[], today: string): string[] {
  const before = new Set(Array.isArray(previous) ? previous.filter((c): c is string => typeof c === "string") : []);
  const byCode = new Map(regions.map((r) => [r.code, r]));
  return value.flatMap((c, i) => {
    if (before.has(c)) return [];
    const row = byCode.get(c);
    return row && isValidOn(row, today) ? [] : [`[${i}]: ${c}는 오늘 유효한 행정구역(regions)이 아닙니다`];
  });
}

/** 공개 읽기 — 시범 지역 목록 (모양이 틀리면 빈 목록 — 닫힌 쪽: 칩 0) */
export function parsePilotRegions(value: unknown): string[] {
  return Array.isArray(value) && pilotRegionsErrors(value).length === 0 ? (value as string[]) : [];
}

// ── 지역 허브 화면 ─────────────────────────────

/** 검색 노출 제외 사유 — 빈 지역(REG1-01) · 고른 분야 0건(CAT-02) · 최소선 미달(REG-09 · 9.2). 없으면 null */
export type NoindexReason = "empty" | "below_minimum" | "topic_empty";

export function regionNoindexReason(input: { empty: boolean; indexable: boolean; topicEmpty: boolean }): NoindexReason | null {
  if (input.empty) return "empty";
  if (input.topicEmpty) return "topic_empty";
  if (!input.indexable) return "below_minimum";
  return null;
}

/** 화면 robots — 사유가 있으면 noindex, 없고 SITE_INDEXING=on이면 색인, 아니면 루트 설정 그대로(undefined — 운영 전환 전 noindex) */
export function regionRobots(reason: NoindexReason | null, siteIndexing: boolean): { index: boolean; follow: boolean } | undefined {
  if (reason !== null) return { index: false, follow: false };
  return siteIndexing ? { index: true, follow: true } : undefined;
}

/** 화면 제목(매체 이름 앞) — 분야를 골랐으면 분야 글자를 더한다(허브와 같은 제목 0) */
export function regionTitle(fullName: string, sectionName: string, topicLabel: string | null): string {
  return topicLabel ? `${fullName} ${topicLabel} · ${sectionName}` : `${fullName} · ${sectionName}`;
}

/** 메타 설명 — 그 지역 코드 하나만 단 최신 자체 취재 기사 제목 2건 (없으면 null — 템플릿 문장 0) */
export function regionDescription(titles: readonly string[]): string | null {
  const parts = titles.map((t) => t.trim()).filter((t) => t !== "").slice(0, DESCRIPTION_TITLES);
  if (parts.length === 0) return null;
  const text = parts.join(" · ");
  return text.length <= DESCRIPTION_MAX_CHARS ? text : `${text.slice(0, DESCRIPTION_MAX_CHARS - 1)}…`;
}

// ── /local 시·도 카드 칩 ─────────────────────────────

/** 시·도 카드의 '시범 지역' — 그 시·도가 시범 지역이거나 그 아래 시·군·구가 시범 지역 */
export function sidoIsPilot(sidoCode: string, pilots: readonly string[]): boolean {
  return pilots.some((c) => c === sidoCode || sidoCodeOf(c) === sidoCode);
}

// ── 최소선 판정 리포트 ─────────────────────────────

/** 뷰 region_index_status 한 행 (service_role) */
export interface RegionIndexRow {
  code: string;
  level: string;
  parent_code: string | null;
  name: string;
  path: string;
  current: boolean;
  pilot: boolean;
  own_reported: number;
  official_sources: number;
  min_reported: number | string | null;
  min_official: number | string | null;
  reported_ok: boolean;
  official_ok: boolean;
  indexable: boolean;
  last_published_at: string | null;
}

export interface PilotRegionView {
  code: string;
  name: string;
  /** 시·도 이름 (시·군·구면 상위 시·도) */
  sidoName: string | null;
  path: string | null;
  current: boolean;
  reported: { count: number; min: number | null; ok: boolean };
  official: { count: number; min: number | null; ok: boolean };
  indexable: boolean;
}

export type PilotReportStatus = "unset" | "short" | "met";
export const PILOT_REPORT_LABELS: Readonly<Record<PilotReportStatus, string>> = { unset: "시범 지역 미지정", short: "최소선 미달", met: "최소선 충족" };
/** 리포트 문제 글자 (9.2 · 1장 11단계 증거 글자 그대로) */
export const PILOT_PROBLEMS = {
  distribution: "시·도 분포 미달",
  belowMinimum: "최소선 미달 지역",
  invalid: "유효하지 않은 시범 지역",
  threshold: "임계값 설정 없음",
} as const;

export interface PilotReport {
  status: PilotReportStatus;
  label: string;
  problems: string[];
  threshold: { reported: number | null; official: number | null };
  regions: PilotRegionView[];
  /** 시범 지역의 서로 다른 시·도 수 */
  sidoCount: number;
  minSido: number;
  /** 지금 색인 대상인 지역 수 (전국) */
  indexedCount: number;
}

const toNum = (v: number | string | null | undefined): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** 시범 지역 리포트 — pilots = 설정 순서, rows = 뷰 전체(시·도 이름·전국 색인 수에 쓴다) */
export function pilotReport(pilots: readonly string[], rows: readonly RegionIndexRow[], threshold: unknown): PilotReport {
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const parsed = isObj(threshold) && regionIndexThresholdErrors(threshold).length === 0 ? (threshold as Record<RegionIndexKey, number>) : null;
  const regions: PilotRegionView[] = pilots.map((code) => {
    const row = byCode.get(code);
    const sido = row ? (row.level === "sido" ? row : byCode.get(row.parent_code ?? sidoCodeOf(code))) : undefined;
    return {
      code,
      name: row?.name ?? "(행정구역에 없는 코드)",
      sidoName: sido?.name ?? null,
      path: row && row.current ? row.path : null,
      current: row?.current ?? false,
      reported: { count: row?.own_reported ?? 0, min: toNum(row?.min_reported), ok: row?.reported_ok ?? false },
      official: { count: row?.official_sources ?? 0, min: toNum(row?.min_official), ok: row?.official_ok ?? false },
      indexable: row?.indexable ?? false,
    };
  });
  const sidoCount = new Set(regions.filter((r) => r.current).map((r) => sidoCodeOf(r.code))).size;
  const problems: string[] = [];
  if (pilots.length > 0) {
    if (sidoCount < PILOT_MIN_SIDO) problems.push(`${PILOT_PROBLEMS.distribution} — 서로 다른 시·도 ${sidoCount}곳 (최소 ${PILOT_MIN_SIDO}곳)`);
    const invalid = regions.filter((r) => !r.current).length;
    if (invalid) problems.push(`${PILOT_PROBLEMS.invalid} ${invalid}곳`);
    const below = regions.filter((r) => r.current && !r.indexable).length;
    if (below) problems.push(`${PILOT_PROBLEMS.belowMinimum} ${below}곳`);
    if (!parsed) problems.push(PILOT_PROBLEMS.threshold);
  }
  const status: PilotReportStatus = pilots.length === 0 ? "unset" : problems.length ? "short" : "met";
  return {
    status,
    label: PILOT_REPORT_LABELS[status],
    problems,
    threshold: { reported: parsed?.reported_news ?? null, official: parsed?.official_sources ?? null },
    regions,
    sidoCount,
    minSido: PILOT_MIN_SIDO,
    indexedCount: rows.filter((r) => r.indexable).length,
  };
}
