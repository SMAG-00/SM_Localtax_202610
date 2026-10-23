// 의도 분류 규칙과 '하지 않음' 안내표 — 순수 함수 (CHAT-05 · CHAT-07 · CHAT-17, PRD-01C 4.1 요청표).
//  · 규칙 사전은 '하지 않음' 범주를 먼저 잡는다. 라우터 모델 결과보다 우선(단방향 — 규칙이 막는 것을 모델이 풀 수 없다).
//  · 안내 문구는 길 안내일 뿐 세무·법률 내용이 아니다. 분야 코드는 W7c 코드표가 생기기 전의 임시 코드다 (설계 12장 #6).

export const ANSWERABLE_INTENTS = ["navigate", "summary", "status", "ops"] as const;
export const DECLINE_INTENTS = ["tax_amount", "inheritance_gift", "individual_judgment", "legal_dispute", "investment", "impersonation"] as const;
export const INTENTS = [...ANSWERABLE_INTENTS, ...DECLINE_INTENTS, "out_of_scope"] as const;
export type Intent = (typeof INTENTS)[number];
export type DeclineIntent = (typeof DECLINE_INTENTS)[number];

export const isIntent = (v: unknown): v is Intent => typeof v === "string" && (INTENTS as readonly string[]).includes(v);
export const isDecline = (i: Intent): i is DeclineIntent => (DECLINE_INTENTS as readonly string[]).includes(i);

const TAX_NOUN = "(?:취득세|등록면허세|재산세|종합부동산세|종부세|양도소득세|양도세|지방소득세|주민세|자동차세|지방교육세|농어촌특별세|세금|세액|과점주주)";
const ASK_AMOUNT = "(?:얼마|몇\\s?원|계산|산출|내야|납부(?:해야|할)|나와|나올|나오|물어야|내나요|내는지)";
const DISPUTE_NOUN = "(?:조합|신탁|재건축|재개발|시공사|조합원|수탁자|분양계약|사업시행)";
const DISPUTE_ASK = "(?:소송|분쟁|무효|효력|위법|위반|책임|승소|이길|취소|손해배상|해지)";

const RULES: ReadonlyArray<{ intent: DeclineIntent; test: (s: string) => boolean }> = [
  // 사칭 — 실존 인물(김의효 포함)의 이름·말투 요청 (BR-09 · CHAT-05)
  { intent: "impersonation", test: (s) => /김의효/.test(s) && /(로서|처럼|말투|흉내|대신|입장에서|인\s?척|라고\s?가정|이라고\s?생각하고|의\s?목소리)/.test(s) },
  // 상속세·증여세 금액
  { intent: "inheritance_gift", test: (s) => /(상속세|증여세)/.test(s) && new RegExp(`${ASK_AMOUNT}|세율\\s?적용|얼마`).test(s) },
  // 세액·세금 금액 (양도세 포함 — 요청표에서 '세액 계산'과 같이 다룬다)
  { intent: "tax_amount", test: (s) => new RegExp(`${TAX_NOUN}.{0,20}${ASK_AMOUNT}|${ASK_AMOUNT}.{0,12}${TAX_NOUN}`).test(s) },
  // 투자 추천·시세 전망
  {
    intent: "investment",
    test: (s) =>
      /(오를까|오르나요|오를지|떨어질까|내릴까|내릴지|투자\s?가치|유망|수익률|추천해|사면\s?좋|살까|팔까|분양받아도|전망|예측)/.test(s) &&
      /(구역|아파트|집값|시세|분양|부동산|투자|매수|매도|청약|금리|단지|땅|토지|재건축|재개발)/.test(s),
  },
  // 조합·신탁 법률 분쟁
  { intent: "legal_dispute", test: (s) => new RegExp(`${DISPUTE_NOUN}.{0,30}${DISPUTE_ASK}|${DISPUTE_ASK}.{0,30}${DISPUTE_NOUN}`).test(s) },
  // 감면 등 개별 판단
  {
    intent: "individual_judgment",
    test: (s) =>
      /(감면|비과세|면제|공제|중과)/.test(s) &&
      /(제\s?경우|저는|제가|우리\s?집|저희|내\s?경우|제\s?집|해당(?:되|이|하)|대상(?:이|인)|받을\s?수|되나요|될까요|되는지|가능한가요|맞나요)/.test(s),
  },
];

/** 규칙 분류 — '하지 않음' 범주면 그 값, 아니면 null (규칙은 막는 쪽으로만 쓴다) */
export function declineByRule(masked: string): DeclineIntent | null {
  const s = masked.normalize("NFKC");
  return RULES.find((r) => r.test(s))?.intent ?? null;
}

/** 라우터 모델이 없거나 실패했을 때의 보조 분류 — 답할 수 있는 범주만 */
export function fallbackIntent(masked: string): Intent {
  const s = masked.normalize("NFKC");
  if (/(요약|줄여|간단히\s?정리)/.test(s)) return "summary";
  if (/(구독|도서|책\s?(?:구입|사|파)|교육|강좌|정정|반론|제보|문의|고객센터)/.test(s)) return "ops";
  if (/(단계|상태|어디까지|진행|현재\s?어느|지금\s?어느|확인일)/.test(s)) return "status";
  return "navigate";
}

/** 라우터 모델 출력 → 범주. 글에서 첫 JSON 객체를 찾아 열거형을 검증한다 (설계 12장 #4). 모양이 틀리면 null */
export function parseRouterOutput(text: string): Intent | null {
  const m = /\{[^{}]{0,400}\}/.exec(text);
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]) as { intent?: unknown };
    return isIntent(v.intent) ? v.intent : null;
  } catch {
    return null;
  }
}

/** 최종 범주 — 규칙이 막으면 그것, 아니면 라우터 결과(없으면 보조 분류). 라우터가 '하지 않음'을 내면 그대로 따른다 */
export function resolveIntent(masked: string, routed: Intent | null): Intent {
  return declineByRule(masked) ?? routed ?? fallbackIntent(masked);
}

// ── '하지 않음' 안내표 (PRD-01C 4.1 요청표) ────────────────────────────

export interface DeclineGuide {
  /** 한 줄 사유 — 고정 안내 문구(AI 문장 아님, 'AI 답변' 배지 0) */
  reason: string;
  /** 갈 곳 — 바깥 연결 키(official_links.key) 순서. 주소가 비어 있는 키는 건너뛴다 */
  linkKeys: readonly string[];
  /** 사이트 안 갈 곳 (항상 열려 있는 주소만) */
  siteLinks: ReadonlyArray<{ label: string; href: string }>;
  /** 전문가 버튼이 여는 분야 코드 (임시 — W7c 코드표로 교체). null이면 전문가 버튼 0 */
  expertField: string | null;
}

export const DECLINE_GUIDES: Readonly<Record<DeclineIntent, DeclineGuide>> = {
  tax_amount: {
    reason: "세액·세금 금액은 도우미가 계산하지 않습니다. 계산기에서 직접 계산해 보시고, 개별 사안은 전문가와 상의하세요.",
    linkKeys: ["acquisition", "property_tax", "transfer", "comprehensive", "nts"],
    siteLinks: [{ label: "계산기 모음", href: "/calc" }],
    expertField: "local-tax",
  },
  inheritance_gift: {
    reason: "상속세·증여세 금액은 도우미가 계산하지 않습니다. 별도 사이트의 계산기와 국세청 안내를 이용해 주세요.",
    linkKeys: ["inheritance_gift", "nts"],
    siteLinks: [],
    expertField: "inheritance-gift",
  },
  individual_judgment: {
    reason: "감면 등 개별 사안의 해당 여부는 도우미가 판단하지 않습니다. 관련 해설과 원문을 확인하시고 전문가와 상의하세요.",
    linkKeys: ["wetax"],
    siteLinks: [],
    expertField: "local-tax",
  },
  legal_dispute: {
    reason: "조합·신탁 등 법률 분쟁은 도우미가 판단하지 않습니다. 관련 해설과 사례를 참고하시고 전문가와 상의하세요.",
    linkKeys: [],
    siteLinks: [],
    expertField: "redevelopment-trust-law",
  },
  investment: {
    reason: "분양·투자 추천과 시세 전망은 도우미가 하지 않습니다.",
    linkKeys: [],
    siteLinks: [],
    expertField: "appraisal-law",
  },
  impersonation: {
    reason: "특정 인물의 이름이나 말투로 답하지 않습니다.",
    linkKeys: [],
    siteLinks: [],
    expertField: null,
  },
};

/** 범위 밖·답 없음 (CHAT-03) — 지어낸 답 0 */
export const OUT_OF_SCOPE_REASON = "이 사이트에서 찾을 수 있는 자료 밖의 질문입니다. 아래 검색 결과를 확인해 주세요.";
export const NO_RESULT_REASON = "사이트에서 관련 자료를 찾지 못했습니다. 검색에서 다른 낱말로 찾아보시거나 고객센터에 문의해 주세요.";
export const CARD_NOTICE = "결제 정보는 받지 않습니다.";
export const IMPERSONATION_REFUSAL = "특정 인물의 이름이나 말투로 답하지 않습니다.";

/** 운영 요청 → 안내 주소 (CHAT-07) — 열려 있는 주소만 쓴다(서버가 isOpenPath로 거른다). 양식은 이용자가 그 화면에서 직접 제출한다 */
export const OPS_ROUTES: ReadonlyArray<{ test: RegExp; label: string; href: string }> = [
  { test: /구독/, label: "구독 안내", href: "/store/subscription" },
  { test: /(도서|책)/, label: "도서", href: "/store" },
  { test: /(교육|강좌)/, label: "교육", href: "/edu" },
  { test: /(정정|반론|틀린)/, label: "정정·반론 창구", href: "/help/correction" },
  { test: /(제보)/, label: "제보하기", href: "/help/tip" },
  { test: /(문의|고객센터)/, label: "고객센터", href: "/help" },
];
