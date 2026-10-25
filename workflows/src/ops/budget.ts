// 운영 AI 비용·월 예산 (W10-e - AIOPS-04). 순수 함수. 단가·월 한도·경보 비율은 settings.ops_ai_budget에서 오고 코드에 값을 두지 않는다
// (경보 비율의 기본 0.8만 PRD "예산 80% 도달 시 알림"의 값이다).

export const DEFAULT_WARN_RATIO = 0.8;

export interface ModelPrice {
  /** 100만 토큰당 입력 단가 */
  inputPerMTok: number;
  outputPerMTok: number;
}

export interface OpsBudget {
  /** 월 한도 (cost_unit 기준) */
  limit: number;
  warnRatio: number;
  unit: string;
  prices: Record<string, ModelPrice>;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** 설정 값 -> 예산. 한도가 없거나 0 이하면 null - 운영 AI 호출 0 (비어 있는 씨앗) */
export function parseBudget(value: unknown): OpsBudget | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const limit = num(o.monthly_limit);
  if (limit === null || limit <= 0) return null;
  const unit = typeof o.unit === "string" && /^[A-Z]{3}$/.test(o.unit) ? o.unit : null;
  if (unit === null) return null;
  const ratio = num(o.warn_ratio);
  const prices: Record<string, ModelPrice> = {};
  if (o.prices && typeof o.prices === "object") {
    for (const [model, p] of Object.entries(o.prices as Record<string, unknown>)) {
      const price = p as Record<string, unknown> | null;
      const i = num(price?.input_per_mtok);
      const out = num(price?.output_per_mtok);
      if (i !== null && out !== null) prices[model] = { inputPerMTok: i, outputPerMTok: out };
    }
  }
  return { limit, warnRatio: ratio !== null && ratio > 0 && ratio <= 1 ? ratio : DEFAULT_WARN_RATIO, unit, prices };
}

export type BudgetLevel = "ok" | "warn" | "exceeded";

const MICRO = 1_000_000;

/** 지출이 한도의 경보 비율 이상이면 warn, 한도 이상이면 exceeded. 정수(백만분의 1 단위)로 비교해 79.9999%와 80%가 갈린다 */
export function budgetLevel(spent: number, limit: number, warnRatio: number = DEFAULT_WARN_RATIO): BudgetLevel {
  const s = Math.round(spent * MICRO);
  const l = Math.round(limit * MICRO);
  const pct = Math.round(warnRatio * 100);
  if (s >= l) return "exceeded";
  if (s * 100 >= l * pct) return "warn";
  return "ok";
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** 실행 비용 - 모델 단가가 설정에 없으면 null (비용을 지어내지 않는다) */
export function costOf(usage: TokenUsage, model: string, budget: OpsBudget): number | null {
  const p = budget.prices[model];
  if (!p) return null;
  const c = (usage.inputTokens / MICRO) * p.inputPerMTok + (usage.outputTokens / MICRO) * p.outputPerMTok;
  return Math.round(c * MICRO) / MICRO;
}
