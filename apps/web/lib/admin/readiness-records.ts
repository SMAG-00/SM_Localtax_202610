// 제휴 준비 기록 API 입력 검사 (W7 · NAV-16·18·19·20) — 순수 모듈 (시험 readiness-records.test.ts). 화면과 API가 같은 함수를 쓴다.
//  · 숫자(유사 비율·부정평가 창/경고 점수)는 담당자가 규정 원문을 보고 입력한다 — 이 파일에 기본값 0
import { isMonth } from "@/lib/readiness/monthly";
import type { Parsed } from "@/lib/seo/ai-citation";

export const RECORD_OPS = ["rules_save", "penalty_add", "monthly_recalc", "alert_ack"] as const;
export type RecordOp = (typeof RECORD_OPS)[number];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
const COMPARATORS = ["gt", "gte"];

export interface RulesInput {
  requirementId: number;
  similarity_rule: Obj | null;
  penalty_rule: Obj | null;
  contributor_rule: Obj | null;
}

const ratio = (v: unknown) => typeof v === "number" && v >= 0 && v <= 1;

/** null = 비움(규정 값 없음 → 내부 기준·부정평가 기준 없음·합산 안 함), 객체 = 값 */
export function parseRulesSave(body: Obj): Parsed<RulesInput> {
  const errors: string[] = [];
  if (!isId(body.requirement_id)) errors.push("requirement_id: 규정 버전 번호가 필요합니다");
  const pick = (key: string): Obj | null => {
    const v = body[key];
    if (v === undefined || v === null) return null;
    if (!isObj(v)) {
      errors.push(`${key}: 객체이거나 비워야 합니다`);
      return null;
    }
    return v;
  };
  const similarity = pick("similarity_rule");
  if (similarity) {
    if (!ratio(similarity.sentence_similarity)) errors.push("similarity_rule.sentence_similarity: 0~1 비율이어야 합니다");
    if (!ratio(similarity.article_ratio)) errors.push("similarity_rule.article_ratio: 0~1 비율이어야 합니다");
    if (!COMPARATORS.includes(similarity.sentence_comparator as string)) errors.push("similarity_rule.sentence_comparator: gt(초과)·gte(이상) 중 하나입니다");
    if (!COMPARATORS.includes(similarity.article_comparator as string)) errors.push("similarity_rule.article_comparator: gt(초과)·gte(이상) 중 하나입니다");
  }
  const penalty = pick("penalty_rule");
  if (penalty) {
    if (!(typeof penalty.window_months === "number" && Number.isInteger(penalty.window_months) && penalty.window_months >= 1 && penalty.window_months <= 60)) errors.push("penalty_rule.window_months: 1~60 정수여야 합니다");
    if (!(typeof penalty.warn_points === "number" && penalty.warn_points > 0)) errors.push("penalty_rule.warn_points: 0보다 큰 숫자여야 합니다");
    if (!COMPARATORS.includes(penalty.comparator as string)) errors.push("penalty_rule.comparator: gt(초과)·gte(이상) 중 하나입니다");
  }
  const contributor = pick("contributor_rule");
  if (contributor && typeof contributor.merge_external !== "boolean") errors.push("contributor_rule.merge_external: true 또는 false여야 합니다");
  if (errors.length) return { ok: false, errors };
  const only = (o: Obj | null, keys: string[]) => (o ? Object.fromEntries(keys.map((k) => [k, o[k]])) : null);
  return {
    ok: true,
    value: {
      requirementId: body.requirement_id as number,
      similarity_rule: only(similarity, ["sentence_similarity", "sentence_comparator", "article_ratio", "article_comparator"]),
      penalty_rule: only(penalty, ["window_months", "warn_points", "comparator"]),
      contributor_rule: only(contributor, ["merge_external"]),
    },
  };
}

export interface PenaltyInput {
  item: string;
  points: number;
  occurredOn: string;
  evidenceRef: string | null;
  supersedesId: number | null;
}

const dateOk = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

export function parsePenaltyAdd(body: Obj): Parsed<PenaltyInput> {
  const errors: string[] = [];
  const item = typeof body.item === "string" ? body.item.trim() : "";
  if (item === "" || [...item].length > 200) errors.push("item: 위반 우려 사례를 1~200자로 적어 주세요");
  if (!(typeof body.points === "number" && Number.isFinite(body.points) && body.points > 0 && body.points <= 1000)) errors.push("points: 0보다 크고 1000 이하인 점수가 필요합니다");
  const occurredOn = typeof body.occurred_on === "string" ? body.occurred_on : "";
  if (!dateOk(occurredOn)) errors.push("occurred_on: 일어난 날(YYYY-MM-DD)이 필요합니다");
  const evidence = typeof body.evidence_ref === "string" && body.evidence_ref.trim() !== "" ? body.evidence_ref.trim() : null;
  if (evidence !== null && [...evidence].length > 500) errors.push("evidence_ref: 500자 이하여야 합니다");
  const supersedes = body.supersedes_id === undefined || body.supersedes_id === null ? null : body.supersedes_id;
  if (supersedes !== null && !isId(supersedes)) errors.push("supersedes_id: 고치려는 기록 번호여야 합니다");
  return errors.length ? { ok: false, errors } : { ok: true, value: { item, points: body.points as number, occurredOn, evidenceRef: evidence, supersedesId: supersedes as number | null } };
}

export function parseRecalc(body: Obj): Parsed<{ month: string; reason: string }> {
  const errors: string[] = [];
  if (typeof body.month !== "string" || !isMonth(body.month)) errors.push("month: YYYY-MM 모양이어야 합니다");
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason === "") errors.push("reason: 재계산 사유를 적어 주세요");
  else if ([...reason].length > 500) errors.push("reason: 500자 이하여야 합니다");
  return errors.length ? { ok: false, errors } : { ok: true, value: { month: body.month as string, reason } };
}

export function parseAlertAck(body: Obj): Parsed<{ id: number }> {
  return isId(body.id) ? { ok: true, value: { id: body.id } } : { ok: false, errors: ["id: 알림 번호가 필요합니다"] };
}
