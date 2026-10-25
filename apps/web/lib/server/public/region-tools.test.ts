import { describe, expect, it } from "vitest";
import { regionTaxLinks } from "./region-official-logic";
import type { OfficialLinkCard } from "./calc";
import { toolCardsFor } from "@/lib/calc/tool-cards";
import { ALL_OPEN, ENGINE_HASH } from "@/lib/calc/fixture.test-util";

// 지자체 허브 계산기 연결 (REG1-10) - 자체 도구 카드가 생기면 같은 세목의 SM 카드는 빠진다(세목마다 정확히 1장).
const features = { calc: true, sm_calculator: true, self_calculator: true, calc_acquisition: true, calc_holding: true, calc_refund: true };
const ctx = (gateRows = ALL_OPEN, refundTableActive = false) => ({ features, gateRows, engineHash: ENGINE_HASH, refundTableActive });
const smCard: OfficialLinkCard = { id: 1, kind: "sm_calculator", key: "acquisition", label: "취득세 계산기", url: "https://sm.example.test/acq", termsNote: null, status: "ok", checkedOn: "2026-10-20" };
const official = { taxExplainers: [], originals: [] } as unknown as Parameters<typeof regionTaxLinks>[0]["official"];
const input = { situations: [], situationLimit: 4, official, sm: { card: smCard, fallbacks: [] } };

describe("지자체 허브 도구 카드 (REG1-10)", () => {
  it("자체 취득세 카드가 있으면 SM 취득세 카드는 빠지고 지역 코드는 해시용으로만 실린다", () => {
    const tools = toolCardsFor(ctx()).filter((c) => c.link.kind === "self");
    const view = regionTaxLinks({ ...input, tools, regionCode: "11680" });
    expect(view?.sm).toBeNull();
    expect(view?.tools?.map((t) => t.tool)).toEqual(["acquisition", "holding"]);
    expect(view?.toolRegion).toBe("11680");
  });
  it("게이트 전이면 도구 카드가 없고 SM 카드가 그대로 남는다 (준비 중 카드 0)", () => {
    const tools = toolCardsFor(ctx([])).filter((c) => c.link.kind === "self");
    expect(tools).toEqual([]);
    const view = regionTaxLinks({ ...input, tools, regionCode: "11680" });
    expect(view?.sm?.card.key).toBe("acquisition");
    expect(view?.tools).toBeUndefined();
  });
  it("도구 카드만 있어도 블록은 비지 않는다", () => {
    const tools = toolCardsFor(ctx()).filter((c) => c.link.kind === "self");
    expect(regionTaxLinks({ ...input, sm: null, tools, regionCode: "11680" })).not.toBeNull();
    expect(regionTaxLinks({ ...input, sm: null, tools: [] })).toBeNull();
  });
});
