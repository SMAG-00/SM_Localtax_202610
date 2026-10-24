// 측정 지표 대시보드(/admin/metrics)의 화면 값 — 지표 이름·정의 글자(분모·분자·제외 조건)·다른 문서 지표 자리·비율 글자·기간 링크. 순수 모듈 (시험 metrics-view.test.ts)
// 지표마다 정의·분모·분자·소유 요구사항 ID를 보이고, 소유 문서의 데이터가 아직 없으면 '수집 전'(추정값 0) — GROW-01 수용 기준.
import { BASELINE_DAYS, PRESET_DAYS, REVISIT_DAYS, ratio, type Funnel, type Period, type Ratio, type SegmentKind } from "@/lib/analytics/metrics";
import { SECTION_INFO, SECTION_KEYS, type SectionKey } from "@/lib/server/public/constants";

export const METRICS_PATH = "/admin/metrics";

export const SEGMENT_LABELS: Readonly<Record<SegmentKind, string>> = { trial: "시험 기간 (전환 전)", live: "운영 (전환 후)" };

export const SECTION_ROWS: ReadonlyArray<{ key: SectionKey; label: string }> = SECTION_KEYS.map((key) => ({ key, label: SECTION_INFO[key].name }));

/** 비율 글자 — 소수 한 자리 백분율, 분모 0이면 '—' (0%로 보이지 않게) */
export function formatRate(r: Ratio): string {
  const v = ratio(r);
  if (v === null) return "—";
  const pct = Math.round(v * 1000) / 10;
  return `${Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1)}%`;
}

export const formatCount = (n: number): string => n.toLocaleString("ko-KR");

export interface MetricDefinition {
  title: string;
  /** 소유 요구사항 ID */
  owner: string;
  denominator: string;
  numerator: string;
  exclusions: string;
  note?: string;
}

/** 이 문서(GROW-01)가 정의하는 지표 — PRD-01A 4장 GROW-01 · 12장 지표 표 · PRD_최종 §3.3 */
export const DEFINITIONS = {
  validVisits: {
    title: "분야별 유효 방문",
    owner: "GROW-01",
    denominator: "그 분야 허브를 본 세션",
    numerator: "그 세션 가운데 같은 분야 기사를 30초 이상 읽은 세션 (화면이 보인 시간 30초 — 29초는 넣지 않음)",
    exclusions: "봇·편집국·관리자 세션",
    note: "허브와 기사를 본 순서는 보지 않습니다. 전체 줄은 허브를 하나라도 본 세션이라 분야 합보다 작을 수 있습니다.",
  },
  revisits: {
    title: "재방문율",
    owner: "GROW-01",
    denominator: "기간 안에 그 분야(허브·기사)를 본 측정 동의 방문자",
    numerator: `그중 처음 본 날(한국 날짜)부터 ${REVISIT_DAYS}일째 날짜까지 다른 방문(세션)에서 같은 분야를 다시 본 방문자 — ${REVISIT_DAYS + 1}일째는 넣지 않음`,
    exclusions: "봇·편집국·관리자 세션, 방문자 ID가 없는 세션(측정 동의가 확인되지 않음)",
    note: `기간 끝 뒤 ${REVISIT_DAYS}일까지 봅니다. '30일 안 지남'은 아직 다시 오지 않았지만 ${REVISIT_DAYS}일이 끝나지 않아 숫자가 늘 수 있는 방문자입니다(분모에 들어 있음).`,
  },
  funnel: {
    title: "첫 방문 깔때기 (보조 지표)",
    owner: "GROW-01 · BM-L2",
    denominator: "1단계 — 첫 방문 세션: 새 브라우저로 처음 들어와 이벤트가 하나라도 남은 세션",
    numerator: "2단계 — 그중 4대 분야 카드·상황 카드를 누르거나 검색한 세션 → 3단계 — 그중 2단계 뒤에 기사를 30초 이상 읽고, 그 뒤에 다음 행동 버튼을 누른 세션",
    exclusions: "봇·편집국·관리자 세션",
    note: "홈에 들어와 아무것도 누르지 않은 첫 방문은 이벤트가 없어 1단계에 들지 않습니다. 상황 페이지 30초 열람은 이벤트가 아직 없어 기사만 셉니다.",
  },
  solved: {
    title: "첫 방문 문제해결률 (보조 지표)",
    owner: "GROW-01 · BM-L2",
    denominator: "첫 방문 세션",
    numerator: "그중 기사를 30초 이상 읽은 뒤 다음 행동 버튼을 누른 세션 (2단계 클릭·검색을 거치지 않아도 됨 — 1단계 서비스의 대리 정의)",
    exclusions: "봇·편집국·관리자 세션",
  },
} as const satisfies Record<string, MetricDefinition>;

export interface FunnelRow {
  step: 1 | 2 | 3;
  label: string;
  count: number;
  /** 앞 칸 대비 (첫 칸은 null) */
  fromPrevious: Ratio | null;
  /** 첫 방문 대비 (첫 칸은 null) */
  fromFirst: Ratio | null;
}

export function funnelRows(f: Funnel): FunnelRow[] {
  return [
    { step: 1, label: "첫 방문 세션", count: f.firstVisits, fromPrevious: null, fromFirst: null },
    { step: 2, label: "4대 분야 카드·상황 카드 클릭 또는 검색", count: f.entered, fromPrevious: { numerator: f.entered, denominator: f.firstVisits }, fromFirst: { numerator: f.entered, denominator: f.firstVisits } },
    {
      step: 3,
      label: "그 뒤 기사 30초 이상 + 다음 행동 클릭",
      count: f.engagedAction,
      fromPrevious: { numerator: f.engagedAction, denominator: f.entered },
      fromFirst: { numerator: f.engagedAction, denominator: f.firstVisits },
    },
  ];
}

export type OtherMetricStatus = "수집 전" | "2단계부터";

export interface OtherMetric {
  id: string;
  name: string;
  definition: string;
  owner: string;
  status: OtherMetricStatus;
  note: string;
}

/**
 * 다른 문서가 정의하고 이 대시보드에 모으는 지표 (GROW-01 · PRD-01A 12장) — 소유 작업이 수집을 붙이기 전까지 '수집 전'(숫자 0개 — 추정값을 만들지 않는다).
 * 소유 작업이 데이터를 만들면 그 작업이 이 목록에서 빼고 계산을 붙인다
 */
export const OTHER_METRICS: readonly OtherMetric[] = [
  {
    id: "tax-link",
    name: "지방세 연결률",
    definition: "비지방세 분야(부동산·부동산금융·지자체뉴스) 기사 세션 중 「지방세로 읽기」·해설·계산기로 이동한 비율",
    owner: "01B CORE-03",
    status: "수집 전",
    note: "「지방세로 읽기」 이동 이벤트가 아직 없습니다 (01B)",
  },
  {
    id: "assistant",
    name: "AI 도우미 해결률 · 사람 연결률 · 대화당 비용",
    definition: "도우미 대화 중 링크 클릭 또는 '도움됨'으로 끝난 비율, 사람 연결 버튼으로 끝난 비율, 대화당 비용",
    owner: "01C CHAT-13",
    status: "수집 전",
    note: "AI 도우미가 아직 없습니다 (01C)",
  },
  {
    id: "experts",
    name: "전문가 연결",
    definition: "전문가 프로필 조회·외부 연락 클릭, SM 연락 요청 접수 수와 목표 시간 안 연락률",
    owner: "01C EXPL-09",
    status: "수집 전",
    note: "전문가 소개 화면이 아직 없습니다 (01C)",
  },
  {
    id: "conversion",
    name: "구독·도서·교육·상담 전환과 유입 경로",
    definition: "브리핑 구독, 지면·디지털 구독, 도서 주문, 교육 신청, SM 상담 계약 건수와 유입 경로",
    owner: "01C BIZ-09",
    status: "수집 전",
    note: "주문·신청 기록이 아직 없습니다 (01C)",
  },
  {
    id: "contribution",
    name: "상품별 공헌이익",
    definition: "상품 매출 − 직접·변동비",
    owner: "01C BIZ-09",
    status: "2단계부터",
    note: "PRD_최종 §3.3 — 2단계부터 잽니다",
  },
  {
    id: "ai-search",
    name: "AI 검색 노출",
    definition: "서치 콘솔·서치어드바이저 노출, AI 답변 엔진 유입, 월 1회 핵심 질문 50개 인용 여부",
    owner: "OPT-09",
    status: "수집 전",
    note: "AI 답변 엔진 유입은 진입 경로(ai_answer_engine)로 이미 모읍니다 — 노출·인용 표본은 OPT-09 작업에서",
  },
  {
    id: "readiness",
    name: "제휴 준비도",
    definition: "자체 취재 기사 비율, 근거·정정 이력 충족률, 유사도 경고 (월 마감 행)",
    owner: "NAV-17",
    status: "수집 전",
    note: "월 마감 행은 W2-c 5단계(기사 생산·제휴 준비 대시보드)가 만듭니다",
  },
];

export interface PeriodLink {
  key: string;
  label: string;
  href: string;
  current: boolean;
}

/** 기간 고르기 링크 — 최근 7·30·90일, 전환일이 있으면 '전환 후 첫 4주(기준선)' */
export function periodLinks(period: Period, cutover: string | null): PeriodLink[] {
  const links: PeriodLink[] = PRESET_DAYS.map((d) => ({
    key: String(d),
    label: `최근 ${d}일`,
    href: `${METRICS_PATH}?period=${d}`,
    current: period.kind === "recent" && period.days === d,
  }));
  if (cutover !== null) links.push({ key: "baseline", label: `전환 후 첫 ${BASELINE_DAYS / 7}주 (기준선)`, href: `${METRICS_PATH}?period=baseline`, current: period.kind === "baseline" });
  return links;
}

/** 기간 글자 — "2026-09-19 ~ 2026-10-18 (30일, 한국 날짜)" */
export const periodText = (p: Period): string => `${p.from} ~ ${p.to} (${p.days}일, 한국 날짜)`;
