import { describe, expect, it } from "vitest";
import type { ToolContext } from "@/lib/calc/tool-link";
import { ALL_OPEN, ENGINE_HASH } from "@/lib/calc/fixture.test-util";
import { familyNextCards, type FamilyNextContext } from "./family-next";

const TOOL: ToolContext = {
  features: { calc: true, sm_calculator: true, self_calculator: true, calc_acquisition: true, calc_holding: true, calc_refund: false },
  gateRows: ALL_OPEN,
  engineHash: ENGINE_HASH,
  refundTableActive: false,
};
const ctx = (over: Partial<FamilyNextContext> = {}): FamilyNextContext => ({ houseCountOn: true, activeTableKinds: ["house_count_inheritance", "house_count_gift"], tool: TOOL, ...over });
const ids = (c: ReturnType<typeof familyNextCards>) => c.map((x) => x.id);

describe("다음에 확인할 것 링크 묶음 (FAM-05)", () => {
  it("도구가 모두 공개면 주택 수 판정 · 보유세 · 양도세 안내 3장이다", () => {
    expect(ids(familyNextCards("INHERITANCE", ctx()))).toEqual(["house_count", "holding", "transfer"]);
  });

  it("원인에 따라 서로 다른 판정표 종류를 가리킨다", () => {
    const inh = familyNextCards("INHERITANCE", ctx())[0]!;
    const gift = familyNextCards("GIFT", ctx())[0]!;
    expect(inh).toMatchObject({ id: "house_count", tableKinds: ["house_count_inheritance"] });
    expect(gift).toMatchObject({ id: "house_count", tableKinds: ["house_count_gift"] });
  });

  it("그 원인의 판정표가 서명(활성)되지 않았으면 주택 수 카드는 0장이고 다른 원인 표로 대신하지 않는다", () => {
    expect(ids(familyNextCards("GIFT", ctx({ activeTableKinds: ["house_count_inheritance"] })))).toEqual(["holding", "transfer"]);
  });

  it("원인을 모르는 화면(cause null)은 서명된 상속·증여 판정표 종류를 모두 가리키고, 하나만 서명됐으면 그것만 가리킨다", () => {
    expect(familyNextCards(null, ctx())[0]).toMatchObject({ id: "house_count", tableKinds: ["house_count_inheritance", "house_count_gift"] });
    expect(familyNextCards(null, ctx({ activeTableKinds: ["house_count_gift"] }))[0]).toMatchObject({ tableKinds: ["house_count_gift"] });
    expect(familyNextCards(null, ctx({ activeTableKinds: ["house_count"] })).some((c) => c.id === "house_count")).toBe(false);
  });

  it("기능 키가 꺼져 있으면 주택 수 카드 0장", () => {
    expect(ids(familyNextCards("INHERITANCE", ctx({ houseCountOn: false })))).toEqual(["holding", "transfer"]);
  });

  it("보유세 게이트가 닫히거나 SM 연결이 꺼지면 그 카드는 자리째 없다 (준비 중 카드 0)", () => {
    expect(ids(familyNextCards("GIFT", ctx({ tool: { ...TOOL, gateRows: [] } })))).toEqual(["house_count", "transfer"]);
    expect(ids(familyNextCards("GIFT", ctx({ tool: { ...TOOL, features: { ...TOOL.features, sm_calculator: false } } })))).toEqual(["house_count", "holding"]);
    expect(familyNextCards("GIFT", ctx({ houseCountOn: false, activeTableKinds: [], tool: { ...TOOL, gateRows: [], features: { ...TOOL.features, sm_calculator: false } } }))).toEqual([]);
  });

  it("어떤 카드의 주소에도 값(쿼리·해시)이 없고, 양도세 카드는 SM 연결 키뿐이다", () => {
    for (const c of familyNextCards("INHERITANCE", ctx())) {
      if ("href" in c) expect(c.href).toMatch(/^\/calc\/[a-z-]+$/);
      else expect(c).toEqual({ id: "transfer", smLinkKey: "transfer" });
    }
  });
});
