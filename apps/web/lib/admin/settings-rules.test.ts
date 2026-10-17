// 운영 설정(settings) 값 검사 시험 — 아는 키마다 모양을 검사하고, 틀리면 칸 경로가 붙은 오류. 검사를 지난 값은 발행 판정 설정 읽기를 통과한다.
import { describe, expect, test } from "vitest";
import { parseGateSettings } from "@/lib/server/articles/gate";
import { isEditableSetting, parseJsonText, sameJson, validateSettingValue } from "./settings-rules";

const SIM = {
  version: "similarity-internal-2026-10-17.1",
  sentenceSimilarity: 0.9,
  sentenceComparator: "gte",
  articleRatio: 0.6,
  articleComparator: "gt",
  quoteRatio: 0.3,
  quoteComparator: "gt",
};
const errorsOf = (r: { ok: boolean; errors?: string[] }) => (r.ok ? [] : (r as { errors: string[] }).errors);

describe("JSON 글 읽기", () => {
  test("JSON이면 값, 아니면 오류 문장", () => {
    expect(parseJsonText('{"a": 1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseJsonText('"promulgated"')).toEqual({ ok: true, value: "promulgated" });
    expect(parseJsonText("{a: 1}")).toEqual({ ok: false, error: "JSON 형식이 아닙니다 — 따옴표·쉼표·괄호를 확인하세요" });
    expect(parseJsonText("   ")).toEqual({ ok: false, error: "값을 적어 주세요" });
  });
});

describe("유사도 기준 similarity_internal (OPT-06)", () => {
  test("버전을 바꾸고 0~1 비율·gt/gte를 쓰면 통과 — 경계 0과 1 포함", () => {
    const next = { ...SIM, version: "s2", sentenceSimilarity: 1, articleRatio: 0, quoteRatio: 0.25 };
    expect(validateSettingValue("similarity_internal", next, SIM)).toEqual({ ok: true, value: next });
  });
  test.each([
    ["sentenceSimilarity", 1.01, "sentenceSimilarity: 0~1 사이 숫자여야 합니다"],
    ["articleRatio", -0.01, "articleRatio: 0~1 사이 숫자여야 합니다"],
    ["quoteRatio", "0.3", "quoteRatio: 0~1 사이 숫자여야 합니다"],
    ["articleComparator", "ge", "articleComparator: gt(초과)·gte(이상) 중 하나여야 합니다"],
    ["version", "", "version: 버전 글자가 필요합니다"],
  ])("%s = %j → 칸 오류", (key, value, message) => {
    expect(errorsOf(validateSettingValue("similarity_internal", { ...SIM, version: "s2", [key]: value }, SIM))).toEqual([message]);
  });
  test("칸이 빠지거나 모르는 칸이 있으면 거부", () => {
    const missing: Record<string, unknown> = { ...SIM };
    delete missing.quoteComparator;
    expect(errorsOf(validateSettingValue("similarity_internal", { ...missing, version: "s2" }, SIM))).toEqual(["quoteComparator: 필요합니다"]);
    expect(errorsOf(validateSettingValue("similarity_internal", { ...SIM, version: "s2", extra: 1 }, SIM))).toEqual(["extra: 모르는 칸입니다"]);
    expect(errorsOf(validateSettingValue("similarity_internal", [0.9], SIM))).toEqual(["값은 JSON 객체여야 합니다"]);
  });
  test("기준값을 바꾸면서 버전을 그대로 두면 거부 — 점검 기록에 남는 버전이 값과 어긋난다", () => {
    expect(errorsOf(validateSettingValue("similarity_internal", { ...SIM, articleRatio: 0.5 }, SIM))).toEqual([
      "version: 기준값을 바꾸면 버전도 바꿔야 합니다 (지금 similarity-internal-2026-10-17.1)",
    ]);
    expect(validateSettingValue("similarity_internal", { ...SIM }, SIM).ok).toBe(true);
  });
  test("검사를 지난 값은 발행 판정 설정 읽기를 통과한다", () => {
    const next = { ...SIM, version: "s3", quoteRatio: 0.2 };
    expect(validateSettingValue("similarity_internal", next, SIM).ok).toBe(true);
    const { problems, settings } = parseGateSettings(
      [
        { key: "forbidden_phrases", value: { version: "v", phrases: ["a"] } },
        { key: "fear_phrases", value: { version: "v", phrases: ["b"] } },
        { key: "similarity_internal", value: next },
      ],
      [],
    );
    expect(problems).toEqual([]);
    expect(settings.similarity.quoteRatio).toBe(0.2);
  });
});

describe("사전 forbidden_phrases · fear_phrases", () => {
  const cur = { version: "2026-10-17.1", phrases: ["절세 보장", "무조건"] };
  test("표현을 바꾸고 버전도 바꾸면 통과", () => {
    expect(validateSettingValue("forbidden_phrases", { version: "2026-10-18.1", phrases: ["절세 보장"] }, cur).ok).toBe(true);
  });
  test("빈 목록·겹친 표현·긴 표현·버전 그대로는 거부", () => {
    expect(errorsOf(validateSettingValue("fear_phrases", { version: "v2", phrases: [] }, cur))).toEqual(["phrases: 표현이 하나 이상 있어야 합니다"]);
    expect(errorsOf(validateSettingValue("fear_phrases", { version: "v2", phrases: ["큰일", "큰일 "] }, cur))).toEqual(["phrases[1]: 같은 표현이 앞에 있습니다 (큰일)"]);
    expect(errorsOf(validateSettingValue("fear_phrases", { version: "v2", phrases: ["가".repeat(41)] }, cur))).toEqual(["phrases[0]: 표현은 40자 이하로 씁니다"]);
    expect(errorsOf(validateSettingValue("forbidden_phrases", { version: "2026-10-17.1", phrases: ["절세 보장"] }, cur))).toEqual([
      "version: 표현 목록을 바꾸면 버전도 바꿔야 합니다 (지금 2026-10-17.1)",
    ]);
  });
});

describe("개정 확정 기준 단계 amendment_confirmed_stage (TX-08)", () => {
  test("6단계 값 중 하나인 JSON 글자", () => {
    expect(validateSettingValue("amendment_confirmed_stage", "effective", "promulgated")).toEqual({ ok: true, value: "effective" });
    expect(errorsOf(validateSettingValue("amendment_confirmed_stage", "공포", "promulgated"))).toEqual([
      "값: announced·pre_notice·submitted·passed·promulgated·effective 중 하나여야 합니다",
    ]);
  });
});

describe("화면에서 고칠 수 있는 설정", () => {
  test("검사 규칙이 있는 키만 고친다 — 모르는 키는 거부(닫힌 쪽)", () => {
    expect(isEditableSetting("similarity_internal")).toBe(true);
    expect(isEditableSetting("hot_weights")).toBe(false);
    expect(validateSettingValue("hot_weights", { views: 1 }, null)).toEqual({ ok: false, errors: ["이 설정은 검사 규칙이 아직 없어 화면에서 고칠 수 없습니다"] });
  });
});

describe("바뀐 값인가", () => {
  test("객체 칸 순서만 다르면 같은 값, 배열 순서가 다르면 다른 값", () => {
    expect(sameJson({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(sameJson({ a: 1, b: [1, 2] }, { a: 1, b: [2, 1] })).toBe(false);
    expect(sameJson("promulgated", "effective")).toBe(false);
  });
});

describe("W2-b 공개 설정 — 관리자 화면이 고치는 값과 공개 데이터 함수가 읽는 모양이 같다 (설계 2.3·2.4)", () => {
  test("공개 키 6개 모두 고칠 수 있다", () => {
    for (const key of ["home_core_message", "home_search_chips", "hub_intros", "hub_situation_limit", "feature_flags", "next_action_priority"]) {
      expect(isEditableSetting(key)).toBe(true);
    }
  });

  test("핵심 메시지 — 60자는 통과, 61자·빈 글자·글자 아님은 거부 (R8)", () => {
    expect(validateSettingValue("home_core_message", "가".repeat(60), null).ok).toBe(true);
    expect(errorsOf(validateSettingValue("home_core_message", "가".repeat(61), null))[0]).toMatch(/60자 이하/);
    expect(validateSettingValue("home_core_message", "  ", null).ok).toBe(false);
    expect(validateSettingValue("home_core_message", 3, null).ok).toBe(false);
  });

  test("추천 검색어 — 0개·3개·6개 통과, 2개·7개·중복·빈 글자·21자 거부 (HOME-01)", () => {
    for (const ok of [[], ["취득세", "개편안", "책임준공"], ["a", "b", "c", "d", "e", "f"]]) expect(validateSettingValue("home_search_chips", ok, null).ok).toBe(true);
    for (const bad of [["취득세", "개편안"], ["a", "b", "c", "d", "e", "f", "g"], ["취득세", "취득세 ", "개편안"], ["취득세", "", "개편안"], ["가".repeat(21), "b", "c"], "취득세"]) {
      expect(validateSettingValue("home_search_chips", bad, null).ok).toBe(false);
    }
  });

  test("허브 소개 — 4대 분야 키만, 60자 이하", () => {
    expect(validateSettingValue("hub_intros", { tax: "지방세 개정과 해석을 쉽게 풉니다" }, null).ok).toBe(true);
    expect(errorsOf(validateSettingValue("hub_intros", { tourism: "관광" }, null))).toEqual(["tourism: 4대 분야(tax·realestate·finance·local)만 씁니다"]);
    expect(validateSettingValue("hub_intros", { local: "가".repeat(61) }, null).ok).toBe(false);
  });

  test("허브 상황 카드 상한 — 1~12 정수", () => {
    for (const ok of [1, 4, 12]) expect(validateSettingValue("hub_situation_limit", ok, null).ok).toBe(true);
    for (const bad of [0, 13, 4.5, "4"]) expect(validateSettingValue("hub_situation_limit", bad, null).ok).toBe(false);
  });

  test("기능 공개 목록 — 아는 키에 true/false만", () => {
    expect(validateSettingValue("feature_flags", { search: true, calc: false }, null).ok).toBe(true);
    expect(errorsOf(validateSettingValue("feature_flags", { tourism: true, search: "yes" }, null))).toEqual(["tourism: 모르는 기능 키입니다", "search: true/false여야 합니다"]);
  });

  test("다음 행동 우선순위 — 아는 버튼 키, 중복 없이 1개 이상", () => {
    expect(validateSettingValue("next_action_priority", ["expert_finder", "situation"], null).ok).toBe(true);
    for (const bad of [[], ["situation", "situation"], ["call_us"], "situation"]) expect(validateSettingValue("next_action_priority", bad, null).ok).toBe(false);
  });
});
