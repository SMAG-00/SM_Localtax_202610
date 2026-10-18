// 기사 생산·제휴 준비 대시보드(/admin/news-readiness)의 화면 값 — 지표 이름·정의 글자(분자·분모·제외 조건)·숫자 글자·안내 문구. 순수 모듈 (시험 readiness-view.test.ts)
// 내부 정의 글자는 여기, 공식 정의 글자는 확정된 규정 버전의 요건 항목(numeratorText·denominatorText·exclusionsText)을 그대로 보인다 (NAV-14 '분모·제외 조건을 따로 표시').
// 화면 글자에 네이버의 결정을 대신하는 말('인정'·'예상 점수'·'예측'·'판정')과 보장 문구를 쓰지 않는다 (NAV-14 · NAV-16 · PRD-01A 4.17 — 시험이 이 모듈 글자를 모두 읽는다).
import { formatCount } from "@/lib/admin/metrics-view";
import { CONTENT_TYPE_LABELS, REPORTING_METHOD_LABELS } from "@/lib/admin/labels";
import type { Comparison, InternalMetrics, OfficialValue } from "@/lib/readiness/production";
import { ASSIGNMENT_KIND_LABELS, type ArticleFilter, type Platform, type PlatformState, type RequirementItem } from "@/lib/readiness/requirements";
import { WINDOW_BASIS_LABELS, type MonthWindow } from "@/lib/readiness/windows";

export const READINESS_PATH = "/admin/news-readiness";
export const REQUIREMENTS_PATH = "/admin/news-readiness/requirements";

/** 이 화면에 쓰지 않는 낱말 — 네이버의 결정을 대신하거나 결과를 보장하는 말 */
export const BANNED_WORDS = ["인정", "예상 점수", "예측", "판정", "선정 예정", "제휴 확정", "네이버 제휴 언론사"] as const;

export const UNDETERMINED = "요건 미확정";
/** 카카오 규정 버전이 하나도 없을 때 (NAV-22) */
export const NOT_REVIEWED = "검토 전";
export const READINESS_NOTICE = "내부 준비 지표입니다 — 네이버 심사 점수가 아닙니다. 제휴 선정은 네이버가 정합니다.";
export const SIMILARITY_NOTICE =
  "중복·표절 검토용 경고입니다 — 편집국이 원고를 다시 살펴보라는 알림이고, 네이버 심사와 관계없는 내부 점검이며 점수가 아닙니다.";
export const CAPACITY_GUIDANCE =
  "지금 생산량으로는 이 규정 요건을 채우지 못합니다. 취재 인력·역량을 먼저 보강하거나 신청을 미루세요. 비슷한 기사를 한꺼번에 많이 내서 숫자를 맞추지 않습니다 (NAV-13).";
export const UNDETERMINED_NOTE =
  "공식 규정 원문·확인일·등록 유형을 적고 담당자가 확정한 버전이 없어, 공식 정의 숫자와 기준 비교를 보이지 않습니다. 아래 내부 정의 숫자만 봅니다.";
export const OFFICIAL_NOTE = "규정 버전에 적힌 정의로 센 숫자입니다. 기준 비교는 그 버전의 심사 대상 기간 한 칸에서만 합니다.";
export const BASE_NOTE = "두 정의 모두 지금 공개 중이고 그 기간에 처음 발행된 기사에서 셉니다. 보류·삭제로 내린 기사와 이관(옛 사이트) 기사는 빼고 따로 보입니다.";

export interface ReadinessDefinition {
  title: string;
  owner: string;
  numerator: string;
  denominator: string;
  exclusions: string;
  note?: string;
}

/** 내부 정의 — PRD-01A NAV-14 · 4.17.2 · PRD_최종 §7.2 */
export const INTERNAL_DEFINITIONS = {
  total: {
    title: "총 발행",
    owner: "NAV-14",
    numerator: "그 기간에 처음 발행되어 지금 공개 중인 기사 전부 (금주 핫뉴스·칼럼·광고도 넣습니다)",
    denominator: "없음 (건수)",
    exclusions: "보류·삭제로 내린 기사, 이관(옛 사이트) 기사",
  },
  own: {
    title: "자체 취재 후보",
    owner: "NAV-14 · NAV-04",
    numerator: "유형이 보도(reported_news)인 기사 — 취재 근거·편집 승인을 거쳐 발행된 기사",
    denominator: "총 발행",
    exclusions: "금주 핫뉴스·칼럼·광고·공동 기획·해설·가이드, 유형이 없는 기사",
    note: "편집국 안의 표시입니다. 네이버가 자체 생산 기사로 보는 범위와 다를 수 있습니다.",
  },
  methods: {
    title: "정량형·정성형·혼합형",
    owner: "NAV-09 · NAV-14",
    numerator: "자체 취재 후보 가운데 그 취재 방식으로 적힌 기사 (취재 방식이 비어 있으면 '취재 방식 없음')",
    denominator: "자체 취재 후보",
    exclusions: "자체 취재 후보가 아닌 기사",
  },
  feature: {
    title: "기획·심층 기사",
    owner: "NAV-14 · NAV-21",
    numerator: "기사 기획 종류가 기획·탐사인 기획에서 나온 기사",
    denominator: "총 발행",
    exclusions: "기획 없이 쓴 기사, 일반 기획에서 나온 기사",
  },
  missingEvidence: {
    title: "근거 누락",
    owner: "NAV-12 · NAV-14",
    numerator: "자체 취재 후보 가운데 확인된 비공개 취재 근거가 하나도 없는 기사",
    denominator: "자체 취재 후보",
    exclusions: "자체 취재 후보가 아닌 기사",
  },
  missingRights: {
    title: "권리 누락",
    owner: "NAV-04 · NAV-14",
    numerator: "쓴 이미지(대표·본문·동영상 썸네일) 가운데 권리 확인이 안 된 것이 있거나, 권리가 '미확인'인 취재 근거가 있는 기사",
    denominator: "총 발행",
    exclusions: "없음",
  },
  missingDesk: {
    title: "편집 승인 누락",
    owner: "NAV-12 · NAV-14",
    numerator: "가장 최근 편집 승인 기록이 승인이 아닌 기사",
    denominator: "총 발행",
    exclusions: "없음",
  },
  missingTaxReview: {
    title: "세무 감수 누락",
    owner: "NAV-03 · NAV-14",
    numerator: "세무 감수가 필요한데 감수 승인이 없는 기사 (감수 대기·반려·보류)",
    denominator: "세무 감수가 필요한 기사",
    exclusions: "세무 감수 대상이 아닌 기사",
  },
  corrections: {
    title: "정정·반론",
    owner: "NAV-06 · NAV-14",
    numerator: "그 기간에 결정된 정정·반론·추후보도 기록 (어느 기사든)",
    denominator: "없음 (건수)",
    exclusions: "삭제·제목 변경 기록",
  },
  similarity: {
    title: "기사 유사도 사전 경고 (중복·표절 검토용 경고)",
    owner: "OPT-06 · NAV-14",
    numerator: "그 기간 발행 점검에서 유사 문장 기준을 넘은 원고 수(발행되지 않은 원고도 넣습니다) · 비교 원문이 없거나 점검 기록이 없어 유사도를 확인하지 못한 발행 기사 수",
    denominator: "없음 (건수)",
    exclusions: "기준 안에 든 점검",
    note: SIMILARITY_NOTICE,
  },
  reader: {
    title: "독자 반응 (사람만)",
    owner: "GROW-01 · NAV-14",
    numerator: "그 기간에 발행한 기사가 지금까지 받은 조회·30초 이상 열람·공유 (1시간마다 집계)",
    denominator: "30초 이상 열람은 조회 대비",
    exclusions: "봇·편집국·관리자 방문, 같은 방문자의 30분 안 반복",
  },
} as const satisfies Record<string, ReadinessDefinition>;
export type InternalDefinitionKey = keyof typeof INTERNAL_DEFINITIONS;

/** 비율 칸 — "분자 / 분모 · 소수 한 자리 %", 분모 0이면 '—' (0%로 보이지 않게) */
export function ratioCell(numerator: number, denominator: number): string {
  if (denominator === 0) return `${formatCount(numerator)} / 0 · —`;
  const pct = Math.round((numerator / denominator) * 1000) / 10;
  return `${formatCount(numerator)} / ${formatCount(denominator)} · ${Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1)}%`;
}

export interface InternalRow {
  id: string;
  label: string;
  definition: InternalDefinitionKey;
  value: (m: InternalMetrics) => string;
}
export interface InternalTable {
  id: string;
  title: string;
  rows: InternalRow[];
}

const count = (n: number) => formatCount(n);

/** 내부 정의 표 — 줄마다 기간 칸 (화면이 기간 수만큼 칸을 그린다) */
export const INTERNAL_TABLES: readonly InternalTable[] = [
  {
    id: "production",
    title: "기사 생산",
    rows: [
      { id: "total", label: "총 발행", definition: "total", value: (m) => count(m.total) },
      { id: "own", label: "자체 취재 후보", definition: "own", value: (m) => ratioCell(m.own, m.total) },
      { id: "quantitative", label: "정량형", definition: "methods", value: (m) => ratioCell(m.methods.quantitative, m.own) },
      { id: "qualitative", label: "정성형", definition: "methods", value: (m) => ratioCell(m.methods.qualitative, m.own) },
      { id: "mixed", label: "혼합형", definition: "methods", value: (m) => ratioCell(m.methods.mixed, m.own) },
      { id: "method-missing", label: "취재 방식 없음", definition: "methods", value: (m) => ratioCell(m.methods.missing, m.own) },
      { id: "feature", label: "기획·심층", definition: "feature", value: (m) => ratioCell(m.feature, m.total) },
    ],
  },
  {
    id: "gaps",
    title: "근거·권리·감수 누락",
    rows: [
      { id: "missing-evidence", label: "근거 누락", definition: "missingEvidence", value: (m) => ratioCell(m.missingEvidence, m.own) },
      { id: "missing-rights", label: "권리 누락", definition: "missingRights", value: (m) => ratioCell(m.missingRights, m.total) },
      { id: "missing-desk", label: "편집 승인 누락", definition: "missingDesk", value: (m) => ratioCell(m.missingDesk, m.total) },
      { id: "missing-tax", label: "세무 감수 누락", definition: "missingTaxReview", value: (m) => ratioCell(m.missingTaxReview, m.taxReviewNeeded) },
    ],
  },
  {
    id: "corrections",
    title: "정정·반론",
    rows: [
      { id: "correction", label: "정정", definition: "corrections", value: (m) => count(m.corrections.correction) },
      { id: "rebuttal", label: "반론", definition: "corrections", value: (m) => count(m.corrections.rebuttal) },
      { id: "follow-up", label: "추후보도", definition: "corrections", value: (m) => count(m.corrections.follow_up) },
    ],
  },
  {
    id: "similarity",
    title: "기사 유사도 사전 경고 (중복·표절 검토용 경고)",
    rows: [
      { id: "blocked", label: "유사 문장 기준을 넘은 원고", definition: "similarity", value: (m) => count(m.similarity.blocked) },
      { id: "unverified", label: "유사도를 확인하지 못한 발행 기사", definition: "similarity", value: (m) => count(m.similarity.unverified) },
    ],
  },
  {
    id: "reader",
    title: "독자 반응 (사람만)",
    rows: [
      { id: "views", label: "조회", definition: "reader", value: (m) => count(m.reader.views) },
      { id: "engaged", label: "30초 이상 열람", definition: "reader", value: (m) => ratioCell(m.reader.engaged, m.reader.views) },
      { id: "shares", label: "공유", definition: "reader", value: (m) => count(m.reader.shares) },
    ],
  },
];

/** 표 아래 정의 — 같은 정의는 한 번 */
export function tableDefinitions(t: InternalTable): ReadinessDefinition[] {
  return [...new Set(t.rows.map((r) => r.definition))].map((k) => INTERNAL_DEFINITIONS[k]);
}

export function windowLabel(w: MonthWindow): { title: string; range: string } {
  return { title: `${w.months}개월`, range: `${w.from} ~ ${w.to}` };
}

export const basisLabel = (w: Pick<MonthWindow, "basis">) => WINDOW_BASIS_LABELS[w.basis];

// ── 공식 정의 칸 ─────────────────────────────────────────

const one = (n: number) => {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1);
};

export function officialCell(item: RequirementItem, v: OfficialValue): string {
  if (item.metric === "ratio") return ratioCell(v.numerator, v.denominator ?? 0);
  if (item.metric === "count") return formatCount(v.numerator);
  return `${formatCount(v.numerator)} / ${formatCount(v.denominator ?? 0)}명 · ${v.value === null ? "—" : `1인당 ${one(v.value)}`}`;
}

const COMPARATOR_WORDS = { gte: "이상", gt: "초과" } as const;

export function criterionText(item: RequirementItem): string {
  const c = item.criterion;
  if (!c) return "기준 없음 (숫자만 봅니다)";
  const word = COMPARATOR_WORDS[c.comparator];
  if (item.metric === "ratio") return `${c.value}% ${word}`;
  const per = c.per === "month" ? "월평균 " : item.metric === "count" ? "심사 기간 " : "";
  return item.metric === "per_reporter" ? `기자 1인당 ${per}${c.value}건 ${word}` : `${per}${c.value}건 ${word}`;
}

export function comparisonText(item: RequirementItem, c: Comparison): string {
  if (c.kind === "none") return "—";
  const word = c.kind === "met" ? "충족" : "미달";
  if (c.compared === null) return `${word} (기사 없음)`;
  if (item.metric === "ratio") return `${word} (${one(c.compared)}%)`;
  const month = item.criterion?.per === "month" ? "월평균 " : "";
  return item.metric === "per_reporter" ? `${word} (1인당 ${month}${one(c.compared)}건)` : `${word} (${month}${one(c.compared)}건)`;
}

/** 요건 거르개 글자 — 고른 값 이름, 비우면 모든 공개 기사 */
export function filterText(f: ArticleFilter): string {
  const parts: string[] = [];
  if (f.contentTypes) parts.push(`유형 ${f.contentTypes.map((t) => CONTENT_TYPE_LABELS[t as keyof typeof CONTENT_TYPE_LABELS] ?? t).join("·")}`);
  if (f.reportingMethods) parts.push(`취재 방식 ${f.reportingMethods.map((t) => REPORTING_METHOD_LABELS[t as keyof typeof REPORTING_METHOD_LABELS] ?? t).join("·")}`);
  if (f.assignmentKinds) parts.push(`기획 종류 ${f.assignmentKinds.map((t) => ASSIGNMENT_KIND_LABELS[t as keyof typeof ASSIGNMENT_KIND_LABELS] ?? t).join("·")}`);
  if (f.includeLegacy) parts.push("이관 기사 포함");
  return parts.length ? parts.join(" · ") : "모든 공개 기사 (이관 기사 제외)";
}

export const METRIC_LABELS = { count: "기사 수", ratio: "비율", per_reporter: "기자 1인당" } as const;

// ── 기자·추적 표 ─────────────────────────────────────────

export function personKind(p: { roles: readonly string[]; employment: string | null }): string {
  if (p.employment === "external") return "외부 필자";
  if (p.roles.includes("editor")) return "편집 책임자";
  if (p.roles.includes("reporter")) return "기자";
  if (p.roles.includes("writer")) return "필자";
  return "편집국";
}

export const SIMILARITY_STATUS_LABELS: Readonly<Record<string, string>> = {
  pass: "기준 안",
  blocked: "기준 넘음 — 다시 살펴보기",
  no_sources: "비교 원문 없음",
  no_body: "본문 문장 없음",
};
export const similarityLabel = (status: string | null) => (status === null ? "점검 기록 없음" : (SIMILARITY_STATUS_LABELS[status] ?? status));

/** 추적 표 상한 — 화면 보호 값 (지표 정의가 아니다) */
export const TRACE_LIMIT = 100;

// ── 기사 할당량 (기사 기획 캘린더 — NAV-09 · NAV-13) ─────

export interface QuotaLine {
  platform: Platform;
  confirmed: boolean;
  text: string;
}

/** 기사 할당량 = 확정된 규정 버전의 기사 수·기자 1인당 기준. 확정 버전이 없으면 '요건 미확정' — 임의 할당량을 적는 칸은 없다 (NAV-09) */
export function quotaLines(states: readonly { platform: Platform; state: PlatformState }[]): QuotaLine[] {
  return states.map(({ platform, state }) => {
    if (state.kind !== "confirmed") return { platform, confirmed: false, text: `${UNDETERMINED} — ${state.reason}` };
    const quotas = state.items.filter((i) => i.criterion !== null && (i.metric === "count" || i.metric === "per_reporter"));
    const body = quotas.length ? quotas.map((i) => `${i.label}: ${criterionText(i)}`).join(" · ") : "기사 수 기준이 없습니다";
    return { platform, confirmed: true, text: `규정 ${state.row.version}번 — ${body}` };
  });
}

export const QUOTA_NOTE = "할당량은 확정된 공식 규정 버전에서만 나옵니다 — 따로 적는 할당량은 없습니다. 비슷한 기사를 한꺼번에 많이 내서 숫자를 맞추지 않습니다 (NAV-09 · NAV-13).";
