// CAT-05 해결 사례 — 4칸·결과 근거·개인정보 형식(차단)·실명 표현(경고), 저장 검사 validateSolvedCaseForSave
import { describe, expect, it } from "vitest";
import { BASE_CONTEXT } from "../../fixtures/context";
import { SOLVED_CASE, TAX_EXPLAINER } from "../../fixtures/explainer";
import { uniqueIds, withExtraBlock } from "../../fixtures/helpers";
import { evaluatePublish } from "../evaluate";
import type { ArticleForPublish, SolvedCase } from "../model";
import { validateSolvedCaseForSave } from "./solved-case";

const sc = SOLVED_CASE.solvedCase!;
const run = (article: ArticleForPublish) => evaluatePublish(article, BASE_CONTEXT);
const withCase = (patch: Partial<SolvedCase>): ArticleForPublish => ({ ...SOLVED_CASE, solvedCase: { ...sc, ...patch } });

describe("CAT-05 4칸 — 하나라도 비면 발행 불가", () => {
  it.each(["situation", "issue", "result", "lesson"] as const)("%s 칸이 비면 그 칸 위치로 차단", (cell) => {
    const result = run(withCase({ [cell]: "  " }));
    expect(result.blockers).toEqual([
      expect.objectContaining({ id: "cat05.cell-empty", location: { field: `solvedCase.${cell}` } }),
    ]);
  });

  it("사례 내용이 아예 없으면 4칸 모두 + 결과 근거 0", () => {
    const result = run({ ...SOLVED_CASE, solvedCase: null });
    expect(result.blockers.map((f) => [f.id, f.location?.field])).toEqual([
      ["cat05.cell-empty", "solvedCase.issue"],
      ["cat05.cell-empty", "solvedCase.lesson"],
      ["cat05.cell-empty", "solvedCase.result"],
      ["cat05.cell-empty", "solvedCase.situation"],
      ["cat05.result-evidence", undefined],
    ]);
  });
});

describe("CAT-05 결과 근거 — 사건번호 또는 해석 번호 + 출처 링크 1개 이상", () => {
  it.each([
    ["0개", []],
    ["번호 없음", [{ kind: "decision" as const, number: "", url: "https://decisions.example.kr/tt/2025-ji-0001" }]],
    ["링크 없음", [{ kind: "interpretation" as const, number: "부동산세제과-1234", url: "" }]],
    ["링크가 주소 형식이 아님", [{ kind: "decision" as const, number: "조심2025지0001", url: "조세심판원 누리집" }]],
  ])("%s → 발행 불가", (_name, resultEvidence) => {
    expect(uniqueIds(run(withCase({ resultEvidence })).blockers)).toEqual(["cat05.result-evidence"]);
  });

  it("해석 번호 + 링크 1개면 통과", () => {
    const resultEvidence = [{ kind: "interpretation" as const, number: "부동산세제과-1234", url: "https://interpretations.example.kr/1234" }];
    expect(run(withCase({ resultEvidence })).canPublish).toBe(true);
  });
});

describe("CAT-05 개인정보 형식 — 발행 차단, 위치와 찾은 글자를 알려 준다", () => {
  it.each([
    ["situation", "주민등록번호", "납세자(900101-1234567)는 계약일부터 셌다.", "900101-1234567"],
    ["issue", "전화번호", "연락처 02-1234-5678로 받은 안내가 쟁점이었다.", "02-1234-5678"],
    ["result", "이메일", "결정문은 kim.minsu@example.com으로 받았다.", "kim.minsu@example.com"],
    ["lesson", "지번 주소", "가온시 누리구 새빛동 123번지 주택처럼 잔금일을 확인합니다.", "누리구 새빛동 123번지"],
  ] as const)("%s 칸의 %s", (cell, _kind, text, match) => {
    const result = run(withCase({ [cell]: text }));
    expect(result.blockers).toEqual([
      expect.objectContaining({ id: "cat05.pii", location: { field: `solvedCase.${cell}`, sentenceIndex: 0, phrase: match } }),
    ]);
  });

  it("본문 블록에 있어도 막는다", () => {
    const article = withExtraBlock(SOLVED_CASE, { type: "paragraph", text: "문의는 010-9876-5432로 했다." });
    expect(run(article).blockers).toEqual([
      expect.objectContaining({ id: "cat05.pii", location: { field: "blocks", blockIndex: 1, sentenceIndex: 0, phrase: "010-9876-5432" } }),
    ]);
  });

  it("해결 사례가 아닌 기사는 이 검사 대상이 아니다 (기관 대표 전화 등)", () => {
    const article = withExtraBlock(TAX_EXPLAINER, { type: "paragraph", text: "문의는 가온시 세정과(031-123-4567)로 하면 된다." });
    expect(run(article).blockers).toEqual([]);
  });
});

describe("CAT-05 실명으로 보이는 표현 — 경고(발행은 된다)", () => {
  it("성+이름+'씨' → 경고 1건, 발행 가능", () => {
    const result = run(withCase({ situation: "납세자 김민수 씨는 계약일부터 60일을 세어 신고했다." }));
    expect(result.canPublish).toBe(true);
    expect(result.warnings).toEqual([
      {
        id: "cat05.real-name",
        level: "warn",
        ruleRef: "CAT-05",
        message: "실명으로 보이는 표현 ‘김민수 씨’ — 알아볼 수 없게 바꿔 주세요",
        location: { field: "solvedCase.situation", sentenceIndex: 0, phrase: "김민수 씨" },
      },
    ]);
  });

  it("'김모 씨'처럼 가린 표현은 경고하지 않는다", () => {
    expect(run(withCase({ situation: "납세자 김모 씨는 계약일부터 60일을 세어 신고했다." })).warnings).toEqual([]);
  });
});

describe("저장 검사 validateSolvedCaseForSave", () => {
  it("견본 사례는 저장된다", () => {
    expect(validateSolvedCaseForSave(sc)).toEqual({ ok: true, findings: [] });
  });

  it("개인정보 형식이 있으면 저장 거부", () => {
    const result = validateSolvedCaseForSave({ ...sc, issue: "상담 메일 kim@example.com 내용이 쟁점이었다." });
    expect(result.ok).toBe(false);
    expect(uniqueIds(result.findings)).toEqual(["cat05.pii"]);
  });

  it("실명 표현만 있으면 경고와 함께 저장된다", () => {
    const result = validateSolvedCaseForSave({ ...sc, lesson: "이영희 님처럼 잔금일부터 셉니다." });
    expect(result.ok).toBe(true);
    expect(uniqueIds(result.findings)).toEqual(["cat05.real-name"]);
  });

  it("빈 칸은 저장 때가 아니라 발행 때 막는다 (작성 중 저장 허용)", () => {
    expect(validateSolvedCaseForSave({ ...sc, lesson: "" })).toEqual({ ok: true, findings: [] });
  });
});
