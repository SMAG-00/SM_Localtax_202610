import { describe, expect, it } from "vitest";
import { citationSegments, paragraphs, rateKeyOf, visibleText } from "./logic";

describe("조문 인용 자동 링크 (citationSegments)", () => {
  it("OO법 제N조(의M) 모양을 검색 링크로 바꾸고 앞뒤 글은 그대로 둔다", () => {
    const s = citationSegments("시험용 문장 시험법 제12조의3 을 본다");
    expect(s).toEqual([
      { kind: "text", text: "시험용 문장 " },
      { kind: "cite", text: "시험법 제12조의3", href: `/search?${new URLSearchParams({ q: "시험법 제12조의3" }).toString()}` },
      { kind: "text", text: " 을 본다" },
    ]);
  });
  it("기준일이 형식에 맞으면 asOf를 붙이고 틀리면 붙이지 않는다", () => {
    const ok = citationSegments("시험법 제1조", "2026-03-01")[0]!;
    const bad = citationSegments("시험법 제1조", "2026-3-1")[0]!;
    expect(ok.kind === "cite" && ok.href.includes("asOf=2026-03-01")).toBe(true);
    expect(bad.kind === "cite" && bad.href.includes("asOf")).toBe(false);
  });
  it("인용이 없으면 글 하나로 돌려주고 빈 글은 빈 목록", () => {
    expect(citationSegments("인용 없음")).toEqual([{ kind: "text", text: "인용 없음" }]);
    expect(citationSegments("")).toEqual([]);
  });
  it("한 문장에 인용 둘은 둘 다 링크가 된다", () => {
    const cites = citationSegments("시험법 제1조 그리고 연습법 제2조").filter((x) => x.kind === "cite");
    expect(cites).toHaveLength(2);
  });
});

describe("문단 나누기", () => {
  it("빈 줄 기준으로 나누고 앞뒤 공백·빈 문단을 버린다", () => {
    expect(paragraphs(" 가 \n\n\n 나 \n\n  \n\n다")).toEqual(["가", "나", "다"]);
  });
});

describe("속도 제한 키 (rateKeyOf)", () => {
  it("로그인이면 계정 키, 아니면 IP 해시이고 IP 원문은 들어 있지 않다", async () => {
    expect(await rateKeyOf("u-1", "1.2.3.4")).toBe("u:u-1");
    const k = await rateKeyOf(null, "203.0.113.9");
    expect(k).toMatch(/^ip:[0-9a-f]{24}$/);
    expect(k).not.toContain("203.0.113.9");
    expect(await rateKeyOf(null, "203.0.113.9")).toBe(k);
    expect(await rateKeyOf(null, "203.0.113.10")).not.toBe(k);
  });
});

describe("응답에 실을 본문 (visibleText)", () => {
  it("실패 응답은 null, 잠긴 미리보기와 전문은 글자를 돌려준다", () => {
    expect(visibleText({ ok: false, code: "not_found" })).toBeNull();
    expect(visibleText({ ok: true, code: "ok", tier: "premium", full: false, locked: true, text: "앞부분" })).toBe("앞부분");
    expect(visibleText({ ok: true, code: "ok", tier: "premium", full: true, text: "전문" })).toBe("전문");
  });
  it("프리미엄인데 전문도 잠금 표시도 아닌 응답은 글자를 내지 않는다", () => {
    expect(visibleText({ ok: true, code: "ok", tier: "premium", full: false, text: "새는 글" })).toBeNull();
  });
});
