// 지역 기사 편집 게이트 운영 규칙 (W4 7단계 — docs/dev/W4_설계.md 1장 7단계 · 2.1 · 2.2 · 6장 · 12장 #7, PRD-01B REG1-17) — 순수 함수
// 운영 설정(regional_judge_fields)·편집자 판정 API(/api/admin/regions op judge)·편집 승인 API(지역 기사 3항목·이해관계 표시)·편집 화면이 같은 검사를 쓴다.
// DB 트리거(마이그레이션 20261022000043 regional_settings_guard · articles_regional_gate · editorial_reviews_regional_guard)와 같은 규칙 — 한쪽만 바꾸지 않는다.
import {
  EDITORIAL_FIELDS,
  EDITORIAL_JUDGEMENTS,
  NON_NEWS_BLOCKED_TYPES,
  REGIONAL_DESK_CHECKLIST,
  STALE_STATISTICS_DAYS_DEFAULT,
  STALE_STATISTICS_DAYS_MAX,
  STALE_STATISTICS_DAYS_MIN,
  REGIONAL_DESK_CHECKLIST_LABELS,
  isNonNewsJudgement,
  missingRegionalChecks,
  type EditorialField,
  type EditorialJudgement,
} from "@ltr/editorial";

/** settings.regional_judge_fields 값 → 편집 분야 목록. 모양이 틀리면 null */
export function parseRegionalJudgeFields(value: unknown): EditorialField[] | null {
  if (!Array.isArray(value) || value.length > EDITORIAL_FIELDS.length) return null;
  if (!value.every((v) => typeof v === "string" && (EDITORIAL_FIELDS as readonly string[]).includes(v))) return null;
  if (new Set(value).size !== value.length) return null;
  return value as EditorialField[];
}

/** 운영 설정 화면 검사 — 문장 목록 (빈 목록이면 저장). 빈 배열도 저장된다 = 모든 분야 판정 책임자 없음(지역 기사 전부 보류) */
export function regionalJudgeFieldsErrors(value: unknown): string[] {
  if (!Array.isArray(value)) return ["값: 편집 분야 목록이어야 합니다 (예: [\"local_tax\", \"realestate\"])"];
  const errors: string[] = [];
  value.forEach((v, i) => {
    if (typeof v !== "string" || !(EDITORIAL_FIELDS as readonly string[]).includes(v)) errors.push(`[${i}]: ${EDITORIAL_FIELDS.join("·")} 중 하나여야 합니다`);
    else if (value.indexOf(v) !== i) errors.push(`[${i}]: 같은 편집 분야가 앞에 있습니다`);
  });
  return errors;
}

/** 편집자 판정 요청 { op: "judge", articleId, judgement(null = 판정 지우기), note? } */
export interface JudgeInput {
  articleId: number;
  judgement: EditorialJudgement | null;
  note: string | null;
}

export function parseJudgeInput(raw: Record<string, unknown>): { ok: true; value: JudgeInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  for (const key of Object.keys(raw)) if (!["op", "articleId", "judgement", "note"].includes(key)) errors.push(`${key}: 모르는 칸입니다`);
  const id = raw.articleId;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) errors.push("articleId: 1 이상의 기사 번호여야 합니다");
  const j = raw.judgement;
  if (j === undefined) errors.push(`judgement: 필요합니다 (${EDITORIAL_JUDGEMENTS.join("·")} 또는 null = 판정 지우기)`);
  else if (j !== null && (typeof j !== "string" || !(EDITORIAL_JUDGEMENTS as readonly string[]).includes(j))) {
    errors.push(`judgement: ${EDITORIAL_JUDGEMENTS.join("·")} 중 하나이거나 null이어야 합니다`);
  }
  const note = raw.note;
  if (note !== undefined && note !== null && (typeof note !== "string" || note.length > 500)) errors.push("note: 500자 이하 글자여야 합니다");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { articleId: id as number, judgement: (j ?? null) as EditorialJudgement | null, note: typeof note === "string" && note.trim() ? note.trim() : null } };
}

/**
 * 공개(예약) 중인 원고에 비보도 판정을 걸 수 없다 — 먼저 내린다 (DB 트리거와 같은 문장 뜻).
 * 보도·해설은 7단계 규칙(REG1-17), 그 밖의 유형도 8단계부터 — 비보도 판정은 별도 상품 검토 큐 1건을 열고, 큐 원고는 공개 0이다 (REG1-14·17)
 */
export function judgeConflict(article: { status: string; content_type: string | null }, judgement: EditorialJudgement | null): string | null {
  if (!isNonNewsJudgement(judgement)) return null;
  if (!["published", "scheduled"].includes(article.status)) return null;
  if ((NON_NEWS_BLOCKED_TYPES as readonly (string | null)[]).includes(article.content_type)) {
    return "공개(예약) 중인 보도기사·해설은 여행 후기·맛집 추천·행사 홍보로 판정할 수 없습니다 — 먼저 내린 뒤 판정하세요 (REG1-17)";
  }
  return "공개(예약) 중인 원고는 여행 후기·맛집 추천·행사 홍보로 판정해 별도 상품 검토 큐로 보낼 수 없습니다 — 먼저 내린 뒤 판정하세요 (REG1-14·17)";
}

/** 운영 설정 stale_statistics_days 검사 — 1~3650 정수 (DB 트리거 settings_stale_statistics_guard와 같다, W4 8단계 REG1-14) */
export function staleStatisticsDaysErrors(value: unknown): string[] {
  return typeof value === "number" && Number.isInteger(value) && value >= STALE_STATISTICS_DAYS_MIN && value <= STALE_STATISTICS_DAYS_MAX
    ? []
    : [`값: ${STALE_STATISTICS_DAYS_MIN}~${STALE_STATISTICS_DAYS_MAX} 정수여야 합니다 (REG1-14 초기값 ${STALE_STATISTICS_DAYS_DEFAULT})`];
}

// ── 별도 상품 검토 큐 (W4 8단계 — REG1-14·17, 3장 separate_product_queue · 6장 regional.judge) ──

/** 닫기 메모 한도 — DB 칸 검사와 같다 */
export const QUEUE_NOTE_MAX = 500;

/** 검토 닫기 요청 { op: "close", itemId, note } — 메모(결정 사유)는 필수 */
export interface CloseInput {
  itemId: number;
  note: string;
}

export function parseCloseInput(raw: Record<string, unknown>): { ok: true; value: CloseInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  for (const key of Object.keys(raw)) if (!["op", "itemId", "note"].includes(key)) errors.push(`${key}: 모르는 칸입니다`);
  const id = raw.itemId;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) errors.push("itemId: 1 이상의 항목 번호여야 합니다");
  const note = raw.note;
  if (typeof note !== "string" || !note.trim()) errors.push("note: 닫는 사유(결정)를 적어야 합니다 — 예: 광고·협찬 상품으로 전환, 행사안내로 등록(W6), 폐기");
  else if (note.length > QUEUE_NOTE_MAX) errors.push(`note: ${QUEUE_NOTE_MAX}자 이하여야 합니다`);
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { itemId: id as number, note: (note as string).trim() } };
}

/** /admin/regions 지역 기사 묶음 — 편집 분야 승인 대기 · 보류 (편집 승인 상태·게재 상태로만 나눈다 — 판정 상태는 편집 화면이 계산) */
export interface RegionalDeskRow {
  id: number;
  title: string;
  status: string;
  editorial_status: string;
  editorial_field: string | null;
  editorial_judgement: string | null;
  updated_at: string;
}

export function groupRegionalDesk<T extends RegionalDeskRow>(rows: readonly T[], openArticleIds: ReadonlySet<number>): { awaiting: T[]; held: T[] } {
  const awaiting: T[] = [];
  const held: T[] = [];
  for (const r of rows) {
    if (openArticleIds.has(Number(r.id))) continue; // 별도 상품 검토 큐에 있는 원고는 큐 쪽에만
    if (["published", "scheduled", "deleted"].includes(r.status)) continue;
    if (r.status === "held" || r.editorial_status === "held") held.push(r);
    else if (r.editorial_status !== "approved") awaiting.push(r);
  }
  return { awaiting, held };
}

/** 지역 기사 편집 승인(desk_edit approve)의 checklist 오류 — `checklist.<키>: 문장` (편집 승인 API 422·편집 화면 칸 오류 같은 글자) */
export function regionalChecklistErrors(checklist: Readonly<Record<string, unknown>>): string[] {
  return missingRegionalChecks(checklist).map((k) => `checklist.${k}: 지역 기사 편집 승인에는 ${REGIONAL_DESK_CHECKLIST_LABELS[k as (typeof REGIONAL_DESK_CHECKLIST)[number]].split(" — ")[0]} 확인이 필요합니다 (REG1-17)`);
}

/** 광고·협찬 계약 기록이 있는 제휴사 — 계약 시작일·종료일 중 하나라도 있음 (DB 트리거와 같은 기준) */
export function contractedPartners<T extends { contract_from: string | null; contract_to: string | null }>(partners: readonly T[]): T[] {
  return partners.filter((p) => p.contract_from !== null || p.contract_to !== null);
}
