import { describe, expect, it } from "vitest";
import { buildLifecycleView, INHERITANCE_GIFT_HREF, readSections, readTransferChecklist } from "./tax-lifecycle";

// 가이드 글은 모두 '시험용' 지어낸 문장이다 (실제 법·세무 문장 아님). 가이드 관리 화면 형식: sections = [{ heading, body }], 절 정보는 facts.section_map.
type Item = { heading?: string; body?: string; tab?: unknown; cause?: unknown; tax_kind?: unknown };
const guide = (items: Item[], extraFacts: Record<string, unknown> = {}) => ({
  sections: items.map((i) => ({ heading: i.heading ?? "시험용 제목", body: i.body ?? "시험용 본문" })),
  facts: {
    section_map: items.map((i, index) => ({ index, tab: i.tab ?? "acquire", ...(i.cause === undefined ? { cause: "PAID" } : { cause: i.cause }), tax_kind: i.tax_kind ?? "local" })),
    ...extraFacts,
  },
});
const read = (items: Item[]) => {
  const g = guide(items);
  return readSections(g.sections, g.facts);
};

describe("절 읽기", () => {
  it("탭·세목 배지·원인 값이 틀린 절, 빈 글자 절은 렌더하지 않는다", () => {
    const got = read([{}, { tab: "sell" }, { tax_kind: "both" }, { heading: " " }, { cause: "SALE" }]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ tab: "acquire", cause: "PAID", taxKind: "local" });
  });

  it("지도에 없는 절과 지도가 없는 가이드는 렌더하지 않는다", () => {
    const g = guide([{}, { heading: "시험용 숨은 절" }]);
    expect(readSections(g.sections, { section_map: [g.facts.section_map[0]] })).toHaveLength(1);
    expect(readSections(g.sections, {})).toEqual([]);
    expect(readSections("x", g.facts)).toEqual([]);
  });

  it("같은 절을 지도에 두 번 적어도 한 번만 그리고, 범위 밖 번호는 버린다", () => {
    const g = guide([{}]);
    const entry = g.facts.section_map[0];
    expect(readSections(g.sections, { section_map: [entry, entry, { ...entry, index: 5 }, { ...entry, index: -1 }] })).toHaveLength(1);
  });

  it("양도 탭 절에 원 단위 금액 표현이 있으면 버리고, 금액이 없는 해설은 남긴다", () => {
    const got = read([{ tab: "transfer", cause: null, body: "시험용 해설 - 1,000원 이라고 쓴 문장" }, { tab: "transfer", cause: null, heading: "시험용 양도 해설" }]);
    expect(got.map((s) => s.title)).toEqual(["시험용 양도 해설"]);
    // 같은 표현이 취득 탭에서는 막지 않는다 (금지는 양도 금액에만)
    expect(read([{ body: "시험용 1,000원" }])).toHaveLength(1);
  });
});

describe("확인 목록 (RE-02)", () => {
  it("facts에서만 읽고 단정 표현·중복 id·빈 항목은 뺀다", () => {
    const got = readTransferChecklist({
      transfer_checklist: [
        { id: "a", label: "시험용 보유 기간을 확인합니다" },
        { id: "b", label: "시험용 이면 비과세됩니다" },
        { id: "c", label: "시험용 이면 대상입니다" },
        { id: "a", label: "시험용 중복" },
        { id: "d", label: "  " },
        { label: "id 없음" },
      ],
    });
    expect(got).toEqual([{ id: "a", label: "시험용 보유 기간을 확인합니다" }]);
  });

  it("목록이 없거나 모양이 틀리면 빈 목록이다 (코드에 기본 항목 0)", () => {
    expect(readTransferChecklist({})).toEqual([]);
    expect(readTransferChecklist(null)).toEqual([]);
    expect(readTransferChecklist({ transfer_checklist: "x" })).toEqual([]);
  });
});

describe("탭 화면 (RE-01)", () => {
  const view = buildLifecycleView(
    guide(
      [{}, { cause: "INHERITANCE", tax_kind: "national", heading: "시험용 상속 칸" }, { tab: "hold", cause: null, heading: "시험용 보유" }, { tab: "transfer", cause: null, tax_kind: "national", heading: "시험용 양도 해설" }],
      { transfer_checklist: [{ id: "a", label: "시험용 확인 항목" }] },
    ),
  );

  it("탭은 취득·보유·양도 순이고 취득 탭은 원인 3칸(매매·상속·증여)이다", () => {
    expect(view.tabs.map((t) => t.label)).toEqual(["취득", "보유", "양도"]);
    expect(view.tabs[0]!.causes.map((c) => c.label)).toEqual(["매매", "상속", "증여"]);
    expect(view.tabs[1]!.causes).toEqual([]);
  });

  it("상속·증여 칸은 1단계 안내 페이지로 잇고 매매 칸은 잇지 않는다", () => {
    const [paid, inh, gift] = view.tabs[0]!.causes;
    expect(paid!.guideHref).toBeNull();
    expect(inh!.guideHref).toBe(INHERITANCE_GIFT_HREF);
    expect(gift!.guideHref).toBe(INHERITANCE_GIFT_HREF);
    expect(inh!.sections.map((s) => s.title)).toEqual(["시험용 상속 칸"]);
  });

  it("절마다 세목 배지가 하나이고 절 안에 국세·지방세가 섞이지 않는다", () => {
    for (const t of view.tabs) for (const s of [...t.sections, ...t.causes.flatMap((c) => c.sections)]) expect(["local", "national"]).toContain(s.taxKind);
  });

  it("양도 탭에는 해설과 확인 목록만 있고 계산 입력 칸 정보가 없다", () => {
    const transfer = view.tabs[2]!;
    expect(transfer.sections.map((s) => s.title)).toEqual(["시험용 양도 해설"]);
    expect(transfer.causes).toEqual([]);
    expect(view.checklist).toHaveLength(1);
    expect(JSON.stringify(transfer)).not.toMatch(/price|sale|매도가|금액/);
  });

  it("가이드 절이 하나도 없으면 모든 탭이 비어 있다 (감수 전)", () => {
    const empty = buildLifecycleView({ sections: [], facts: {} });
    expect(empty.tabs.every((t) => t.sections.length === 0 && t.causes.every((c) => c.sections.length === 0))).toBe(true);
    expect(empty.checklist).toEqual([]);
  });
});
