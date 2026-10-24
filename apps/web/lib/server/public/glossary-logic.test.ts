// 용어사전 화면 값 시험 (GLO-01 — 가나다 색인·분야 거르개·관련 용어 링크, docs/dev/W2-d_설계.md 2.5 glossary.initials · 8.2)
// 용어는 시험용 가짜 낱말이다(풀이·뜻도 가짜 글).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { FEATURE_KEYS, type Features } from "./constants";
import { GLOSSARY_INITIALS, glossaryIndexView, glossaryTermView, initialOf, parseGlossaryId, parseGlossarySection, termChip, tipTerms, type GlossaryRow } from "./glossary-logic";

const features = (on: boolean): Features => Object.fromEntries(FEATURE_KEYS.map((k) => [k, k === "glossary" ? on : false])) as Features;

const DESIGN = fs.readFileSync(path.resolve(__dirname, "../../../../../docs/dev/W2-d_설계.md"), "utf8");

let nextId = 1;
const row = (term: string, over: Partial<Omit<GlossaryRow, "id">> = {}): GlossaryRow & { id: number } => ({
  term,
  reading: null,
  definition: `가짜 뜻 ${term}`,
  plain: `가짜 풀이 ${term}`,
  related: [],
  section: ["tax"],
  source: null,
  ...over,
  id: nextId++,
});

describe("가나다 색인 묶음 (설계 2.5 glossary.initials)", () => {
  test("묶음 차례가 설계 표와 같다", () => {
    const line = DESIGN.split("\n").find((l) => l.startsWith("| glossary.initials "));
    expect(line).toBeDefined();
    expect([...GLOSSARY_INITIALS]).toEqual([...line!.split("|")[2]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]));
  });
  test.each([
    ["가짜", "ㄱ"],
    ["까치세", "ㄱ"],
    ["나무", "ㄴ"],
    ["따로", "ㄷ"],
    ["뜻", "ㄷ"],
    ["라면", "ㄹ"],
    ["빠름", "ㅂ"],
    ["싸움", "ㅅ"],
    ["쌍", "ㅅ"],
    ["어음", "ㅇ"],
    ["짜임", "ㅈ"],
    ["힣", "ㅎ"],
    ["하자", "ㅎ"],
    ["ㅋ자", "ㅋ"],
    ["ㄲ자", "ㄱ"],
    ["「취득」", "ㅊ"],
    ["(가짜)", "ㄱ"],
    ["PF", "A–Z·0–9"],
    ["reits", "A–Z·0–9"],
    ["1세대", "A–Z·0–9"],
    ["Ｐ가짜", "A–Z·0–9"],
    ["稅", "기타"],
    ["…", "기타"],
    ["", "기타"],
  ])("%s → %s (된소리는 예사소리 묶음 · 앞의 문장부호는 건너뛴다)", (term, initial) => {
    expect(initialOf(term)).toBe(initial);
  });
});

describe("색인 화면 값 — 묶음·차례·분야 거르개", () => {
  const rows = [row("하자"), row("까치세"), row("가짜", { section: ["realestate"] }), row("나무", { section: ["finance", "tax"] }), row("PF"), row("1세대"), row("稅")];
  const all = glossaryIndexView(rows, null);

  test("공개 용어는 모두 어느 묶음엔가 한 번 들어 있다 (GLO-01 '가나다 색인에서 모두 찾을 수 있다')", () => {
    const ids = all.groups.flatMap((g) => g.entries.map((e) => e.id)).sort((a, b) => a - b);
    expect(ids).toEqual(rows.map((r) => r.id).sort((a, b) => a - b));
    expect(all.total).toBe(rows.length);
  });
  test("묶음은 색인 차례(ㄱ…ㅎ → 영문·숫자 → 기타), 묶음 안은 가나다 차례, 빈 묶음은 없다", () => {
    expect(all.groups.map((g) => [g.initial, g.entries.map((e) => e.term)])).toEqual([
      ["ㄱ", ["가짜", "까치세"]],
      ["ㄴ", ["나무"]],
      ["ㅎ", ["하자"]],
      ["A–Z·0–9", ["1세대", "PF"]],
      ["기타", ["稅"]],
    ]);
  });
  test("색인 줄 — 한글 14자는 늘 보이고(용어 없는 자음은 링크 0), 영문·숫자·기타는 용어가 있을 때만", () => {
    expect(all.nav.map((n) => [n.label, n.anchor])).toEqual([
      ["ㄱ", "glossary-group-1"],
      ["ㄴ", "glossary-group-2"],
      ...["ㄷ", "ㄹ", "ㅁ", "ㅂ", "ㅅ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ"].map((l) => [l, null]),
      ["ㅎ", "glossary-group-14"],
      ["A–Z·0–9", "glossary-group-15"],
      ["기타", "glossary-group-16"],
    ]);
    expect(glossaryIndexView([row("가짜")], null).nav.map((n) => n.label)).toEqual(GLOSSARY_INITIALS.slice(0, 14));
    expect(all.groups.map((g) => g.anchor)).toEqual(["glossary-group-1", "glossary-group-2", "glossary-group-14", "glossary-group-15", "glossary-group-16"]);
  });
  test("용어마다 자리 표시(#term-번호)와 용어 쪽 주소(/glossary/번호)", () => {
    const e = all.groups[0]!.entries[0]!;
    expect(e).toMatchObject({ term: "가짜", anchor: `term-${rows[2]!.id}`, href: `/glossary/${rows[2]!.id}`, sections: ["realestate"] });
  });
  test("분야 탭 — 전체 + 용어가 있는 분야(4대 분야 차례), 분야를 고르면 그 분야 용어만", () => {
    expect(all.tabs.map((t) => [t.id, t.label, t.href, t.count])).toEqual([
      ["all", "전체", "/glossary", 7],
      ["tax", "지방세·부동산세금", "/glossary?section=tax", 6],
      ["realestate", "부동산재테크", "/glossary?section=realestate", 1],
      ["finance", "부동산금융", "/glossary?section=finance", 1],
    ]);
    const fin = glossaryIndexView(rows, "finance");
    expect(fin.section).toBe("finance");
    expect(fin.groups.flatMap((g) => g.entries.map((e) => e.term))).toEqual(["나무"]);
    expect(fin.total).toBe(1);
    expect(fin.tabs.map((t) => t.count)).toEqual([7, 6, 1, 1]);
  });
  test("용어가 없는 분야를 골라도 그 탭은 보이고(지금 탭) 묶음은 0", () => {
    const local = glossaryIndexView(rows, "local");
    expect(local.tabs.map((t) => t.id)).toEqual(["all", "tax", "realestate", "finance", "local"]);
    expect(local.groups).toEqual([]);
    expect(local.total).toBe(0);
  });
  test("용어가 하나도 없으면 묶음·탭 0, 색인 줄은 한글 14자(링크 0)", () => {
    const empty = glossaryIndexView([], null);
    expect(empty.groups).toEqual([]);
    expect(empty.tabs.map((t) => t.id)).toEqual(["all"]);
    expect(empty.nav.every((n) => n.anchor === null)).toBe(true);
  });
  test("분야 값이 틀린 행은 그 분야를 빼고, 분야가 없어도 전체에는 있다", () => {
    const v = glossaryIndexView([row("가짜", { section: ["tour", "local"] }), row("나무", { section: [] })], null);
    expect(v.groups.flatMap((g) => g.entries.map((e) => [e.term, e.sections]))).toEqual([
      ["가짜", ["local"]],
      ["나무", []],
    ]);
  });
});

describe("관련 용어 — 공개 용어면 링크, 아니면 글자", () => {
  const a = row("가짜용어갑", { related: ["가짜용어을", "가짜 용어 병", "없는 용어", "가짜용어갑"], section: ["tax"] });
  const b = row("가짜용어을", { section: ["tax"] });
  const c = row("가짜용어병", { section: ["finance"] });
  test("색인 화면 — 같은 쪽에 있으면 쪽 안 자리(#term-번호), 다른 분야 쪽이면 용어 쪽, 사전에 없으면 글자, 자기 자신은 뺀다 (띄어쓰기 달라도 같은 용어)", () => {
    const v = glossaryIndexView([a, b, c], "tax");
    const entry = v.groups.flatMap((g) => g.entries).find((e) => e.id === a.id)!;
    expect(entry.related).toEqual([
      { label: "가짜용어을", href: `#term-${b.id}` },
      { label: "가짜 용어 병", href: `/glossary/${c.id}` },
      { label: "없는 용어", href: null },
    ]);
  });
  test("용어 쪽 — 공개 용어는 그 용어 쪽 주소", () => {
    const t = glossaryTermView([a, b, c], a.id)!;
    expect(t.related).toEqual([
      { label: "가짜용어을", href: `/glossary/${b.id}` },
      { label: "가짜 용어 병", href: `/glossary/${c.id}` },
      { label: "없는 용어", href: null },
    ]);
    expect(t).toMatchObject({ id: a.id, term: "가짜용어갑", plain: "가짜 풀이 가짜용어갑", definition: "가짜 뜻 가짜용어갑", initial: "ㄱ", indexHref: `/glossary#term-${a.id}` });
  });
  test("없는 번호(숨긴 용어는 공개 읽기에 없다)는 null", () => {
    expect(glossaryTermView([a], 99999)).toBeNull();
  });
});

describe("주소 값 읽기", () => {
  test.each([
    ["12", 12],
    ["1", 1],
    ["0", null],
    ["012", null],
    ["-3", null],
    ["1.5", null],
    ["가짜", null],
    ["99999999999999999", null],
  ])("용어 번호 %s → %s", (raw, id) => expect(parseGlossaryId(raw)).toBe(id));
  test.each([
    [undefined, null],
    ["tax", "tax"],
    [["local", "tax"], "local"],
    ["tour", null],
    ["", null],
  ])("분야 %s → %s (모르는 값은 전체)", (raw, s) => expect(parseGlossarySection(raw)).toBe(s));
});

describe("용어 칩·툴팁 용어 — 용어사전이 열렸을 때만 링크 (기능 키 glossary)", () => {
  test("칩 — 꺼지면 링크 0(글자와 풀이), 켜지면 용어 쪽", () => {
    const r = row("가짜용어갑");
    expect(termChip(r, features(false))).toEqual({ id: r.id, term: "가짜용어갑", plain: "가짜 풀이 가짜용어갑", href: null });
    expect(termChip(r, features(true)).href).toBe(`/glossary/${r.id}`);
    expect(termChip({ ...r, plain: "  " }, features(true)).plain).toBeNull();
  });
  test("툴팁 용어 — 쉬운 풀이가 없는 용어는 뺀다, '용어사전에서 보기' 주소는 켜졌을 때만", () => {
    const withPlain = row("가짜용어갑");
    const noPlain = row("가짜용어을", { plain: null });
    const blank = row("가짜용어병", { plain: " " });
    expect(tipTerms([withPlain, noPlain, blank], features(false))).toEqual([{ id: withPlain.id, term: "가짜용어갑", plain: "가짜 풀이 가짜용어갑", href: null }]);
    expect(tipTerms([withPlain], features(true))[0]!.href).toBe(`/glossary/${withPlain.id}`);
  });
});
