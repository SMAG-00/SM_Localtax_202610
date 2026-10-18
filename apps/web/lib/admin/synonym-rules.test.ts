// 검색 동의어 사전 규칙 (W2-d 설계 5장 · 2.3 synonym_limits · 2.4 admin.synonym_note_chars) — 설계 문서 표를 읽어 대조한다
//  · 낱말 1~50자(글자·숫자 있어야) · 동의어 1~10개 · 하나마다 50자 · 띄어쓰기·기호만 다른 같은 말 한 번만 · 낱말 자신은 동의어 0 · 메모 200자
//  · DB 제약(search_synonyms_shape·term_key)과 같은 규칙 — 화면이 API를 부르기 전에, 서버가 DB에 쓰기 전에 막는다
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { SYNONYM_LIMITS, emptySynonymForm, parseSynonymInput, synonymConsistency, synonymFormToBody, synonymToForm, termKeyPreview } from "./synonym-rules";

const MD = fs.readFileSync(path.resolve(__dirname, "../../../../docs/dev/W2-d_설계.md"), "utf8");
const values = (name: string) => [...MD.split("\n").find((l) => l.startsWith(`| ${name} `))!.split("|")[2]!.matchAll(/`([^`]*)`/g)].map((m) => Number(m[1]));
const errors = (raw: Record<string, unknown>, mode: "create" | "patch" = "create") => {
  const r = parseSynonymInput(raw, mode);
  return r.ok ? [] : r.errors;
};

describe("설계 문서와 같은 한도", () => {
  test("2.3 synonym_limits(낱말 글자·동의어 개수·동의어 글자) · 2.4 메모 글자", () => {
    expect([SYNONYM_LIMITS.termChars, SYNONYM_LIMITS.count, SYNONYM_LIMITS.synonymChars]).toEqual(values("synonym_limits"));
    expect(SYNONYM_LIMITS.noteChars).toBe(values("admin.synonym_note_chars")[0]);
  });
});

describe("만들기·고치기 본문", () => {
  test("앞뒤 공백을 지우고, 사용 여부 기본 켜짐·빈 메모는 null — 경계 50자·10개는 받는다", () => {
    const syn = Array.from({ length: 10 }, (_, i) => `동의어${i + 1}`);
    expect(parseSynonymInput({ term: "  자동차 매도 ", synonyms: [" 차 팔았 ", ...syn.slice(1)], note: "  " }, "create")).toEqual({
      ok: true,
      value: { term: "자동차 매도", synonyms: ["차 팔았", ...syn.slice(1)], enabled: true, note: null },
    });
    expect(parseSynonymInput({ term: "가".repeat(50), synonyms: ["나".repeat(50)] }, "create").ok).toBe(true);
    expect(parseSynonymInput({ enabled: false }, "patch")).toEqual({ ok: true, value: { enabled: false } });
    expect(parseSynonymInput({ note: "편집국 메모" }, "patch")).toEqual({ ok: true, value: { note: "편집국 메모" } });
  });

  test.each([
    [{ synonyms: ["a"] }, "synonym.term: 낱말이 필요합니다"],
    [{ term: " ", synonyms: ["a"] }, "synonym.term: 낱말이 필요합니다"],
    [{ term: "가".repeat(51), synonyms: ["a"] }, "synonym.term: 50자 이하로 줄이세요"],
    [{ term: "?!", synonyms: ["a"] }, "synonym.term: 글자나 숫자가 있어야 합니다 — 기호만 있는 낱말은 찾을 수 없습니다"],
    [{ term: "취득세" }, "synonym.synonyms: 동의어를 1개 이상 적으세요"],
    [{ term: "취득세", synonyms: [] }, "synonym.synonyms: 동의어를 1개 이상 적으세요"],
    [{ term: "취득세", synonyms: Array.from({ length: 11 }, (_, i) => `말${i}`) }, "synonym.synonyms: 동의어는 10개까지입니다 — 지금 11개"],
    [{ term: "취득세", synonyms: ["나".repeat(51)] }, `synonym.synonyms: 동의어마다 50자 이하로 줄이세요 — ‘${"나".repeat(51)}’`],
    [{ term: "취득세", synonyms: ["a", " "] }, "synonym.synonyms: 빈 동의어가 있습니다"],
    [{ term: "취득세", synonyms: ["·?"] }, "synonym.synonyms: 글자나 숫자가 없는 동의어는 찾을 수 없습니다 — ‘·?’"],
    [{ term: "취득세", synonyms: ["부동산 취득", "부동산취득"] }, "synonym.synonyms: 같은 동의어가 두 번 있습니다(띄어쓰기·기호만 다른 것 포함) — ‘부동산취득’"],
    [{ term: "취득세", synonyms: ["취득 세"] }, "synonym.synonyms: 낱말 자신은 동의어로 넣지 않습니다 — ‘취득 세’"],
    [{ term: "취득세", synonyms: "취득" }, "synonym.synonyms: 글자 목록이어야 합니다"],
    [{ term: "취득세", synonyms: ["a"], enabled: "yes" }, "synonym.enabled: 참/거짓이어야 합니다"],
    [{ term: "취득세", synonyms: ["a"], note: "가".repeat(201) }, "synonym.note: 200자 이하로 줄이세요"],
    [{ term: "취득세", synonyms: ["a"], termKey: "x" }, "synonym.termKey: 모르는 칸입니다"],
  ])("%j → 거부", (raw, message) => {
    expect(errors(raw)).toEqual([message]);
  });

  test("고치기는 보낸 칸만 — 빈 본문은 거부", () => {
    expect(errors({}, "patch")).toEqual(["synonym: 바꿀 칸이 없습니다"]);
    expect(parseSynonymInput({ synonyms: ["양도"] }, "patch")).toEqual({ ok: true, value: { synonyms: ["양도"] } });
  });

  test("고친 뒤의 줄 전체 — 낱말만 바꿔 동의어와 같아지면 거부", () => {
    expect(synonymConsistency({ term: "매도", synonyms: ["양도", "팔기"] })).toBeNull();
    expect(synonymConsistency({ term: "양 도", synonyms: ["양도", "팔기"] })).toBe("낱말 자신은 동의어로 넣지 않습니다 — ‘양도’");
  });

  test("찾는 열쇠 미리보기 — DB 정규형(term_key)과 같은 규칙", () => {
    expect(termKeyPreview(" 자동차 매도 ")).toBe("자동차매도");
    expect(termKeyPreview("ＰＦ-ABS")).toBe("pfabs");
    expect(termKeyPreview("?!")).toBe("");
  });
});

describe("화면 폼 → 본문", () => {
  test("동의어는 쉼표·줄바꿈으로 나눈다 — 빈 칸은 뺀다", () => {
    const r = synonymFormToBody({ ...emptySynonymForm(), term: "매도", synonymsText: "양도, 팔기\n\n 처분 ", note: "" }, "synonym-new");
    expect(r).toEqual({ ok: true, body: { term: "매도", synonyms: ["양도", "팔기", "처분"], enabled: true, note: null } });
  });

  test("칸마다 오류 — API를 부르기 전에 (칸 id는 base-칸)", () => {
    const r = synonymFormToBody({ ...emptySynonymForm(), term: "?!", synonymsText: "" }, "synonym-new");
    expect(!r.ok && r.errors).toEqual({ "synonym-new-term": "글자나 숫자가 있어야 합니다 — 기호만 있는 낱말은 찾을 수 없습니다", "synonym-new-synonyms": "동의어를 1개 이상 적으세요" });
    const many = synonymFormToBody({ ...emptySynonymForm(), term: "매도", synonymsText: Array.from({ length: 11 }, (_, i) => `말${i}`).join(",") }, "s");
    expect(!many.ok && many.errors).toEqual({ "s-synonyms": "동의어는 10개까지입니다 — 지금 11개" });
    const self = synonymFormToBody({ ...emptySynonymForm(), term: "매도", synonymsText: "양도, 매 도" }, "s");
    expect(!self.ok && self.errors).toEqual({ "s-synonyms": "낱말 자신은 동의어로 넣지 않습니다 — ‘매 도’" });
  });

  test("저장된 줄 → 폼 → 본문이 원래 값", () => {
    const row = { term: "매도", synonyms: ["양도", "팔기"], enabled: false, note: "메모" };
    expect(synonymFormToBody(synonymToForm(row), "s")).toEqual({ ok: true, body: row });
  });
});
