import { describe, expect, test } from "vitest";
import { citationTally, parseEngines, parseQuestionLines, parseSampleInput, tallyByEngine } from "./ai-citation";

const lines = (n: number) => Array.from({ length: n }, (_, i) => `시험용 질문 ${i + 1}`).join("\n");

describe("핵심 질문 50개 (OPT-09)", () => {
  test("정확히 50문항만 통과 — 49·51은 거부하고 개수를 알린다", () => {
    expect(parseQuestionLines(lines(50)).ok).toBe(true);
    const r49 = parseQuestionLines(lines(49));
    expect(r49.ok).toBe(false);
    expect(!r49.ok && r49.errors[0]).toContain("지금 49문항");
    expect(parseQuestionLines(lines(51)).ok).toBe(false);
  });
  test("빈 줄은 무시하고 줄 앞뒤 공백은 지운다, 같은 질문 두 번·200자 초과는 거부", () => {
    expect(parseQuestionLines(`\n${lines(50).replace(/\n/g, "\n\n  ")}\n\n`)).toMatchObject({ ok: true });
    expect(parseQuestionLines(`${lines(49)}\n시험용 질문 1`).ok).toBe(false);
    const long = `${lines(49)}\n${"가".repeat(201)}`;
    expect(parseQuestionLines(long).ok).toBe(false);
    expect(parseQuestionLines(`${lines(49)}\n${"가".repeat(200)}`).ok).toBe(true);
    expect(parseQuestionLines(42).ok).toBe(false);
  });
});

describe("엔진 목록", () => {
  test("쉼표·줄바꿈·배열 모두 받고 중복·빈 이름·긴 이름·11개 초과는 거부", () => {
    expect(parseEngines("엔진A, 엔진B\n엔진C")).toEqual({ ok: true, value: ["엔진A", "엔진B", "엔진C"] });
    expect(parseEngines(["엔진A"])).toEqual({ ok: true, value: ["엔진A"] });
    expect(parseEngines("").ok).toBe(false);
    expect(parseEngines("Eng, eng").ok).toBe(false);
    expect(parseEngines("가".repeat(41)).ok).toBe(false);
    expect(parseEngines(Array.from({ length: 11 }, (_, i) => `e${i}`)).ok).toBe(false);
    expect(parseEngines(7).ok).toBe(false);
  });
});

describe("인용률 — 분모는 확인한 칸 (OPT-09)", () => {
  test("미확인은 인용 0으로 세지 않는다 — yes 3, no 1, 미확인 6이면 분모 4, 인용률 75%", () => {
    const rows = [...Array(3).fill({ cited: "yes" }), { cited: "no" }, ...Array(6).fill({ cited: "unknown" })];
    expect(citationTally(rows)).toEqual({ yes: 3, no: 1, unknown: 6, checked: 4, total: 10, rate: 0.75 });
  });
  test("확인한 칸이 없으면 인용률은 null(0%가 아님)", () => {
    expect(citationTally([{ cited: "unknown" }]).rate).toBeNull();
    expect(citationTally([]).rate).toBeNull();
  });
  test("엔진별로 따로 센다", () => {
    const rows = [
      { engine: "B", cited: "yes" },
      { engine: "A", cited: "no" },
      { engine: "A", cited: "yes" },
    ];
    expect(tallyByEngine(rows).map((e) => [e.engine, e.tally.rate])).toEqual([["A", 0.5], ["B", 1]]);
  });
});

describe("표본 입력 검사", () => {
  test("yes는 인용 주소가 있어야 하고, 주소는 http(s)만", () => {
    expect(parseSampleInput({ id: 1, cited: "yes" }).ok).toBe(false);
    expect(parseSampleInput({ id: 1, cited: "yes", cited_url: "javascript:alert(1)" }).ok).toBe(false);
    expect(parseSampleInput({ id: 1, cited: "yes", cited_url: "https://sample.example.test/a" })).toMatchObject({ ok: true, value: { cited: "yes", cited_url: "https://sample.example.test/a" } });
    expect(parseSampleInput({ id: 1, cited: "no" })).toMatchObject({ ok: true, value: { cited_url: null } });
  });
  test("값 목록 밖·번호 없음·긴 메모는 거부", () => {
    expect(parseSampleInput({ id: 1, cited: "maybe" }).ok).toBe(false);
    expect(parseSampleInput({ cited: "no" }).ok).toBe(false);
    expect(parseSampleInput({ id: 1, cited: "no", note: "가".repeat(501) }).ok).toBe(false);
  });
});
