// 제휴 규정 버전 규칙 (NAV-13 — docs/dev/W2-c_설계.md 2.8·8.5)
//  · 입력 검사(API·화면 공용): 모르는 칸·값 목록 밖·요건 항목 모양 · 기준 숫자는 요건 항목에만
//  · 확정 조건: 원문 URL·확인일(오늘 이전)·등록 유형·적용 시작일·심사 대상 기간·요건 1개·담당자 확인 표시
//  · 적용 버전 고르기: 확정 + 오늘이 적용 기간 안 → 가장 늦게 확정된 것. 없으면 '요건 미확정'(이유와 함께)
import { describe, expect, test } from "vitest";
import { designList } from "@/lib/analytics/test-design";
import {
  CRITERION_COMPARATORS,
  CRITERION_PER,
  PLATFORMS,
  REQUIREMENT_METRICS,
  confirmProblems,
  parseRequirementInput,
  platformState,
  readStoredItems,
  type RequirementRow,
} from "./requirements";

const ITEM = {
  key: "own_ratio",
  label: "자체 생산 기사 비율",
  metric: "ratio",
  numerator: { contentTypes: ["reported_news"] },
  denominator: {},
  numeratorText: "자체 취재 보도기사",
  denominatorText: "전체 발행 기사",
  exclusionsText: "금주 핫뉴스·칼럼·광고",
  criterion: { comparator: "gte", value: 30, per: "period" },
  sourceRef: "제3조 2항",
};
const BODY = {
  platform: "naver",
  title: "2026 뉴스 검색 제휴 심사 규정",
  mediaType: "인터넷신문",
  sourceUrl: "https://example.test/rules/2026",
  sourceTextRef: "공유 드라이브 규정/2026 원문 제3조",
  checkedAt: "2026-10-10",
  effectiveFrom: "2026-03-01",
  effectiveTo: null,
  reviewPeriod: { months: 3, basis: "closed_months", text: "과거 1년 중 임의의 3개월" },
  items: [ITEM],
};
const errorsOf = (r: ReturnType<typeof parseRequirementInput>) => (r.ok ? [] : r.errors);

describe("값 목록 = 설계 2.8", () => {
  test("플랫폼·계산 종류·비교·기준 단위", () => {
    expect([...PLATFORMS]).toEqual(designList("2.8", "news_partner_requirements.platform"));
    expect([...REQUIREMENT_METRICS]).toEqual(designList("2.8", "requirement.metric"));
    expect([...CRITERION_COMPARATORS]).toEqual(designList("2.8", "requirement.comparator"));
    expect([...CRITERION_PER]).toEqual(designList("2.8", "requirement.per"));
  });
});

describe("parseRequirementInput — 새 버전·고치기 입력", () => {
  test("다 갖춘 입력 → DB 칸 (요건·심사 기간은 JSON 그대로)", () => {
    const r = parseRequirementInput(BODY, "create");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      platform: "naver",
      title: "2026 뉴스 검색 제휴 심사 규정",
      media_type: "인터넷신문",
      source_url: "https://example.test/rules/2026",
      source_text_ref: "공유 드라이브 규정/2026 원문 제3조",
      checked_at: "2026-10-10",
      effective_from: "2026-03-01",
      effective_to: null,
      review_period: { months: 3, basis: "closed_months", text: "과거 1년 중 임의의 3개월" },
      requirements: [ITEM],
    });
  });

  test("새 버전은 플랫폼·제목이 필요하고, 확정에 필요한 칸은 작성 중에는 비워도 된다", () => {
    expect(errorsOf(parseRequirementInput({ title: "x" }, "create"))).toEqual(["requirement.platform: 필요합니다"]);
    expect(errorsOf(parseRequirementInput({ platform: "naver" }, "create"))).toEqual(["requirement.title: 필요합니다"]);
    expect(parseRequirementInput({ platform: "kakao", title: "카카오 검토" }, "create").ok).toBe(true);
  });

  test.each([
    [{ platform: "daum" }, "requirement.platform: naver·kakao 중 하나여야 합니다"],
    [{ sourceUrl: "javascript:alert(1)" }, "requirement.sourceUrl: http:// 또는 https://로 시작하는 원문 주소여야 합니다"],
    [{ checkedAt: "2026-02-30" }, "requirement.checkedAt: YYYY-MM-DD 날짜여야 합니다"],
    [{ effectiveFrom: "2026-03-02", effectiveTo: "2026-03-01" }, "requirement.effectiveTo: 적용 끝날이 시작일보다 앞입니다"],
    [{ reviewPeriod: { months: 13, basis: "closed_months", text: "x" } }, "requirement.reviewPeriod.months: 1~12 정수여야 합니다"],
    [{ reviewPeriod: { months: 3, basis: "rolling", text: "x" } }, "requirement.reviewPeriod.basis: closed_months·including_current 중 하나여야 합니다"],
    [{ reviewPeriod: { months: 3, basis: "closed_months" } }, "requirement.reviewPeriod.text: 규정 원문의 기간 글자가 필요합니다"],
    [{ passLine: 80 }, "requirement.passLine: 모르는 칸입니다"],
    [{ items: {} }, "requirement.items: 목록이어야 합니다"],
  ])("틀린 칸 %j → 거부", (change, message) => {
    expect(errorsOf(parseRequirementInput({ ...BODY, ...change }, "create"))).toEqual([message]);
  });

  test("고치기에서는 플랫폼·이어받기를 바꿀 수 없고, 바꿀 칸이 없으면 거부", () => {
    expect(errorsOf(parseRequirementInput({ platform: "kakao" }, "patch"))).toEqual(["requirement.platform: 플랫폼은 새 버전을 만들 때만 정합니다"]);
    expect(errorsOf(parseRequirementInput({ supersedesId: 3 }, "patch"))).toEqual(["requirement.supersedesId: 이어받는 버전은 새 버전을 만들 때만 정합니다"]);
    expect(errorsOf(parseRequirementInput({}, "patch"))).toEqual(["requirement: 바꿀 칸이 없습니다"]);
    const patch = parseRequirementInput({ title: "제목만 고침", sourceUrl: "" }, "patch");
    expect(patch.ok && patch.value).toEqual({ title: "제목만 고침", source_url: null });
  });

  test.each([
    [{ key: "Own Ratio" }, "requirement.items[0].key: 영문 소문자로 시작하고 영문 소문자·숫자·_만 씁니다 (40자)"],
    [{ metric: "score" }, "requirement.items[0].metric: count·ratio·per_reporter 중 하나여야 합니다"],
    [{ numerator: { contentTypes: ["news"] } }, "requirement.items[0].numerator.contentTypes: reported_news·explainer·guide·opinion·sponsored·digest 중에서 고릅니다"],
    [{ numerator: { reportingMethods: [] } }, "requirement.items[0].numerator.reportingMethods: 하나 이상 고르거나 칸을 빼세요"],
    [{ numerator: { assignmentKinds: ["feature", "feature"] } }, "requirement.items[0].numerator.assignmentKinds: 같은 값이 두 번 있습니다"],
    [{ numerator: { section: "tax" } }, "requirement.items[0].numerator.section: 모르는 칸입니다"],
    [{ numerator: { includeLegacy: "yes" } }, "requirement.items[0].numerator.includeLegacy: true/false여야 합니다"],
    [{ denominator: undefined }, "requirement.items[0].denominator: 비율 요건은 분모 거르개가 필요합니다"],
    [{ denominatorText: "" }, "requirement.items[0].denominatorText: 분모 정의 글자가 필요합니다"],
    [{ numeratorText: "  " }, "requirement.items[0].numeratorText: 분자 정의 글자가 필요합니다"],
    [{ exclusionsText: undefined }, "requirement.items[0].exclusionsText: 제외 조건 글자가 필요합니다 (없으면 '없음')"],
    [{ criterion: { comparator: "eq", value: 30, per: "period" } }, "requirement.items[0].criterion.comparator: gte(이상)·gt(초과) 중 하나여야 합니다"],
    [{ criterion: { comparator: "gte", value: 130, per: "period" } }, "requirement.items[0].criterion.value: 비율 기준은 0~100(%) 숫자여야 합니다"],
    [{ criterion: { comparator: "gte", value: 30, per: "month" } }, "requirement.items[0].criterion.per: 비율 기준은 심사 기간 전체(period)로만 봅니다"],
    [{ criterion: { comparator: "gte", value: -1, per: "period" } }, "requirement.items[0].criterion.value: 비율 기준은 0~100(%) 숫자여야 합니다"],
  ])("요건 항목 %j → 거부", (change, message) => {
    const item = { ...ITEM, ...change } as Record<string, unknown>;
    for (const k of Object.keys(change)) if ((change as Record<string, unknown>)[k] === undefined) delete item[k];
    expect(errorsOf(parseRequirementInput({ ...BODY, items: [item] }, "create"))).toEqual([message]);
  });

  test("기사 수·기자 1인당 요건 — 분모 거르개를 넣으면 거부, 기준은 0 이상 숫자·월평균 가능", () => {
    const count = { ...ITEM, key: "monthly", metric: "count", denominatorText: undefined, criterion: { comparator: "gte", value: 40, per: "month" } };
    delete (count as Record<string, unknown>).denominator;
    delete (count as Record<string, unknown>).denominatorText;
    expect(parseRequirementInput({ ...BODY, items: [count] }, "create").ok).toBe(true);
    expect(errorsOf(parseRequirementInput({ ...BODY, items: [{ ...count, denominator: {} }] }, "create"))).toEqual(["requirement.items[0].denominator: 비율 요건에만 분모 거르개를 씁니다"]);
    const perReporter = { ...count, key: "per_reporter", metric: "per_reporter", denominatorText: "그 기사를 쓴 기자 수" };
    expect(parseRequirementInput({ ...BODY, items: [perReporter] }, "create").ok).toBe(true);
    expect(errorsOf(parseRequirementInput({ ...BODY, items: [{ ...perReporter, denominatorText: undefined }] }, "create"))).toEqual([
      "requirement.items[0].denominatorText: 분모 정의 글자가 필요합니다",
    ]);
  });

  test("같은 key 두 번 · 21개 넘는 요건 거부, 기준 없는 요건(숫자만 보기)은 된다", () => {
    expect(errorsOf(parseRequirementInput({ ...BODY, items: [ITEM, ITEM] }, "create"))).toEqual(["requirement.items[1].key: 같은 key가 앞에 있습니다 (own_ratio)"]);
    const many = Array.from({ length: 21 }, (_, i) => ({ ...ITEM, key: `k${i}` }));
    expect(errorsOf(parseRequirementInput({ ...BODY, items: many }, "create"))).toEqual(["requirement.items: 요건은 20개까지 적습니다"]);
    expect(parseRequirementInput({ ...BODY, items: [{ ...ITEM, criterion: null }] }, "create").ok).toBe(true);
  });
});

// ── 확정 조건 ────────────────────────────────────────────

const row = (over: Partial<RequirementRow> = {}): RequirementRow => ({
  id: 1,
  platform: "naver",
  version: 1,
  title: "규정",
  media_type: "인터넷신문",
  source_url: "https://example.test/rules/2026",
  source_text_ref: "보관 위치",
  checked_at: "2026-10-10",
  effective_from: "2026-03-01",
  effective_to: null,
  review_period: { months: 3, basis: "closed_months", text: "임의의 3개월" },
  requirements: [ITEM],
  status: "unconfirmed",
  supersedes_id: null,
  note: null,
  created_by: "user:a",
  created_at: "2026-10-11T00:00:00Z",
  updated_by: null,
  updated_at: "2026-10-11T00:00:00Z",
  approved_by: null,
  approved_at: null,
  ...over,
});

describe("confirmProblems — 확정 전 검사 (NAV-13 수용 기준)", () => {
  const TODAY = "2026-10-18";
  test("다 갖추고 담당자 확인 표시가 있으면 문제 0", () => {
    expect(confirmProblems(row(), { attested: true }, TODAY)).toEqual([]);
  });
  test.each([
    [{ source_url: null }, "requirement.sourceUrl: 공식 규정 원문 주소가 필요합니다"],
    [{ checked_at: null }, "requirement.checkedAt: 원문을 확인한 날이 필요합니다"],
    [{ checked_at: "2026-10-19" }, "requirement.checkedAt: 확인일이 오늘(2026-10-18)보다 뒤입니다"],
    [{ media_type: null }, "requirement.mediaType: 매체 등록 유형이 필요합니다"],
    [{ effective_from: null }, "requirement.effectiveFrom: 적용 시작일이 필요합니다"],
    [{ review_period: null }, "requirement.reviewPeriod: 심사 대상 기간이 필요합니다"],
    [{ requirements: [] }, "requirement.items: 요건을 하나 이상 적어야 합니다"],
    [{ requirements: [{ ...ITEM, metric: "score" }] }, "requirement.items[0].metric: count·ratio·per_reporter 중 하나여야 합니다"],
  ])("%j 없음 → 확정 불가", (change, message) => {
    expect(confirmProblems(row(change as Partial<RequirementRow>), { attested: true }, TODAY)).toEqual([message]);
  });
  test("담당자 확인 표시가 없으면 확정 불가 · 이미 확정된 버전은 다시 확정하지 않는다", () => {
    expect(confirmProblems(row(), { attested: false }, TODAY)).toEqual(["requirement.attested: 공식 규정 원문과 우리 매체의 실제 등록 유형을 확인했다는 표시가 필요합니다"]);
    expect(confirmProblems(row({ status: "confirmed", approved_by: "user:b", approved_at: "2026-10-12T00:00:00Z" }), { attested: true }, TODAY)).toEqual([
      "requirement: 이미 확정된 버전입니다 — 바뀐 규정은 새 버전으로 적으세요",
    ]);
  });
});

// ── 적용 버전 · 요건 미확정 ─────────────────────────────

describe("platformState — 확정되고 오늘 적용되는 버전만, 없으면 요건 미확정", () => {
  const TODAY = "2026-10-18";
  const confirmed = (over: Partial<RequirementRow>) => row({ status: "confirmed", approved_by: "user:b", approved_at: "2026-10-12T00:00:00Z", ...over });

  test("버전이 하나도 없으면 none", () => {
    expect(platformState([], "naver", TODAY)).toEqual({ kind: "none", reason: "등록된 규정 버전이 없습니다" });
  });
  test("작성 중 버전만 있으면 요건 미확정 (확정 0)", () => {
    expect(platformState([row()], "naver", TODAY)).toEqual({ kind: "unconfirmed", reason: "작성 중인 버전만 있고 확정된 버전이 없습니다", drafts: 1 });
  });
  test("다른 플랫폼의 확정 버전은 보지 않는다", () => {
    expect(platformState([confirmed({ platform: "kakao" })], "naver", TODAY).kind).toBe("none");
  });
  test("적용 시작 전·끝난 확정 버전은 요건 미확정 — 이유에 버전과 날짜", () => {
    expect(platformState([confirmed({ version: 2, effective_from: "2026-10-19" })], "naver", TODAY)).toEqual({
      kind: "unconfirmed",
      reason: "확정된 버전이 있지만 오늘(2026-10-18)은 적용 기간 밖입니다 — 2번 2026-10-19부터",
      drafts: 0,
    });
    expect(platformState([confirmed({ effective_to: "2026-10-17" })], "naver", TODAY).kind).toBe("unconfirmed");
    expect(platformState([confirmed({ effective_from: TODAY, effective_to: TODAY })], "naver", TODAY).kind).toBe("confirmed");
  });
  test("적용 중 확정 버전이 둘이면 늦게 확정된 것 — 앞 버전도 남아 있다", () => {
    const v1 = confirmed({ id: 1, version: 1, approved_at: "2026-10-12T00:00:00Z" });
    const v2 = confirmed({ id: 2, version: 2, approved_at: "2026-10-15T00:00:00Z", title: "다음 규정" });
    const s = platformState([v2, v1, row({ id: 3, version: 3 })], "naver", TODAY);
    expect(s.kind).toBe("confirmed");
    if (s.kind !== "confirmed") return;
    expect(s.row.id).toBe(2);
    expect(s.items.map((i) => i.key)).toEqual(["own_ratio"]);
    expect(s.reviewPeriod).toEqual({ months: 3, basis: "closed_months", text: "임의의 3개월" });
    expect(s.drafts).toBe(1);
  });
  test("확정 버전의 요건 모양이 틀리면(직접 넣은 행) 요건 미확정 — 숫자 비교 0", () => {
    const s = platformState([confirmed({ requirements: [{ key: "x" }] })], "naver", TODAY);
    expect(s).toEqual({ kind: "unconfirmed", reason: "확정된 1번의 요건 모양이 틀려 쓸 수 없습니다 — 새 버전으로 바로 적으세요", drafts: 0 });
  });
  test("readStoredItems — 저장된 요건 읽기 (모양이 틀리면 null)", () => {
    expect(readStoredItems([ITEM])).toEqual([ITEM]);
    expect(readStoredItems({})).toBeNull();
    expect(readStoredItems([{ ...ITEM, criterion: { comparator: "gte", value: "30", per: "period" } }])).toBeNull();
  });
});
