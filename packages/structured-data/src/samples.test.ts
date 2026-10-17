// W1-b 완료 증거 — 통과 견본은 통과하고, 차단 견본은 적힌 오류 하나로 실패한다 (OPT-02 "유형별 견본 7유형 검사 오류 0").
import { describe, expect, it } from "vitest";
import { pageJsonLd } from "./page";
import { validate } from "./validate";
import { PAGE_TYPE_MAP } from "./types-map";
import { extraPassSamples, passSamples } from "../fixtures/samples";
import { blockedSamples } from "../fixtures/blocked";

describe("통과 견본 — 유형별 7유형 검사 오류 0", () => {
  it("대응표의 모든 페이지 유형에 통과 견본이 하나씩 있다", () => {
    expect(Object.keys(passSamples).sort()).toEqual(Object.keys(PAGE_TYPE_MAP).sort());
  });

  it.each(Object.entries(passSamples))("%s 견본 → 오류 0", (_kind, input) => {
    const nodes = pageJsonLd(input);
    expect(nodes.length).toBeGreaterThan(0);
    expect(validate(nodes)).toEqual([]);
  });

  it.each(extraPassSamples.map((s) => [s.id, s.input] as const))("%s 견본 → 오류 0", (_id, input) => {
    expect(validate(pageJsonLd(input))).toEqual([]);
  });
});

describe("차단 견본 — 항목 하나만 어기면 그 오류 하나만 나온다", () => {
  it("차단 견본 id가 겹치지 않는다", () => {
    const ids = blockedSamples.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(blockedSamples.map((s) => [s.id, s] as const))("%s", (_id, sample) => {
    const errors = validate(pageJsonLd(sample.input));
    expect(errors.map((e) => ({ path: e.path, code: e.code }))).toEqual([sample.expected]);
    expect(errors[0].message.length).toBeGreaterThan(0);
  });
});
