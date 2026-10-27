import { describe, expect, test } from "vitest";
import { paragraphSegments } from "@/lib/site/article-view";
import { articleTipPlan } from "@/lib/site/glossary-tips";
import { openBlockLinks } from "@/lib/server/public/article-logic";
import { CLOSED_FEATURES } from "@/lib/server/public/settings";
import { MARKDOWN_LINK } from "@/lib/server/public/constants";
import { stripInlineMarkup } from "./inline-markup";

const WIKI = "https://commons.wikimedia.org/wiki/File:Government_Complex_Sejong_(N).jpg";

describe("굵게 **글**", () => {
  test("굵은 조각만 bold, 앞뒤 글은 그대로", () => {
    expect(paragraphSegments("세율은 **4%**입니다")).toEqual([
      { kind: "text", text: "세율은 " },
      { kind: "text", text: "4%", bold: true },
      { kind: "text", text: "입니다" },
    ]);
  });
  test("짝이 없거나 안이 비거나 공백으로 시작하면 글 그대로", () => {
    for (const t of ["**닫히지 않음", "****", "** 공백 시작**", "별 두 개 ** 만"]) expect(paragraphSegments(t)).toEqual([{ kind: "text", text: t }]);
  });
  test("링크 글 전체가 굵으면 굵은 링크", () => {
    expect(paragraphSegments("[**법령**](https://www.law.go.kr/a)")).toEqual([{ kind: "link", text: "법령", href: "https://www.law.go.kr/a", external: true, bold: true }]);
  });
  test("HTML은 해석하지 않는 글 — 굵게 안에서도 같다", () => {
    expect(paragraphSegments("**<script>alert(1)</script>**")).toEqual([{ kind: "text", text: "<script>alert(1)</script>", bold: true }]);
  });
});

describe("링크 주소 안 괄호 (균형 잡힌 쌍만)", () => {
  test("위키미디어 주소의 괄호 쌍을 허용한다", () => {
    expect(paragraphSegments(`사진 [세종청사](${WIKI}) 참고`)).toEqual([
      { kind: "text", text: "사진 " },
      { kind: "link", text: "세종청사", href: WIKI, external: true },
      { kind: "text", text: " 참고" },
    ]);
  });
  test("닫는 괄호가 모자라거나 남으면 링크가 되지 않고 글 그대로", () => {
    const open = "[글](https://example.test/a_(N.jpg)";
    expect(paragraphSegments(open).every((s) => s.kind === "text")).toBe(true);
    expect(paragraphSegments(open).map((s) => s.text).join("")).toBe(open);
  });
  test("주소 뒤에 오는 괄호 문장은 주소에 먹히지 않는다", () => {
    const segs = paragraphSegments("([법령](https://www.law.go.kr/a))");
    expect(segs).toEqual([
      { kind: "text", text: "(" },
      { kind: "link", text: "법령", href: "https://www.law.go.kr/a", external: true },
      { kind: "text", text: ")" },
    ]);
  });
  test("MARKDOWN_LINK도 같은 주소 규칙", () => {
    const m = [...`[a](${WIKI})`.matchAll(new RegExp(MARKDOWN_LINK.source, "g"))];
    expect(m[0]![2]).toBe(WIKI);
  });
});

describe("XSS — 허용 밖은 링크가 되지 않는다", () => {
  test.each(["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", "vbscript:x", "//evil.example.com", "ftp://x.test/a"])("%s", (href) => {
    expect(paragraphSegments(`[누르기](${href})`).some((s) => s.kind === "link")).toBe(false);
  });
  test("따옴표·꺾쇠가 든 주소도 속성으로 새지 않는다 — 링크 조각의 href는 글자 그대로이고 컴포넌트가 속성 값으로만 쓴다", () => {
    const segs = paragraphSegments(`[x](https://a.test/"onmouseover="alert(1))`);
    const link = segs.find((s) => s.kind === "link");
    expect(link && link.kind === "link" ? link.href : null).toBe(`https://a.test/"onmouseover="alert(1)`);
  });
});

describe("글자 수·검색 본문", () => {
  test("**와 링크 표기를 걷어 낸 글자", () => {
    expect(stripInlineMarkup(`**굵게** 그리고 [세종청사](${WIKI}) 끝`)).toBe("굵게 그리고 세종청사 끝");
    expect(stripInlineMarkup("[**법**](/news/a)")).toBe("법");
    expect(stripInlineMarkup("별 ** 하나")).toBe("별 ** 하나");
  });
});

describe("표 칸·안내 상자 — 닫힌 기능 링크는 글자만", () => {
  test("안내 상자 본문과 표 칸의 닫힌 사이트 안 링크가 글자로 바뀌고, 바깥 링크·바뀔 것 없는 블록은 그대로", () => {
    const callout = { type: "callout", kind: "info", title: "", text: "[계산기](/calc) **중요**" } as const;
    const table = { type: "table", caption: "c", rows: [["a", "[계산기](/calc)"], ["b", "[법령](https://www.law.go.kr/a)"]], chart: null } as const;
    const same = { type: "callout", kind: "info", title: "", text: "그대로" } as const;
    const r = openBlockLinks([callout, table, same] as never, CLOSED_FEATURES);
    expect((r[0] as { text: string }).text).toBe("계산기 **중요**");
    expect((r[1] as unknown as { rows: string[][] }).rows).toEqual([["a", "계산기"], ["b", "[법령](https://www.law.go.kr/a)"]]);
    expect(r[2]).toBe(same);
  });
});

describe("용어 풀이 계획 — 상자의 굵게·링크가 유지된다", () => {
  test("callout 글의 굵은 조각은 bold 조각으로, 링크는 링크 조각으로", () => {
    const plan = articleTipPlan([{ type: "callout", kind: "info", title: "", text: "앞 **굵게** [법령](https://www.law.go.kr/a)" }] as never, []);
    const runs = plan.get(0)!;
    expect(runs.map((r) => (r.kind === "link" ? `link:${r.text}` : `${r.bold ? "b" : "t"}:${r.pieces.map((p) => p.text).join("")}`))).toEqual(["t:앞 ", "b:굵게", "t: ", "link:법령"]);
  });
});
