// 입력 검사 + 의도·범위 규칙 - 순수 (W12-b b1, PRD-04 6.1 ① ② · ASK-07~09 · ASK-20 · ASK-21).
// 규칙 사전이 먼저 잡고 모델 결과는 그것을 풀 수 없다(단방향 - W7b와 같음). 마스킹·'하지 않음' 분류는 도우미 코드를 그대로 불러 쓴다(복사 0, 가드 코드 경로 하나).
// 국세 낱말이 필요한 정규식은 NT1~NT5에 걸리지 않는 모양으로만 쓴다 (낱말 바로 뒤에 세율·계산 낱말 없음).
import { declineByRule, type DeclineIntent } from "../assistant/intent";
import { maskText } from "../assistant/mask";
import type { ScopeFlags } from "./ask-limits";
import { investmentCopyKey, type ScopeBlockReason } from "./fixed-copy";

export type ScopeTag = "base" | "trust_redevelopment" | "inheritance" | "gift";

/** 측정 이벤트 (PRD-04 15장) - 이름과 속성 값은 events.ts 허용 목록과 같다 */
export type MeasureEvent =
  | { name: "ask_investment_blocked"; props: { topic: "recommendation" | "prediction" } }
  | { name: "ask_scope_redirected"; props: { reason: "tourism" | "scope_pending" | "national_tax_calculator"; scope?: ScopeTag } }
  | { name: "ask_fallback_shown"; props: { reason: "insufficient_evidence" | "outage" | "budget" | "scope_pending" } };

export interface ScopeBlock {
  reason: ScopeBlockReason;
  copyKey: ReturnType<typeof investmentCopyKey> | "tourism" | "transfer_amount" | "inherit_gift_amount" | "scope_pending" | "out_of_scope";
  event: MeasureEvent | null;
  scope: ScopeTag | null;
}

export interface ScopeDecision {
  masked: string;
  cardLike: boolean;
  /** 도우미 규칙 분류 결과 - 같은 공격 문항에서 도우미와 같은 값이어야 한다 */
  ruleIntent: DeclineIntent | null;
  block: ScopeBlock | null;
  flags: {
    /** 실존 인물 사칭 요청 - 막지 않고 사칭 없이 일반 답변으로 계속한다 (BR-09). V5가 사칭 문장을 막는다 */
    impersonation: boolean;
    highRisk: boolean;
    /** 관광 + 세금 혼합 - 세금 부분만 답한다 */
    tourismMixed: boolean;
    /** 세액 금액을 묻는 질문 (계산은 W12-c 도구, 지방세만) */
    amountQuestion: boolean;
  };
  scopeTag: ScopeTag;
  asOf: AsOf;
}

const TOURISM = /(축제|명소|맛집|여행|관광|가볼\s?만한|나들이|숙소|데이트\s?코스|볼거리)/u;
const LOCAL_TAX_TERM = /(세금|취득세|재산세|지방세|세액|감면|등록면허세|종합부동산세|종부세|자동차세|주민세|지방교육세)/u;
const TRANSFER = /(양도소득세|양도세|양도소득분|양도차익)/u;
const TRANSFER_ASK = /(얼마|계산|내야|세액|금액|알려|나와|나올|산출)/u;
const INHERIT_GIFT_MONEY = /(상속세|증여세)[^.?!]{0,30}(공제|한도|면제|금액|얼마|계산|내야)/u;
const PREDICTION = /(오를까|오르나요|오를지|떨어질까|내릴까|내릴지|전망|예측|앞으로|올라갈까)/u;
const HIGH_RISK = /(가산세|불복|세무조사|체납|강제징수|조세범|압류\s?처분|조사\s?통지)/u;
const AMOUNT_ASK = /(얼마|몇\s?원|계산|내야|납부|세액|나와|나올)/u;
const TRUST_REDEV = /(신탁|재건축|재개발|정비사업|입주권|관리처분|조합원|분양권)/u;
const INHERIT = /상속/u;
const GIFT = /증여/u;
const ACQ = /(취득세|취득)/u;

// ── 기준일 (ASK-07) ─────────────────────────────

export interface AsOf {
  date: string;
  /** 사용자가 시점을 말했는가 */
  explicit: boolean;
  /** 일(日)이 없어 그달 1일로 어림했는가 [확인 필요: 세무 감수 - 달 안에서 시행일이 갈리는 경우] */
  approx: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");
const validYmd = (y: number, m: number, d: number): boolean => {
  if (m < 1 || m > 12 || d < 1 || y < 1900 || y > 2200) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/** "2024년 5월 3일" · "작년 3월" · "재작년 12월" → 기준일. 없으면 오늘. 미래는 오늘로 자른다 */
export function extractAsOf(masked: string, today: string): AsOf {
  const t = masked.normalize("NFKC");
  const ty = Number(today.slice(0, 4));
  const clamp = (date: string, approx: boolean): AsOf => ({ date: date > today ? today : date, explicit: true, approx });
  const abs = /(\d{4})\s?년\s?(\d{1,2})\s?월(?:\s?(\d{1,2})\s?일)?/u.exec(t);
  if (abs) {
    const y = Number(abs[1]);
    const m = Number(abs[2]);
    const d = abs[3] ? Number(abs[3]) : 1;
    if (validYmd(y, m, d)) return clamp(`${y}-${pad(m)}-${pad(d)}`, !abs[3]);
  }
  const rel = /(재작년|작년|지난해|올해|금년)\s?(\d{1,2})\s?월(?:\s?(\d{1,2})\s?일)?/u.exec(t);
  if (rel) {
    const back = rel[1] === "재작년" ? 2 : rel[1] === "작년" || rel[1] === "지난해" ? 1 : 0;
    const y = ty - back;
    const m = Number(rel[2]);
    const d = rel[3] ? Number(rel[3]) : 1;
    if (validYmd(y, m, d)) return clamp(`${y}-${pad(m)}-${pad(d)}`, !rel[3]);
  }
  return { date: today, explicit: false, approx: false };
}

// ── 범위 판단 ──────────────────────────────────

function scopeTagOf(q: string): { tag: ScopeTag; needs: Array<keyof ScopeFlags> } {
  const needs: Array<keyof ScopeFlags> = [];
  if (TRUST_REDEV.test(q)) needs.push("trust_redevelopment");
  if (ACQ.test(q) && INHERIT.test(q)) needs.push("inheritance");
  if (ACQ.test(q) && GIFT.test(q)) needs.push("gift");
  return { tag: needs[0] ?? "base", needs };
}

/** 입력 검사(마스킹) → 규칙 분류 → 범위·플래그 판단. 모델을 부르지 않는다 */
export function guardScope(rawMessage: string, today: string, scopeFlags: ScopeFlags): ScopeDecision {
  const m = maskText(rawMessage);
  const q = m.text;
  const n = q.normalize("NFKC");
  const ruleIntent = declineByRule(q);
  const asOf = extractAsOf(q, today);
  const tag = scopeTagOf(n);
  const flags = {
    impersonation: ruleIntent === "impersonation",
    highRisk: HIGH_RISK.test(n),
    tourismMixed: TOURISM.test(n) && LOCAL_TAX_TERM.test(n),
    amountQuestion: LOCAL_TAX_TERM.test(n) && AMOUNT_ASK.test(n),
  };
  const done = (block: ScopeBlock | null): ScopeDecision => ({ masked: q, cardLike: m.cardLike, ruleIntent, block, flags, scopeTag: tag.tag, asOf });

  // 투자 추천·예측 - 끌 설정 없음 (ASK-20)
  if (ruleIntent === "investment") {
    const topic = PREDICTION.test(n) ? "prediction" : "recommendation";
    return done({ reason: "investment", copyKey: investmentCopyKey(topic), event: { name: "ask_investment_blocked", props: { topic } }, scope: null });
  }
  // 순수 관광 질문 (ASK-21) - 혼합 질문은 세금 부분만 답한다
  if (TOURISM.test(n) && !LOCAL_TAX_TERM.test(n)) {
    return done({ reason: "tourism", copyKey: "tourism", event: { name: "ask_scope_redirected", props: { reason: "tourism" } }, scope: null });
  }
  // 양도세 금액 - 계산하지 않는다 (ASK-09)
  if (TRANSFER.test(n) && TRANSFER_ASK.test(n)) {
    return done({ reason: "transfer_amount", copyKey: "transfer_amount", event: { name: "ask_scope_redirected", props: { reason: "national_tax_calculator" } }, scope: null });
  }
  // 상속세·증여세 금액·공제 - 플래그와 무관 (FAM-09)
  if (ruleIntent === "inheritance_gift" || INHERIT_GIFT_MONEY.test(n)) {
    return done({ reason: "inherit_gift_amount", copyKey: "inherit_gift_amount", event: { name: "ask_scope_redirected", props: { reason: "national_tax_calculator" } }, scope: null });
  }
  // 범위 플래그가 꺼진 주제 (ASK-19 · FAM-09) - 하나라도 꺼져 있으면 안내
  const closed = tag.needs.find((k) => !scopeFlags[k]);
  if (closed) {
    return done({ reason: "scope_pending", copyKey: "scope_pending", event: { name: "ask_scope_redirected", props: { reason: "scope_pending", scope: closed } }, scope: closed });
  }
  // 조합·신탁 법률 분쟁은 범위 밖 안내 (측정 이벤트 값 목록에 없어 이벤트 없음)
  if (ruleIntent === "legal_dispute") {
    return done({ reason: "out_of_scope", copyKey: "out_of_scope", event: null, scope: null });
  }
  return done(null);
}
