// 예산·속도·비용 판정 — 순수 함수 (CHAT-10 · CHAT-13, docs/dev/W7b_설계.md 12장 #5 · #7). 시계·DB를 쓰지 않는다.

export type FallbackReason = "budget" | "error" | "rate" | "verify";

/** 일일 토큰 예산 — 오늘 쓴 토큰이 예산 이상이면 '검색 결과만' (다음 날 0시 KST에 초기화는 DB가 날짜로 한다) */
export function budgetExceeded(tokensToday: number, dailyBudget: number): boolean {
  return tokensToday >= dailyBudget;
}

/** 한국 날짜(YYYY-MM-DD) — 23:59 KST 사용분은 그날, 00:00부터 새 날 (usage_daily.day와 같은 기준) */
export function kstDay(now: Date): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export interface Pricing {
  answer: { in: number; out: number };
  router: { in: number; out: number };
}

export const ZERO_PRICING: Pricing = { answer: { in: 0, out: 0 }, router: { in: 0, out: 0 } };

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

/** 설정 assistant_pricing → 단가 (모양이 틀리면 0원 — 비용 기록이 멈추지 않게) */
export function parsePricing(v: unknown): Pricing {
  if (typeof v !== "object" || v === null) return ZERO_PRICING;
  const o = v as Record<string, Record<string, unknown> | undefined>;
  return {
    answer: { in: num(o.answer?.in), out: num(o.answer?.out) },
    router: { in: num(o.router?.in), out: num(o.router?.out) },
  };
}

export interface Usage {
  answerIn: number;
  answerOut: number;
  routerIn: number;
  routerOut: number;
  cached: number;
}

export const emptyUsage = (): Usage => ({ answerIn: 0, answerOut: 0, routerIn: 0, routerOut: 0, cached: 0 });

/** 대화 비용 = 토큰 × 단가(100만 토큰당), 소수 넷째 자리까지 */
export function costOf(u: Usage, p: Pricing): number {
  const raw = (u.answerIn * p.answer.in + u.answerOut * p.answer.out + u.routerIn * p.router.in + u.routerOut * p.router.out) / 1_000_000;
  return Math.round(raw * 10_000) / 10_000;
}

export const totalTokens = (u: Usage): { in: number; out: number } => ({ in: u.answerIn + u.routerIn, out: u.answerOut + u.routerOut });
