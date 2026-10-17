// 금지 표현·공포 표현 사전 편집 규칙 시험 (UX-01 · UX-03) — settings 값 모양 { version, phrases }은 발행 판정(parseGateSettings)이 읽는 모양 그대로다.
import { describe, expect, test } from "vitest";
import { parseGateSettings } from "@/lib/server/articles/gate";
import { applyPhraseChange, nextDictionaryVersion, phraseError, readPhraseDictionary } from "./dictionary-rules";

const dict = { version: "2026-10-17.1", phrases: ["절세 보장", "무조건"] };

describe("표현 하나 더하기·빼기", () => {
  test("더하면 끝에 붙고 버전이 오늘 날짜로 바뀐다", () => {
    expect(applyPhraseChange(dict, "add", "  투자   적기 ", "2026-10-18")).toEqual({
      ok: true,
      value: { version: "2026-10-18.1", phrases: ["절세 보장", "무조건", "투자 적기"] },
    });
  });
  test("같은 날 두 번째 변경은 번호가 오른다", () => {
    expect(nextDictionaryVersion("2026-10-18.1", "2026-10-18")).toBe("2026-10-18.2");
    expect(nextDictionaryVersion("2026-10-18.9", "2026-10-18")).toBe("2026-10-18.10");
    expect(nextDictionaryVersion("v1", "2026-10-18")).toBe("2026-10-18.1");
  });
  test("공백만 다른 같은 표현은 이미 있는 것으로 본다 (판정도 연속 공백을 하나로 맞춰 비교한다) → 409", () => {
    expect(applyPhraseChange(dict, "add", "절세  보장", "2026-10-18")).toEqual({ ok: false, status: 409, message: "이미 사전에 있는 표현입니다: 절세 보장" });
  });
  test("빼면 그 표현만 빠진다 — 공백이 달라도 같은 표현을 뺀다", () => {
    expect(applyPhraseChange(dict, "remove", " 무조건 ", "2026-10-18")).toEqual({ ok: true, value: { version: "2026-10-18.1", phrases: ["절세 보장"] } });
  });
  test("없는 표현을 빼면 404", () => {
    expect(applyPhraseChange(dict, "remove", "최저가", "2026-10-18")).toMatchObject({ ok: false, status: 404 });
  });
  test("마지막 표현은 뺄 수 없다 — 빈 사전으로 판정하지 않는다 (422)", () => {
    expect(applyPhraseChange({ version: "v", phrases: ["큰일"] }, "remove", "큰일", "2026-10-18")).toMatchObject({ ok: false, status: 422 });
  });
});

describe("표현 검사", () => {
  test.each([
    ["", "표현을 적어 주세요"],
    ["   ", "표현을 적어 주세요"],
    ["가".repeat(41), "표현은 40자 이하로 씁니다"],
    ["두 줄\n표현", "표현은 한 줄로 씁니다"],
  ])("'%s' → %s", (phrase, message) => {
    expect(phraseError(phrase)).toBe(message);
  });
  test("40자는 통과", () => {
    expect(phraseError("가".repeat(40))).toBeNull();
  });
});

describe("settings 값 읽기", () => {
  test("{ version, phrases } 모양만 사전으로 읽는다", () => {
    expect(readPhraseDictionary({ version: "v1", phrases: ["a", "b"] })).toEqual({ version: "v1", phrases: ["a", "b"] });
    expect(readPhraseDictionary({ phrases: ["a"] })).toEqual({ version: "", phrases: ["a"] });
    expect(readPhraseDictionary({ version: "v1", phrases: "a" })).toBeNull();
    expect(readPhraseDictionary(null)).toBeNull();
  });
  test("바꾼 값은 발행 판정 설정 읽기(parseGateSettings)를 그대로 통과한다", () => {
    const r = applyPhraseChange(dict, "add", "시험 표현", "2026-10-18");
    if (!r.ok) throw new Error(r.message);
    const { settings, problems } = parseGateSettings(
      [
        { key: "forbidden_phrases", value: r.value },
        { key: "fear_phrases", value: { version: "v", phrases: ["큰일"] } },
      ],
      [],
    );
    expect(problems).toEqual([]);
    expect(settings.dictionaries.forbiddenPhrases).toContain("시험 표현");
  });
});
