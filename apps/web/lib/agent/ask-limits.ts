// 지방세봇 설정 읽기와 비용 가드 - 순수 함수 (W12-b, 4단계 설계 4.5 · PRD-04 6.8).
// 한도·단가·예산은 모두 settings 값이다. 코드에 숫자 기본값을 두지 않는다 - 모양이 틀리거나 비면 null(호출 0).

export interface AskLimits {
  guestDaily: number;
  memberDaily: number;
  premiumDaily: number;
  sessionTurns: number;
  clarifyRounds: number;
  clarifyPerRound: number;
  contextChunks: number;
  contextTokens: number;
  /** 근거 기준 - 설정에 없으면 근거 1건 이상 / 점수 제한 없음 (평가셋 보정 뒤 PO가 입력) */
  evidenceMinDocs: number;
  evidenceMinScore: number;
}

export interface LivePolicy {
  maxCalls: number;
  timeoutMs: number;
  excerptTokens: number;
  officialSearchMax: number;
}

const nonNegInt = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
const posInt = (v: unknown): number | null => {
  const n = nonNegInt(v);
  return n !== null && n >= 1 ? n : null;
};
const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function parseAskLimits(v: unknown): AskLimits | null {
  const o = obj(v);
  if (!o) return null;
  const guestDaily = nonNegInt(o.guest_daily);
  const memberDaily = nonNegInt(o.member_daily);
  const premiumDaily = nonNegInt(o.premium_daily);
  const sessionTurns = posInt(o.session_turns);
  const clarifyRounds = nonNegInt(o.clarify_rounds);
  const clarifyPerRound = nonNegInt(o.clarify_per_round);
  const contextChunks = posInt(o.context_chunks);
  const contextTokens = posInt(o.context_tokens);
  if ([guestDaily, memberDaily, premiumDaily, sessionTurns, clarifyRounds, clarifyPerRound, contextChunks, contextTokens].some((x) => x === null)) return null;
  const minDocs = o.evidence_min_docs === undefined ? 1 : nonNegInt(o.evidence_min_docs);
  const minScore = o.evidence_min_score === undefined ? 0 : typeof o.evidence_min_score === "number" && o.evidence_min_score >= 0 ? o.evidence_min_score : null;
  if (minDocs === null || minScore === null) return null;
  return {
    guestDaily: guestDaily!,
    memberDaily: memberDaily!,
    premiumDaily: premiumDaily!,
    sessionTurns: sessionTurns!,
    clarifyRounds: clarifyRounds!,
    clarifyPerRound: clarifyPerRound!,
    contextChunks: contextChunks!,
    contextTokens: contextTokens!,
    evidenceMinDocs: minDocs,
    evidenceMinScore: minScore,
  };
}

export function parseLivePolicy(v: unknown): LivePolicy | null {
  const o = obj(v);
  if (!o) return null;
  const maxCalls = nonNegInt(o.max_calls);
  const timeoutMs = posInt(o.timeout_ms);
  const excerptTokens = posInt(o.excerpt_tokens);
  const officialSearchMax = nonNegInt(o.official_search_max);
  if (maxCalls === null || timeoutMs === null || excerptTokens === null || officialSearchMax === null) return null;
  return { maxCalls, timeoutMs, excerptTokens, officialSearchMax };
}

/** 설정 ask_official_search - 문자열 'true' 같은 이상한 값은 꺼짐. 불리언 true만 켜짐 */
export const parseOfficialSearch = (v: unknown): boolean => obj(v)?.enabled === true;

export interface ScopeFlags {
  trust_redevelopment: boolean;
  inheritance: boolean;
  gift: boolean;
}
export const ALL_SCOPES_OFF: ScopeFlags = { trust_redevelopment: false, inheritance: false, gift: false };

/** 공개 판정 함수(public_ask_gate)의 scopes 값 - 불리언 true만 켜짐 */
export function parseScopeFlags(v: unknown): ScopeFlags {
  const o = obj(v) ?? {};
  return { trust_redevelopment: o.trust_redevelopment === true, inheritance: o.inheritance === true, gift: o.gift === true };
}

// ── 단가·예산 ─────────────────────────────────────────

export interface Rate {
  /** 100만 토큰당 입력 단가 */
  in: number;
  out: number;
  /** 캐시에서 읽은 입력 단가 - 없으면 입력 단가와 같게 센다(보수적) */
  cachedIn: number;
}
export interface AskPricing {
  answer: Rate;
  utility: Rate;
}
export interface AskBudget {
  monthlyWon: number;
}

const rateOf = (v: unknown): Rate | null => {
  const o = obj(v);
  if (!o) return null;
  const inn = o.in;
  const out = o.out;
  if (typeof inn !== "number" || typeof out !== "number" || inn < 0 || out < 0) return null;
  const cached = typeof o.cached_in === "number" && o.cached_in >= 0 ? o.cached_in : inn;
  return { in: inn, out, cachedIn: cached };
};

/** 단가가 비었거나 모양이 틀리면 null - 비용을 못 재므로 지방세봇 호출 0 */
export function parsePricingAsk(v: unknown): AskPricing | null {
  const o = obj(v);
  if (!o) return null;
  const answer = rateOf(o.answer);
  if (!answer) return null;
  const utility = rateOf(o.utility) ?? answer;
  if (answer.in === 0 && answer.out === 0) return null;
  return { answer, utility };
}

export function parseBudget(v: unknown): AskBudget | null {
  const o = obj(v);
  if (!o) return null;
  const n = o.monthly_won;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? { monthlyWon: n } : null;
}

export type BudgetState = "unset" | "ok" | "warn" | "over";

/** 이번 달 쓴 돈 대비 상태 - 80% 이상 warn, 100% 이상 over. 예산이나 단가가 비면 unset */
export function budgetState(spentWon: number, budget: AskBudget | null, pricing: AskPricing | null): BudgetState {
  if (!budget || !pricing) return "unset";
  if (spentWon >= budget.monthlyWon) return "over";
  if (spentWon >= budget.monthlyWon * 0.8) return "warn";
  return "ok";
}

export type Tier = "guest" | "member";

/** 모델을 부를 수 있는가 - unset이면 모두 불가, over이면 비회원 불가(비회원부터 검색 모드) */
export function modelCallAllowed(state: BudgetState, tier: Tier): boolean {
  if (state === "unset") return false;
  if (state === "over") return tier === "member";
  return true;
}

export interface AgentUsage {
  answerIn: number;
  answerOut: number;
  answerCached: number;
  utilityIn: number;
  utilityOut: number;
}
export const emptyAgentUsage = (): AgentUsage => ({ answerIn: 0, answerOut: 0, answerCached: 0, utilityIn: 0, utilityOut: 0 });

/** 비용(원) = 사용량 x 설정 단가, 소수 넷째 자리까지. 단가가 없으면 0 */
export function costWon(u: AgentUsage, p: AskPricing | null): number {
  if (!p) return 0;
  const raw = (u.answerIn * p.answer.in + u.answerOut * p.answer.out + u.answerCached * p.answer.cachedIn + u.utilityIn * p.utility.in + u.utilityOut * p.utility.out) / 1_000_000;
  return Math.round(raw * 10_000) / 10_000;
}
