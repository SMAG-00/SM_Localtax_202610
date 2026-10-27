// 하루 한도 판정·문구 검사 - 순수 (W12-d d4, ASK-10). 한도 값은 설정 ask_limits에서만 온다(코드에 상수 0).
// 차감은 보내기를 눌러 /api/ask 요청이 도착했을 때 한 번뿐이다. 모드 전환·진입점·창 열기는 차감하지 않는다(ASK-13).
export type Tier = "guest" | "member" | "premium";

export function limitKey(tier: Tier): "guest_daily" | "member_daily" | "premium_daily" {
  return `${tier}_daily` as const;
}

/** 설정 한 줄에서 등급별 하루 한도를 읽는다. 1 미만·숫자 아님·없음은 null(닫힘) */
export function readDailyLimit(limits: unknown, tier: Tier): number | null {
  if (typeof limits !== "object" || limits === null) return null;
  const v = (limits as Record<string, unknown>)[limitKey(tier)];
  return typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : null;
}

export type QuotaDecision =
  | { allowed: true; used: number; limit: number; remaining: number }
  | { allowed: false; code: "limit" | "limit_missing"; used: number; limit: number | null; next: "signup" | "upgrade" | "tomorrow" };

/** 지금까지 쓴 수(used, 이번 질문 제외)와 한도로 이번 질문을 받을지 정한다. used < limit이면 허용: 한도 3이면 3번째 허용, 4번째 거절 */
export function decideQuota(used: number, limit: number | null, tier: Tier): QuotaDecision {
  if (limit === null) return { allowed: false, code: "limit_missing", used, limit: null, next: tier === "guest" ? "signup" : "tomorrow" };
  if (used < limit) return { allowed: true, used: used + 1, limit, remaining: limit - used - 1 };
  return { allowed: false, code: "limit", used, limit, next: tier === "guest" ? "signup" : tier === "member" ? "upgrade" : "tomorrow" };
}

/** DB 차감 함수 반환(jsonb) → 판정. 모양이 틀리면 거절(닫힘) */
export function parseConsume(raw: unknown, tier: Tier): QuotaDecision {
  if (typeof raw !== "object" || raw === null) return decideQuota(0, null, tier);
  const o = raw as { allowed?: unknown; used?: unknown; limit?: unknown };
  const used = Number(o.used ?? 0) || 0;
  const limit = typeof o.limit === "number" ? o.limit : null;
  if (o.allowed === true && limit !== null) return { allowed: true, used, limit, remaining: Math.max(limit - used, 0) };
  return decideQuota(Math.max(used, limit ?? 0), limit, tier);
}

/** 화면 문구에 '무제한'류 표현이 있는가 (공정 사용 한도만 쓴다 - ASK-10 문구 시험) */
export function hasUnlimitedWording(text: string): boolean {
  return /무제한|제한\s*없이|제한\s*없는|unlimited/iu.test(text);
}

/** 남은 횟수 안내 문장 - 한도를 모르면 숫자를 지어내지 않는다 */
export function remainingLabel(remaining: number | null, limit: number | null): string {
  if (remaining === null || limit === null) return "오늘 질문 가능 횟수를 확인하지 못했습니다";
  return `오늘 ${limit}회 중 ${Math.max(remaining, 0)}회 남았습니다`;
}
