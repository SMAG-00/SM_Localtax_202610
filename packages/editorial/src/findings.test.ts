import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BASE_CONTEXT } from "../fixtures/context";
import { checkScreenCopy } from "./checks/plain-language";
import { RULES, finding, sortFindings, type Finding } from "./findings";

describe("규칙 목록", () => {
  it("항목 ID는 겹치지 않는다", () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("항목 ID 앞머리가 근거 PRD ID와 맞는다 (nav10.* → NAV-10)", () => {
    for (const rule of RULES) {
      const prefix = rule.id.split(".")[0]!;
      // nav10 → NAV-10 · reg1_07 → REG1-07 (01B 지역 요구사항 ID)
      const expected = prefix
        .replace(/^([a-z]+)(\d+)_(\d+)$/, (_m, letters: string, group: string, digits: string) => `${letters.toUpperCase()}${group}-${digits}`)
        .replace(/^([a-z]+)(\d+)$/, (_m, letters: string, digits: string) => `${letters.toUpperCase()}-${digits}`);
      expect(rule.ruleRef).toBe(expected);
    }
  });

  it("README 규칙 표가 규칙 목록과 같다 (ID · 근거 · 등급 · 이름, 순서까지)", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const rows = readme
      .split(/\r?\n/)
      .filter((line) => /^\| `[a-z0-9._-]+` \|/.test(line))
      .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
    const expected = RULES.map((r) => [`\`${r.id}\``, r.ruleRef, r.level === "block" ? "차단" : "경고", r.title]);
    expect(rows).toEqual(expected);
  });

  it("규칙 이름(편집 화면 고정 문구)을 금지·공포 표현 사전과 안내 문장 기준으로 검사한 결과 0건 (UX-01·UX-03)", () => {
    const copy = RULES.map((r) => ({ id: r.id, kind: "guide" as const, text: r.title }));
    expect(checkScreenCopy(copy, BASE_CONTEXT)).toEqual([]);
  });

  it("경고 항목은 W2-a 설계 §4 표의 경고 칸 그대로 — 실명 표현 · 풀이 없는 용어 · 60자 · 3문장 · seo-lint 경고 · 유사도 비교 대상 없음", () => {
    expect(RULES.filter((r) => r.level === "warn").map((r) => r.id)).toEqual([
      "cat05.real-name",
      "ux01.jargon-unexplained",
      "ux01.guide-sentence-long",
      "ux01.box-too-many-sentences",
      "opt03.seo-lint-warning",
      "opt06.similarity-unverified",
    ]);
  });
});

describe("항목 만들기와 정렬", () => {
  it("등급과 근거는 규칙 목록에서 읽는다", () => {
    expect(finding("nav10.no-causal-claim", "체크하세요")).toEqual({
      id: "nav10.no-causal-claim",
      level: "block",
      ruleRef: "NAV-10",
      message: "체크하세요",
    });
    expect(finding("cat05.real-name", "실명?", { field: "solvedCase.situation", phrase: "김민수 씨" })).toEqual({
      id: "cat05.real-name",
      level: "warn",
      ruleRef: "CAT-05",
      message: "실명?",
      location: { field: "solvedCase.situation", phrase: "김민수 씨" },
    });
  });

  it("차단 먼저, 다음은 규칙 목록 순서, 같은 규칙은 블록·문장 위치 순서 — 입력 순서와 상관없다", () => {
    const warn = finding("ux01.guide-sentence-long", "길다", { field: "summary", sentenceIndex: 0 });
    const lateBlock = finding("ux01.forbidden-phrase", "금지", { field: "blocks", blockIndex: 4, sentenceIndex: 0 });
    const earlyBlock = finding("ux01.forbidden-phrase", "금지", { field: "blocks", blockIndex: 1, sentenceIndex: 2 });
    const firstRule = finding("art01.section-required", "분야");
    const unknown: Finding = { id: "reg117.editorial-field", level: "block", ruleRef: "REG1-17", message: "확장" };
    const expected = [firstRule, earlyBlock, lateBlock, unknown, warn];
    expect(sortFindings([warn, lateBlock, unknown, earlyBlock, firstRule])).toEqual(expected);
    expect(sortFindings([unknown, firstRule, warn, earlyBlock, lateBlock])).toEqual(expected);
  });
});
