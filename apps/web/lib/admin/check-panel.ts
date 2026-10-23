// 최적화 점검 패널 (OPT-03) — GET /api/admin/articles/[id]/check 와 발행 422 응답을 화면 목록으로 묶는다. 순수 함수 (시험: check-panel.test.ts)
//  · 차단(발행 불가)과 경고(발행 가능, 발행 기록에 남음)를 나누고, 항목마다 규칙 이름·한국어 문장·위치를 붙인다.
//  · 점수는 축별 0~100 — 내부 품질 지표다. 점수 옆 고정 문구(SCORE_DISCLAIMER) 말고는 패널 문구에 '순위'·'노출 예측'·'상위 노출'을 쓰지 않는다.
import { RULES, type Finding, type FindingLocation } from "@ltr/editorial";
import { BLOCK_TYPE_LABELS } from "./labels";

export interface LintItemView {
  id: string;
  axis: string;
  name: string;
  level: string;
  message: string;
  applicable: boolean;
}

/** 점검 응답 — lib/server/articles/report.ts gateReport()와 같은 모양 */
export interface CheckReport {
  canPublish: boolean;
  failed: string[];
  warnings: string[];
  findings: Finding[];
  taxReviewReasons: string[];
  seoLint: {
    disclaimer: string;
    ruleVersion: string;
    engineVersion: string;
    scores: Record<string, number>;
    blockers: string[];
    warnings: string[];
    items: LintItemView[];
  };
}

export interface PanelItem {
  /** 화면 key — 같은 규칙이 여러 위치에 걸리면 여러 줄 */
  key: string;
  /** 규칙 ID (최적화 점검 항목은 점검 ID) */
  id: string;
  ruleRef: string;
  title: string;
  message: string;
  where: string | null;
}

export interface PanelView {
  blockers: PanelItem[];
  /** 경고 — 지역 기사 편집 경고(REG1-14)를 뺀 나머지 */
  warnings: PanelItem[];
  /** 지역 기사 편집 경고 4종 (REG1-14 — 보도자료 재게시·근거 없는 지역 수치·사진 권리 누락·오래된 통계, W4 8단계) */
  editorialWarnings: PanelItem[];
  scores: { label: string; value: string }[];
  disclaimer: string;
  ruleVersion: string;
  taxReviewReasons: string[];
}

const RULE_TITLE = new Map<string, string>(RULES.map((r) => [r.id, r.title]));
const AXES: readonly [string, string][] = [
  ["SEO", "SEO"],
  ["AEO", "AEO"],
  ["GEO", "GEO"],
  ["공통", "공통"],
];
const LINT_FINDINGS = new Set(["opt03.seo-lint-blocker", "opt03.seo-lint-warning"]);
/** 지역 기사 편집 경고의 근거 PRD ID — 점검 패널에서 따로 묶는다 (W4 8단계) */
export const EDITORIAL_WARNING_REF = "REG1-14";

const PERSPECTIVE_NAMES: Record<string, string> = { local_gov: "지자체", residents_taxpayers: "주민·납세자", experts: "전문가" };
const SOLVED_CASE_CELLS: Record<string, string> = { situation: "상황", issue: "쟁점", result: "결과", lesson: "교훈", resultEvidence: "결과 근거" };
const FIELD_NAMES: Record<string, string> = {
  title: "제목",
  summary: "요약",
  slug: "주소(slug)",
  taxLens: "「지방세로 읽기」",
  datasets: "취재 근거 재현 정보",
  interviews: "인터뷰 기록",
  evidence: "취재 근거",
  sources: "출처",
  leadImage: "대표 이미지",
  reviews: "검토 기록",
  partner: "제휴사",
  // W4 7단계 지역 기사 게이트 (REG1-17)
  regionCodes: "지역 코드",
  editorialField: "편집 분야",
  publicQuestion: "공익적 질문",
  relationTypes: "관계 유형",
  editorialJudgement: "편집자 판정",
  interestDisclosure: "이해관계 표시",
  coversBillStatus: "법안 상태를 다룸",
  columnInterest: "부동산 칼럼 이해관계(조합·시공사·신탁사)",
  // W4 8단계 편집 경고 (REG1-14)
  "sources.referenceDate": "출처 기준일",
};

/** 위치 글자 — blockTypes는 본문 블록 종류(저장된 순서) */
export function locationText(loc: FindingLocation | undefined, blockTypes: readonly string[]): string | null {
  if (!loc || loc.field === "seoLint") return null;
  const parts: string[] = [];
  if (loc.field === "blocks" && loc.blockIndex !== undefined) {
    const type = blockTypes[loc.blockIndex];
    const name = type ? (BLOCK_TYPE_LABELS as Record<string, string>)[type] : undefined;
    parts.push(`본문 ${loc.blockIndex + 1}번째 블록${name ? `(${name})` : ""}`);
  } else if (loc.field === "blocks") {
    parts.push("본문");
  } else if (loc.field.startsWith("solvedCase.")) {
    const cell = loc.field.slice("solvedCase.".length);
    parts.push(`해결 사례 — ${SOLVED_CASE_CELLS[cell] ?? cell}`);
  } else if (loc.field.startsWith("copy:")) {
    parts.push("화면 문구");
  } else if (loc.field === "perspectives") {
    parts.push("관점별 기록");
    if (loc.phrase) parts.push(PERSPECTIVE_NAMES[loc.phrase] ?? loc.phrase);
    return parts.join(" · ");
  } else {
    parts.push(FIELD_NAMES[loc.field] ?? loc.field);
  }
  if (loc.sentenceIndex !== undefined) parts.push(`${loc.sentenceIndex + 1}번째 문장`);
  if (loc.phrase) parts.push(`‘${loc.phrase}’`);
  return parts.join(" · ");
}

function itemOf(f: Finding, index: number, report: CheckReport, blockTypes: readonly string[]): PanelItem {
  if (LINT_FINDINGS.has(f.id) && f.location?.phrase) {
    const lintId = f.location.phrase;
    const lint = report.seoLint.items.find((i) => i.id === lintId);
    return { key: `${lintId}-${index}`, id: lintId, ruleRef: "OPT-03", title: lint?.name ?? lintId, message: lint?.message ?? f.message, where: null };
  }
  return {
    key: `${f.id}-${index}`,
    id: f.id,
    ruleRef: f.ruleRef,
    title: RULE_TITLE.get(f.id) ?? f.id,
    message: f.message,
    where: locationText(f.location, blockTypes),
  };
}

const isScore = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 100;

export function panelView(report: CheckReport, blockTypes: readonly string[]): PanelView {
  const items = report.findings.map((f, i) => ({ f, item: itemOf(f, i, report, blockTypes) }));
  return {
    blockers: items.filter((x) => x.f.level === "block").map((x) => x.item),
    warnings: items.filter((x) => x.f.level === "warn" && x.f.ruleRef !== EDITORIAL_WARNING_REF).map((x) => x.item),
    editorialWarnings: items.filter((x) => x.f.level === "warn" && x.f.ruleRef === EDITORIAL_WARNING_REF).map((x) => x.item),
    scores: AXES.map(([axis, label]) => {
      const v = report.seoLint.scores[axis];
      return { label, value: isScore(v) ? String(v) : "—" };
    }),
    disclaimer: report.seoLint.disclaimer,
    ruleVersion: report.seoLint.ruleVersion,
    taxReviewReasons: report.taxReviewReasons,
  };
}

export const PUBLISH_COPY = {
  loading: "점검 결과를 불러오는 중입니다",
  noRole: "발행은 편집 책임자(editor)만 합니다",
  published: "이미 발행된 기사입니다",
  deleted: "삭제된 기사는 발행할 수 없습니다",
  blocked: (n: number) => `차단 항목 ${n}개를 고치면 발행할 수 있습니다`,
} as const;

/** 발행 버튼 — 차단 항목이 남거나, 발행 권한(article.publish)이 없거나, 이미 발행·삭제됐으면 꺼진다 */
export function publishButtonState({ report, canPublishRole, status }: { report: CheckReport | null; canPublishRole: boolean; status: string }): {
  disabled: boolean;
  reason: string | null;
} {
  if (status === "published") return { disabled: true, reason: PUBLISH_COPY.published };
  if (status === "deleted") return { disabled: true, reason: PUBLISH_COPY.deleted };
  if (!canPublishRole) return { disabled: true, reason: PUBLISH_COPY.noRole };
  if (report === null) return { disabled: true, reason: PUBLISH_COPY.loading };
  if (!report.canPublish || report.failed.length > 0) return { disabled: true, reason: PUBLISH_COPY.blocked(report.failed.length) };
  return { disabled: false, reason: null };
}

/** 발행 422의 실패 항목 — "규칙 이름 (ID)" */
export function failedItemNames(report: Pick<CheckReport, "failed" | "seoLint">): string[] {
  return report.failed.map((id) => {
    const title = RULE_TITLE.get(id) ?? report.seoLint.items.find((i) => i.id === id)?.name;
    return title ? `${title} (${id})` : id;
  });
}

/** 패널 고정 문구 — 점검 패널(components/admin/CheckPanel.tsx)이 이 글자만 쓰고, 시험이 금지어를 검사한다 */
export const PANEL_COPY = {
  title: "최적화 점검",
  basis: "저장된 버전 기준 점검입니다. 고친 내용은 저장한 뒤 다시 점검하세요.",
  blockers: "차단 항목 — 발행 불가",
  warnings: "경고 — 발행할 수 있고 발행 기록에 남습니다",
  editorialWarnings: "편집 경고 — 지역 기사 점검, 발행 기록에 남습니다",
  none: "없음",
  taxReasons: "세무 감수 대상 이유",
  recheck: "다시 점검",
  publish: "발행",
  publishing: "발행 중",
  published: "발행했습니다",
  publishedWithWarnings: (n: number) => `발행했습니다 — 경고 ${n}개가 발행 기록에 남았습니다`,
  publishFailed: "발행하지 못했습니다 — 남은 차단 항목",
} as const;

export const PANEL_FIXED_COPY: readonly string[] = [
  ...Object.values(PANEL_COPY).map((v) => (typeof v === "function" ? v(2) : v)),
  PUBLISH_COPY.loading,
  PUBLISH_COPY.noRole,
  PUBLISH_COPY.published,
  PUBLISH_COPY.deleted,
  PUBLISH_COPY.blocked(1),
];
