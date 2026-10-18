// 본문 첫 등장 용어 풀이(툴팁) 계획 시험 (GLO-02 — docs/dev/W2-d_설계.md 2.5 glossary.tip_blocks · 8.2)
//  · 한 기사에서 같은 용어는 한 번만(첫 등장) · 긴 용어가 먼저("지방교육세"가 "교육세"보다 먼저) · 제목·링크 안 용어 0
//  · 조사가 붙어도("취득세를") 맞는다 · 낱말 가운데("지방교육세" 안의 "교육세")는 맞추지 않는다 · 겹치는 용어
//  · 그 블록에 이미 쉬운 풀이가 적혀 있으면(편집 점검 UX-01이 '풀었다'고 보는 경우) 툴팁 0 — 그 뒤에도 0
// 용어는 시험용 가짜 낱말과 흔한 세목 이름이다(풀이는 가짜 글).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { StoredBlock } from "@/lib/server/articles/content";
import { TIP_BLOCK_TYPES, articleTipPlan, markUnits, type PlannedRun, type TipPiece, type TipTerm } from "./glossary-tips";

const DESIGN = fs.readFileSync(path.resolve(__dirname, "../../../../docs/dev/W2-d_설계.md"), "utf8");

let nextId = 1;
const term = (t: string, plain = `가짜 풀이 ${t}`, href: string | null = null): TipTerm => ({ id: nextId++, term: t, plain, href });

/** 한 덩어리의 조각 → 읽기 쉬운 글 — 툴팁은 [용어] */
const show = (pieces: readonly TipPiece[]) => pieces.map((p) => (p.kind === "term" ? `[${p.text}]` : p.text)).join("");
/** 글 조각(PlannedRun)의 조각들 — 링크 조각이면 빈 목록 */
const piecesOf = (r: PlannedRun | undefined): TipPiece[] => (r && r.kind === "text" ? r.pieces : []);
const units = (texts: readonly string[]) => texts.map((text) => ({ runs: [{ kind: "text" as const, text, eligible: true }] }));
const marked = (texts: readonly string[], terms: readonly TipTerm[]) => markUnits(units(texts), terms).map((u) => show(piecesOf(u[0])));
const tipsOf = (texts: readonly string[], terms: readonly TipTerm[]) =>
  markUnits(units(texts), terms)
    .flatMap((u) => u.flatMap(piecesOf))
    .filter((p): p is Extract<TipPiece, { kind: "term" }> => p.kind === "term")
    .map((p) => `${p.text}→${p.term.term}`);

describe("설계 2.5와 같은 블록 종류", () => {
  test("툴팁을 붙이는 블록 = glossary.tip_blocks", () => {
    const line = DESIGN.split("\n").find((l) => l.startsWith("| glossary.tip_blocks "));
    expect(line, "설계 2.5에 glossary.tip_blocks").toBeDefined();
    expect([...TIP_BLOCK_TYPES]).toEqual([...line!.split("|")[2]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]));
  });
});

describe("첫 등장만 — 한 기사에서 같은 용어는 한 번", () => {
  test("같은 문단의 두 번째·다른 문단의 같은 용어는 그냥 글", () => {
    const acq = term("취득세");
    expect(marked(["취득세는 집을 살 때 낸다. 취득세 신고는 따로다.", "다음 문단의 취득세"], [acq])).toEqual(["[취득세]는 집을 살 때 낸다. 취득세 신고는 따로다.", "다음 문단의 취득세"]);
  });
  test("용어가 여럿이면 용어마다 첫 등장 하나씩", () => {
    const terms = [term("취득세"), term("재산세")];
    expect(tipsOf(["재산세와 취득세", "취득세와 재산세"], terms)).toEqual(["재산세→재산세", "취득세→취득세"]);
  });
  test("용어가 없거나 사전이 비면 글 그대로 (조각 하나)", () => {
    expect(marked(["아무 용어도 없는 문단"], [term("취득세")])).toEqual(["아무 용어도 없는 문단"]);
    expect(markUnits(units(["글"]), [])).toEqual([[{ kind: "text", pieces: [{ kind: "text", text: "글" }] }]]);
  });
});

describe("긴 용어 먼저 · 겹치는 용어 · 낱말 가운데는 맞추지 않는다", () => {
  test("'지방교육세'가 '교육세'보다 먼저 — 사전 차례와 상관없이", () => {
    for (const order of [
      [term("교육세"), term("지방교육세")],
      [term("지방교육세"), term("교육세")],
    ]) {
      expect(tipsOf(["지방교육세는 취득세에 붙는다"], order)).toEqual(["지방교육세→지방교육세"]);
    }
  });
  test("'지방교육세'가 사전에 없어도 그 안의 '교육세'에는 붙이지 않는다 — 띄어 쓴 '교육세'에만", () => {
    expect(marked(["지방교육세와 교육세"], [term("교육세")])).toEqual(["지방교육세와 [교육세]"]);
  });
  test("세 용어가 겹칠 때 — 긴 것이 먼저 맞고, 맞은 자리 안의 짧은 용어는 그 자리에서 0", () => {
    const terms = [term("지방"), term("교육세"), term("지방교육세")];
    expect(marked(["지방교육세와 교육세, 지방 재정"], terms)).toEqual(["[지방교육세]와 [교육세], [지방] 재정"]);
  });
  test("이미 쓴 긴 용어 자리 안의 짧은 용어도 0 — 두 번째 '지방교육세' 안의 '지방'은 붙지 않는다", () => {
    const terms = [term("지방교육세"), term("지방")];
    expect(marked(["지방교육세를 낸다", "지방교육세 안내와 지방 소식"], terms)).toEqual(["[지방교육세]를 낸다", "지방교육세 안내와 [지방] 소식"]);
  });
  test("띄어 쓴 용어 — 본문의 띄어쓰기가 여러 칸·줄바꿈이어도 맞는다", () => {
    expect(marked(["1세대  1주택 특례"], [term("1세대 1주택")])).toEqual(["[1세대  1주택] 특례"]);
  });
});

describe("조사가 붙어도 맞는다 (한국어 붙여 쓰기)", () => {
  test.each([
    ["취득세를 낸다", "[취득세]를 낸다"],
    ["취득세는", "[취득세]는"],
    ["취득세의 과세표준", "[취득세]의 과세표준"],
    ["(취득세)", "([취득세])"],
    ["「취득세」 안내", "「[취득세]」 안내"],
    ["주택취득세", "주택취득세"],
  ])("%s → %s", (text, expected) => {
    expect(marked([text], [term("취득세")])).toEqual([expected]);
  });
  test("영문 용어 — 대소문자는 가리지 않고, 더 긴 영문 낱말(PFV) 안에는 붙지 않는다", () => {
    expect(marked(["pf 대출과 PFV 설립, PF사업"], [term("PF")])).toEqual(["[pf] 대출과 PFV 설립, PF사업"]);
    expect(marked(["PFV 설립 뒤 PF 대출"], [term("PF")])).toEqual(["PFV 설립 뒤 [PF] 대출"]);
  });
});

describe("링크 안·제목 칸에는 붙지 않는다", () => {
  test("링크 조각 안의 용어는 0 — 다음 글 조각의 첫 등장에 붙는다", () => {
    const plan = markUnits(
      [{ runs: [{ kind: "link", text: "취득세 안내", href: "/news/a", external: false }, { kind: "text", text: " 기사를 보면 취득세를 안다", eligible: true }] }],
      [term("취득세")],
    );
    expect(plan[0]![0]).toEqual({ kind: "link", text: "취득세 안내", href: "/news/a", external: false });
    expect(show(piecesOf(plan[0]![1]))).toBe(" 기사를 보면 [취득세]를 안다");
  });
  test("붙이지 않는 글 조각(eligible false)은 그대로", () => {
    const plan = markUnits([{ runs: [{ kind: "text", text: "취득세", eligible: false }] }, { runs: [{ kind: "text", text: "취득세", eligible: true }] }], [term("취득세")]);
    expect(show(piecesOf(plan[0]![0]))).toBe("취득세");
    expect(show(piecesOf(plan[1]![0]))).toBe("[취득세]");
  });
});

describe("이미 풀어 쓴 블록 (UX-01 점검과 같은 판단)", () => {
  test("첫 등장 블록에 쉬운 풀이가 적혀 있으면 툴팁 0이고, 그 뒤 블록에도 0", () => {
    const t = term("가짜용어갑", "시험용 쉬운 풀이");
    expect(marked(["가짜용어갑(시험용  쉬운 풀이)은 이렇다", "다음 가짜용어갑"], [t])).toEqual(["가짜용어갑(시험용  쉬운 풀이)은 이렇다", "다음 가짜용어갑"]);
  });
  test("풀이가 다른 블록에 있으면 첫 등장 블록에 툴팁", () => {
    const t = term("가짜용어갑", "시험용 쉬운 풀이");
    expect(marked(["가짜용어갑은 이렇다", "시험용 쉬운 풀이"], [t])).toEqual(["[가짜용어갑]은 이렇다", "시험용 쉬운 풀이"]);
  });
});

describe("기사 블록 → 툴팁 계획 (articleTipPlan)", () => {
  const acq = term("취득세", "가짜 풀이 취득", "/glossary/1");
  const edu = term("지방교육세", "가짜 풀이 교육");
  const blocks: StoredBlock[] = [
    { type: "key_summary", lines: ["취득세 요약"] },
    { type: "paragraph", text: "[취득세 기사](/news/abc)를 보고 취득세를 낸다." },
    { type: "callout", kind: "note", title: "지방교육세 상자 제목", text: "지방교육세도 함께 낸다." },
    { type: "quote", text: "취득세는 어렵다", speaker: "지방교육세 담당자" },
    { type: "table", caption: "지방교육세 표", rows: [["지방교육세", "1"]], chart: null },
    { type: "faq", items: [{ question: "취득세?", answer: "취득세다" }] },
  ] as unknown as StoredBlock[];
  const plan = articleTipPlan(blocks, [acq, edu]);
  const tipBlocks = (p: Map<number, PlannedRun[]>) =>
    [...p.entries()].flatMap(([i, runs]) => runs.flatMap((r) => (r.kind === "text" ? r.pieces.filter((x) => x.kind === "term").map((x) => `${i}:${x.text}`) : [])));

  test("문단·상자 글·인용 글에만 — 핵심 요약·상자 제목·발언자·표·FAQ는 0, 문단 링크 안도 0", () => {
    expect(tipBlocks(plan)).toEqual(["1:취득세", "2:지방교육세"]);
  });
  test("계획에 든 블록은 툴팁을 붙일 수 있는 블록뿐이고, 문단의 링크 조각은 그대로", () => {
    expect([...plan.keys()]).toEqual([1, 2, 3]);
    expect(plan.get(1)![0]).toEqual({ kind: "link", text: "취득세 기사", href: "/news/abc", external: false });
  });
  test("열리지 않은 링크 표기(글자로 남은 [글](주소))의 용어도 0", () => {
    const p = articleTipPlan([{ type: "paragraph", text: "[취득세](/region/seoul) 다음 취득세" } as StoredBlock], [term("취득세")]);
    expect(tipBlocks(p)).toEqual(["0:취득세"]);
    const runs = p.get(0)!;
    expect(runs.map((r) => (r.kind === "text" ? show(r.pieces) : `<${r.text}>`)).join("")).toBe("[취득세](/region/seoul) 다음 [취득세]");
  });
  test("저장된 본문 글자는 바뀌지 않는다 — 계획의 글을 이으면 원래 글", () => {
    const text = (blocks[1] as Extract<StoredBlock, { type: "paragraph" }>).text;
    const joined = plan.get(1)!.map((r) => (r.kind === "text" ? r.pieces.map((x) => x.text).join("") : `[${r.text}](${r.href})`)).join("");
    expect(joined).toBe(text);
  });
});
