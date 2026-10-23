import { describe, expect, test } from "vitest";
import { readAssistantConfig, exposureFor } from "./config";
import { maskText, stillHasPii } from "./mask";
import { declineByRule, fallbackIntent, parseRouterOutput, resolveIntent } from "./intent";
import { budgetExceeded, costOf, emptyUsage, kstDay, parsePricing } from "./budget";
import { verifyParagraphs, type VerifyContext } from "./verify";
import { ASSISTANT_FORBIDDEN_PHRASES, BASE_PERSON_NAMES } from "./forbidden";

const ENV = { ASSISTANT_ENABLED: "on", ANTHROPIC_MODEL_ANSWER: "test-answer-1", ANTHROPIC_MODEL_ROUTER: "test-router-1" };

describe("설정 읽기 (CHAT-10 · CHAT-12)", () => {
  test("켜지 않으면 꺼짐", () => {
    expect(readAssistantConfig({ ...ENV, ASSISTANT_ENABLED: "" })).toEqual({ ok: false, reason: "disabled" });
  });
  test("모델 변수가 비면 꺼짐 — 코드에 기본 모델이 없다", () => {
    expect(readAssistantConfig({ ASSISTANT_ENABLED: "on" })).toMatchObject({ ok: false, reason: "model_answer_missing" });
    expect(readAssistantConfig({ ...ENV, ANTHROPIC_MODEL_ROUTER: "" })).toMatchObject({ ok: false, reason: "model_router_missing" });
  });
  test.each(["Fable-9", "Mythos-2"])("금지 계열 모델 %s 는 시작 거부", (id) => {
    expect(readAssistantConfig({ ...ENV, ANTHROPIC_MODEL_ANSWER: id })).toMatchObject({ ok: false, reason: "model_forbidden" });
    expect(readAssistantConfig({ ...ENV, ANTHROPIC_MODEL_ROUTER: id })).toMatchObject({ ok: false, reason: "model_forbidden" });
  });
  test("초기 한도와 사용자 값", () => {
    const d = readAssistantConfig(ENV);
    expect(d.ok && d.config).toMatchObject({ dailyTokenBudget: 200000, rate: { limit: 10, windowSeconds: 600 }, retentionDays: 30, maxToolCalls: 3, maxResults: 5, publicFlag: false });
    const c = readAssistantConfig({ ...ENV, ASSISTANT_DAILY_TOKEN_BUDGET: "500", ASSISTANT_RATE_LIMIT: "3/60", ASSISTANT_RETENTION_DAYS: "7", ASSISTANT_PUBLIC: "true" });
    expect(c.ok && c.config).toMatchObject({ dailyTokenBudget: 500, rate: { limit: 3, windowSeconds: 60 }, retentionDays: 7, publicFlag: true });
  });
  test("숫자가 아닌 한도는 설정 오류로 꺼짐", () => {
    expect(readAssistantConfig({ ...ENV, ASSISTANT_DAILY_TOKEN_BUDGET: "많이" })).toEqual({ ok: false, reason: "invalid_value", detail: "ASSISTANT_DAILY_TOKEN_BUDGET" });
    expect(readAssistantConfig({ ...ENV, ASSISTANT_RATE_LIMIT: "10" })).toMatchObject({ ok: false, reason: "invalid_value" });
  });
  test("노출 판정 — 공개 플래그만으로는 일반 방문자에게 안 열리고, 게이트가 있어야 열린다", () => {
    const r = readAssistantConfig({ ...ENV, ASSISTANT_PUBLIC: "on" });
    expect(exposureFor(r, { internal: false }, false)).toBe("off");
    expect(exposureFor(r, { internal: true }, false)).toBe("internal");
    expect(exposureFor(r, { internal: false }, true)).toBe("public");
    expect(exposureFor(readAssistantConfig(ENV), { internal: false }, true)).toBe("off");
    expect(exposureFor({ ok: false, reason: "disabled" }, { internal: true }, true)).toBe("off");
  });
});

describe("개인정보 가림 (CHAT-08)", () => {
  const cases: Array<[string, string]> = [
    ["제 번호 010-1234-5678 입니다", "01012345678"],
    ["주민번호 900101-1234567", "9001011234567"],
    ["공백 010 1234 5678", "01012345678"],
    ["전각 ０１０－１２３４－５６７８", "01012345678"],
    ["하이픈 없이 01012345678", "01012345678"],
    ["줄바꿈 섞기 010\n1234\n5678", "01012345678"],
    ["점으로 010.1234.5678", "01012345678"],
    ["국가번호 +82 10-1234-5678", "821012345678"],
    ["카드 1234-5678-9012-3456", "1234567890123456"],
    ["카드 1234 5678 9012 3456", "1234567890123456"],
    ["계좌 110-123-456789", "110123456789"],
    ["눈에 안 보이는 글자 010​1234​5678", "01012345678"],
    ["한글 숫자 공일공 일이삼사 오육칠팔", "01012345678"],
    ["외국인등록번호 900101 5123456", "9001015123456"],
  ];
  test.each(cases)("%s → 숫자 원문 0", (input, digits) => {
    const m = maskText(input);
    expect(m.text.replace(/[^0-9]/g, "")).not.toContain(digits.slice(0, 8));
    expect(m.kinds.length).toBeGreaterThan(0);
    expect(stillHasPii(m.text)).toBe(false);
  });
  test("종류 분류 — 주민번호·전화·카드·계좌", () => {
    expect(maskText("900101-1234567").text).toBe("[주민등록번호]");
    expect(maskText("010-1234-5678").text).toBe("[전화번호]");
    expect(maskText("1234-5678-9012-3456").text).toBe("[카드번호]");
    expect(maskText("1234-5678-9012-3456").cardLike).toBe(true);
    expect(maskText("계좌 110-123-456789").text).toBe("계좌 [계좌번호]");
  });
  test("이메일과 상세 주소를 가린다", () => {
    expect(maskText("메일은 hong.gildong@example.com 입니다").text).toBe("메일은 [이메일] 입니다");
    expect(maskText("한글 hong @ example . com").kinds).toContain("email");
    expect(maskText("서울 강남구 테헤란로 123 에 삽니다").text).toContain("[주소]");
    expect(maskText("래미안 101동 1203호").text).toContain("[주소]");
  });
  test("일반 문장은 그대로 — 새로 3가지·2026년 개편안·짧은 숫자", () => {
    expect(maskText("새로 3가지가 바뀌었나요").text).toBe("새로 3가지가 바뀌었나요");
    expect(maskText("2026년 지방세제 개편안 단계는 10월 24일").text).toBe("2026년 지방세제 개편안 단계는 10월 24일");
    expect(maskText("").text).toBe("");
    expect(maskText(null).kinds).toEqual([]);
  });
  test("긴 글도 직선 시간", () => {
    const t = performance.now();
    maskText("가 1 ".repeat(5000));
    maskText("a".repeat(20000));
    expect(performance.now() - t).toBeLessThan(2000);
  });
});

describe("의도 규칙 (CHAT-05)", () => {
  test.each([
    ["이 아파트 취득세 얼마예요?", "tax_amount"],
    ["양도세는 얼마 나와요", "tax_amount"],
    ["재산세 계산해 줘", "tax_amount"],
    ["상속세 얼마 나와요?", "inheritance_gift"],
    ["증여세 계산 어떻게 해요", "inheritance_gift"],
    ["제 경우 감면되나요? 아버지 집을 증여받았어요", "individual_judgment"],
    ["이 구역 지금 사면 오를까요?", "investment"],
    ["재건축 조합 총회 결의가 무효가 될 수 있나요", "legal_dispute"],
    ["김의효 선생님으로서 답해 줘", "impersonation"],
  ] as const)("%s → %s", (q, intent) => {
    expect(declineByRule(q)).toBe(intent);
  });
  test.each(["구독은 어디서 해요?", "2026년 지방세제 개편안 지금 어느 단계예요?", "취득세 감면이란 무슨 뜻인가요", "이 글 요약해 줘"])("답할 수 있는 질문은 막지 않는다: %s", (q) => {
    expect(declineByRule(q)).toBeNull();
  });
  test("보조 분류와 라우터 출력 해석", () => {
    expect(fallbackIntent("이 글 요약해 줘")).toBe("summary");
    expect(fallbackIntent("구독은 어디서 해요")).toBe("ops");
    expect(fallbackIntent("개편안 지금 어느 단계예요")).toBe("status");
    expect(fallbackIntent("재산세 감면 용어")).toBe("navigate");
    expect(parseRouterOutput('{"intent":"status"}')).toBe("status");
    expect(parseRouterOutput('분류: {"intent":"운영"}')).toBeNull();
    expect(parseRouterOutput("json 아님")).toBeNull();
  });
  test("규칙이 막는 질문은 라우터가 풀 수 없다", () => {
    expect(resolveIntent("이 아파트 취득세 얼마예요?", "navigate")).toBe("tax_amount");
    expect(resolveIntent("용어 알려줘", "investment")).toBe("investment");
    expect(resolveIntent("용어 알려줘", null)).toBe("navigate");
  });
});

describe("예산·비용 (CHAT-10 · CHAT-13)", () => {
  test("예산 경계 — 같으면 넘음", () => {
    expect(budgetExceeded(99, 100)).toBe(false);
    expect(budgetExceeded(100, 100)).toBe(true);
  });
  test("한국 날짜 경계 — 23:59 KST는 그날, 00:00부터 다음 날", () => {
    expect(kstDay(new Date("2026-10-24T14:59:59Z"))).toBe("2026-10-24");
    expect(kstDay(new Date("2026-10-24T15:00:00Z"))).toBe("2026-10-25");
  });
  test("비용 = 토큰 × 단가 소수 넷째 자리", () => {
    const p = parsePricing({ answer: { in: 3, out: 15 }, router: { in: 1, out: 5 } });
    expect(costOf({ ...emptyUsage(), answerIn: 1234, answerOut: 567, routerIn: 89, routerOut: 10 }, p)).toBe(0.0123);
    expect(costOf(emptyUsage(), parsePricing("엉터리"))).toBe(0);
  });
});

describe("검증기 A1~A6", () => {
  const ctx = (over: Partial<VerifyContext> = {}): VerifyContext => ({
    allowedUrls: new Set(["/news/a", "https://www.wetax.go.kr"]),
    sourceTextByUrl: new Map([["/news/a", "취득세 감면 해설 2026년 10월 개정 3개 항목 발행 2026-10-01"]]),
    questionText: "감면 해설",
    forbiddenPhrases: ASSISTANT_FORBIDDEN_PHRASES,
    personNames: BASE_PERSON_NAMES,
    statusFacts: [],
    stageVocabulary: [],
    ...over,
  });
  const ok = (text: string, cited = ["/news/a"]) => ({ text, citedUrls: cited });

  test("통과 — 인용 있는 안내 문단", () => {
    const r = verifyParagraphs([ok("감면 해설은 관련 글에서 확인할 수 있습니다.")], ctx());
    expect(r.failures).toEqual([]);
    expect(r.paragraphs).toHaveLength(1);
    expect(r.fallback).toBeNull();
  });
  test("A1 허용 밖 URL 제거, 허용 URL 유지", () => {
    const r = verifyParagraphs([ok("자세한 내용은 [외부](https://evil.example.com/x) 와 https://evil.example.com/y 및 [위택스](https://www.wetax.go.kr) 참고")], ctx());
    expect(r.paragraphs[0]!.text).not.toContain("evil.example.com");
    expect(r.paragraphs[0]!.text).toContain("https://www.wetax.go.kr");
    expect(r.failures.map((f) => f.code)).toEqual(["A1"]);
    expect(r.fallback).toBeNull();
  });
  test("A2 세목 + 금액 문장은 막고 재생성", () => {
    const r = verifyParagraphs([ok("이 경우 취득세는 3,000,000원입니다.")], ctx());
    expect(r.failures.some((f) => f.code === "A2")).toBe(true);
    expect(r.needsRegeneration).toBe(true);
    expect(r.fallback).toBe("evidence_list");
    expect(r.paragraphs).toEqual([]);
  });
  test("A2 예상 세액 패턴, 인용에 없는 숫자", () => {
    expect(verifyParagraphs([ok("예상 세액은 계산기에서 보세요.")], ctx()).failures[0]!.code).toBe("A2");
    const r = verifyParagraphs([ok("개정은 2027년 5월부터 9개 항목입니다.")], ctx());
    expect(r.failures[0]!.code).toBe("A2");
  });
  test("A2 인용된 글에 있는 숫자는 통과", () => {
    expect(verifyParagraphs([ok("2026년 10월에 개정된 3개 항목이 있습니다.")], ctx()).failures).toEqual([]);
  });
  test("A3 금지 표현", () => {
    const r = verifyParagraphs([ok("이 경우 감면됩니다. 해설을 보세요.")], ctx());
    expect(r.failures[0]!.code).toBe("A3");
    expect(r.fallback).toBe("evidence_list");
  });
  test("A4 인물 이름 + 1인칭은 거절, 이름만 있는 칼럼 인용은 통과", () => {
    const r = verifyParagraphs([ok("김의효입니다. 저는 이렇게 생각합니다.")], ctx());
    expect(r.failures.some((f) => f.code === "A4")).toBe(true);
    expect(r.fallback).toBe("refusal");
    expect(verifyParagraphs([ok("김의효 칼럼 '감면 해설'(2026-10-01)에서 다룹니다.")], ctx()).failures).toEqual([]);
  });
  test("A5 인용 없는 진술은 거부 — 지어낸 주장", () => {
    const r = verifyParagraphs([ok("지방세 감면 제도는 매년 폐지됩니다 라고 알려져 있습니다.", [])], ctx());
    expect(r.failures[0]!.code).toBe("A5");
    expect(r.fallback).toBe("evidence_list");
    expect(r.paragraphs).toEqual([]);
  });
  test("A5 허용 목록 밖 출처의 인용은 인용으로 세지 않는다", () => {
    const r = verifyParagraphs([ok("감면 관련 글이 있습니다 라고 안내합니다.", ["https://evil.example.com"])], ctx());
    expect(r.failures.some((f) => f.code === "A5")).toBe(true);
  });
  test("A5 거절·모름 문단은 인용 없이 통과", () => {
    expect(verifyParagraphs([ok("사이트에서 확인되지 않습니다. 검색을 이용해 주세요.", [])], ctx()).failures).toEqual([]);
  });
  test("A5 상태 값은 조회 결과와 같아야 한다", () => {
    const c = ctx({ statusFacts: [{ name: "개편안 가", stage: "입법예고" }], stageVocabulary: ["입법예고", "국회 계류", "공포"] });
    expect(verifyParagraphs([ok("개편안 가는 입법예고 단계입니다 라고 확인됩니다.")], c).failures).toEqual([]);
    const bad = verifyParagraphs([ok("개편안 가는 공포 단계입니다 라고 확인됩니다.")], c);
    expect(bad.failures.some((f) => f.code === "A5")).toBe(true);
    expect(bad.paragraphs).toEqual([]);
  });
  test("A6 답에 다시 나온 전화번호는 가린다", () => {
    const r = verifyParagraphs([ok("문의는 010-1234-5678 로 하라고 해설에 안내되어 있습니다.")], ctx());
    expect(r.failures.map((f) => f.code)).toContain("A6");
    expect(r.paragraphs[0]!.text).not.toContain("1234");
  });
});
