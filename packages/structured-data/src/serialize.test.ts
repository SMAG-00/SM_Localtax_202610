// <script type="application/ld+json"> 안에 넣을 안전한 직렬화 — 태그 탈출 차단 · 키 순서 고정.
import { describe, expect, it } from "vitest";
import { toJsonLdScriptContent } from "./serialize";
import { pageJsonLd } from "./page";
import { passSamples, sampleArticle } from "../fixtures/samples";

describe("태그 탈출 차단", () => {
  it("제목에 '</script>'가 있어도 결과에 '<'가 없고, 되읽으면 원래 제목이다", () => {
    const title = '세율 표 </script><script>alert("x")</script> 정리';
    const nodes = pageJsonLd({ kind: "article", article: { ...sampleArticle, title } });
    const out = toJsonLdScriptContent(nodes);
    expect(out).not.toContain("<");
    expect(out.toLowerCase()).not.toContain("</script");
    expect(out).toContain("\\u003c/script\\u003e");
    expect(JSON.parse(out)[0].headline).toBe(title);
  });

  it("'<!--'·'>'·'&'도 \\u 형태로 바꾼다", () => {
    const out = toJsonLdScriptContent({ "@type": "Thing", name: "<!-- a & b -->" });
    expect(out).toBe('{"@type":"Thing","name":"\\u003c!-- a \\u0026 b --\\u003e"}');
    expect(JSON.parse(out).name).toBe("<!-- a & b -->");
  });

  it("줄 구분자 U+2028·U+2029를 \\u2028·\\u2029로 바꾼다", () => {
    const out = toJsonLdScriptContent({ name: "가\u2028나\u2029다" });
    expect(out).toBe('{"name":"가\\u2028나\\u2029다"}');
    expect(JSON.parse(out).name).toBe("가\u2028나\u2029다");
  });

  it("따옴표·역슬래시·줄바꿈은 JSON 규칙대로 이스케이프된다", () => {
    const out = toJsonLdScriptContent({ name: 'a"b\\c\nd' });
    expect(out).toBe('{"name":"a\\"b\\\\c\\nd"}');
  });
});

describe("키 순서 고정 · 결정론", () => {
  it("@context, @type, @id가 먼저 오고 나머지는 키 이름 순서다", () => {
    const out = toJsonLdScriptContent({ name: "n", "@id": "https://x.example/#a", url: "u", "@type": "T", "@context": "c", author: "a" });
    expect(out).toBe('{"@context":"c","@type":"T","@id":"https://x.example/#a","author":"a","name":"n","url":"u"}');
  });

  it("넣은 순서가 다른 같은 객체는 결과가 같다 (중첩 객체 포함)", () => {
    const a = { b: 1, a: { y: [1, { q: 2, p: 3 }], x: "s" } };
    const b = { a: { x: "s", y: [1, { p: 3, q: 2 }] }, b: 1 };
    expect(toJsonLdScriptContent(a)).toBe(toJsonLdScriptContent(b));
    expect(toJsonLdScriptContent(a)).toBe('{"a":{"x":"s","y":[1,{"p":3,"q":2}]},"b":1}');
  });

  it("배열 순서는 바꾸지 않는다", () => {
    expect(toJsonLdScriptContent(["b", "a"])).toBe('["b","a"]');
  });

  it("값이 undefined인 키는 빠진다", () => {
    expect(toJsonLdScriptContent({ a: undefined, b: null, c: 0, d: false })).toBe('{"b":null,"c":0,"d":false}');
  });

  it("7유형 견본 — 두 번 직렬화한 결과가 같다", () => {
    for (const input of Object.values(passSamples)) {
      expect(toJsonLdScriptContent(pageJsonLd(input))).toBe(toJsonLdScriptContent(pageJsonLd(input)));
    }
  });
});

describe("JSON으로 낼 수 없는 값은 거부", () => {
  it("NaN·Infinity는 오류 (조용히 null로 바꾸지 않는다)", () => {
    expect(() => toJsonLdScriptContent({ width: Number.NaN })).toThrow(TypeError);
    expect(() => toJsonLdScriptContent({ width: Number.POSITIVE_INFINITY })).toThrow(TypeError);
  });

  it("함수·bigint는 오류", () => {
    expect(() => toJsonLdScriptContent({ f: () => 1 })).toThrow(TypeError);
    expect(() => toJsonLdScriptContent({ n: 10n })).toThrow(TypeError);
  });

  it("Date·Map 같은 특수 객체는 오류 (빈 {}로 바꾸지 않는다 — 날짜는 ISO 문자열로 넘긴다)", () => {
    expect(() => toJsonLdScriptContent({ startDate: new Date("2026-11-03T05:00:00Z") })).toThrow(TypeError);
    expect(() => toJsonLdScriptContent({ m: new Map() })).toThrow(TypeError);
  });
});
