import { describe, expect, test } from "vitest";
import { datesToCollect, indexnowDecision, readServiceAccount, toTermRows } from "./search-console";

describe("서치 콘솔 응답 → 저장 행 (OPT-01)", () => {
  test("같은 정규형 질의는 노출을 합산하고 많은 순서로 정렬한다", () => {
    const rows = toTermRows([
      { keys: ["취득세 감면"], clicks: 1, impressions: 10 },
      { keys: ["취득세  감면"], clicks: 0, impressions: 5 },
      { keys: ["재산세"], clicks: 0, impressions: 30 },
    ]);
    expect(rows.map((r) => [r.normalized, r.count])).toEqual([["재산세", 30], ["취득세 감면", 15]]);
  });
  test("노출 0·키가 없는 줄·모양이 틀린 줄은 건너뛴다", () => {
    expect(toTermRows([{ keys: ["a"], impressions: 0 }, { keys: [], impressions: 3 }, { impressions: 3 }, null, { keys: [5], impressions: 4 }])).toEqual([]);
    expect(toTermRows(undefined)).toEqual([]);
    expect(toTermRows("x")).toEqual([]);
  });
  test("개인정보 0 — 전화번호·이메일·주민등록번호·긴 숫자는 가려서 저장하고 원문은 남지 않는다", () => {
    const rows = toTermRows([
      { keys: ["상담 010-1234-5678 취득세"], impressions: 2 },
      { keys: ["문의 someone@example.test 재산세"], impressions: 2 },
      { keys: ["900101-1234567 양도세"], impressions: 2 },
    ]);
    const text = JSON.stringify(rows);
    expect(text).not.toContain("1234");
    expect(text).not.toContain("example.test");
    expect(text).not.toContain("900101");
    expect(rows.length).toBeGreaterThan(0);
  });
  test("가림 뒤 남는 글자가 없는 질의는 저장하지 않는다", () => {
    expect(toTermRows([{ keys: ["010-1234-5678"], impressions: 9 }])).toEqual([]);
  });
});

describe("수집 날짜", () => {
  test("오늘 −3일부터 거꾸로 3일 (데이터 완성 지연 반영) — 달을 넘어가도 한국 날짜 그대로", () => {
    expect(datesToCollect("2026-10-25")).toEqual(["2026-10-22", "2026-10-21", "2026-10-20"]);
    expect(datesToCollect("2026-03-02")).toEqual(["2026-02-27", "2026-02-26", "2026-02-25"]);
    expect(datesToCollect("2026-10-25", 1, 0)).toEqual(["2026-10-25"]);
  });
});

describe("서비스 계정·IndexNow 판정", () => {
  test("자격 증명 글은 모양이 맞을 때만 읽고, 없거나 틀리면 null(수집 건너뜀)", () => {
    expect(readServiceAccount(JSON.stringify({ client_email: "a@b.example.test", private_key: "k" }))).toEqual({ client_email: "a@b.example.test", private_key: "k" });
    for (const bad of [undefined, "", "  ", "{", JSON.stringify({ client_email: "a" }), JSON.stringify([])]) expect(readServiceAccount(bad)).toBeNull();
  });
  test("IndexNow — 색인 관문이 닫혀 있거나 꺼져 있거나 열쇠가 없으면 전송 0, 셋 다 갖추면 전송", () => {
    expect(indexnowDecision({ indexingOpen: false, enabled: true, keyPresent: true }).send).toBe(false);
    expect(indexnowDecision({ indexingOpen: true, enabled: false, keyPresent: true })).toEqual({ send: false, reason: "IndexNow 설정이 꺼져 있습니다" });
    expect(indexnowDecision({ indexingOpen: true, enabled: true, keyPresent: false }).send).toBe(false);
    expect(indexnowDecision({ indexingOpen: true, enabled: true, keyPresent: true })).toEqual({ send: true, reason: null });
  });
});
