import { causeOpen, groupOpen, type Cause, type GateRow } from "@/lib/accuracy/gate";

// 도구 전환 함수 하나 (TX-04 · HOME-08 · GROW-02 · REG1-10) - 홈·/calc·분야 허브·지자체 허브·검색·「지방세로 읽기」·AI 도우미가 모두 이 함수로 어디로 보낼지 정한다.
//  · 세목마다 결과는 정확히 하나다(자체 / SM 카드 / 외부 카드 / 없음) - 0장·2장이 되는 경로가 없다.
//  · 자체 계산기는 공개 게이트(calc_gate_status 뷰의 is_open + 배포된 엔진 해시)와 기능 키가 모두 맞을 때만. 수동 켜기 경로 0 (self_calculator 는 끄는 스위치로만).
//  · 국세(양도·상속·증여)는 금액을 만들지 않으므로 SM 메뉴 / 외부 카드로만 보낸다. 3단계에서 자체 카드로 바꿀 때는 이 함수만 고친다.
//  · 입력값·결과값을 주소에 싣지 않는다 - 반환에는 경로와 카드 키뿐이다.

export type ToolId = "acquisition" | "property" | "comprehensive" | "holding" | "refund" | "transfer" | "inheritance_gift" | "oligopoly";

/** official_links(kind sm_calculator) 키 */
export type SmLinkKey = "acquisition" | "property_tax" | "transfer" | "oligopoly";

export type ToolLink =
  | { kind: "self"; href: "/calc/acquisition" | "/calc/holding" | "/calc/refund" }
  | { kind: "sm"; linkKey: SmLinkKey }
  | { kind: "external"; linkKey: "inheritance_gift" }
  | { kind: "none" };

export interface ToolContext {
  features: {
    calc: boolean;
    sm_calculator: boolean;
    self_calculator: boolean;
    calc_acquisition: boolean;
    calc_holding: boolean;
    calc_refund: boolean;
  };
  gateRows: readonly GateRow[];
  /** 지금 배포된 엔진 해시 */
  engineHash: string;
  /** 활성(서명·승인된) 환급 판정표가 있나 */
  refundTableActive: boolean;
}

const SM_KEY: Record<"acquisition" | "property" | "comprehensive" | "holding" | "transfer" | "oligopoly", SmLinkKey> = {
  acquisition: "acquisition",
  holding: "property_tax",
  property: "property_tax",
  comprehensive: "property_tax",
  transfer: "transfer",
  oligopoly: "oligopoly",
};

export function toolLinkFor(tool: ToolId, cause: Cause | null | undefined, ctx: ToolContext): ToolLink {
  const f = ctx.features;
  if (tool === "inheritance_gift") return { kind: "external", linkKey: "inheritance_gift" };
  const sm = (key: SmLinkKey): ToolLink => (f.sm_calculator ? { kind: "sm", linkKey: key } : { kind: "none" });
  if (tool === "transfer" || tool === "oligopoly") return sm(SM_KEY[tool]);
  const selfOn = f.calc && f.self_calculator;
  if (tool === "refund") return selfOn && f.calc_refund && ctx.refundTableActive ? { kind: "self", href: "/calc/refund" } : { kind: "none" };
  if (tool === "acquisition") {
    // 원인을 주면 그 원인의 묶음만, 안 주면 세목 기본 묶음(유상취득·원시취득)을 본다 (FAM-07)
    const open = cause ? causeOpen(ctx.gateRows, "acquisition", cause, ctx.engineHash) : groupOpen(ctx.gateRows, "acquisition", "OTHER", ctx.engineHash);
    return selfOn && f.calc_acquisition && open ? { kind: "self", href: "/calc/acquisition" } : sm(SM_KEY.acquisition);
  }
  // 재산세·종합부동산세는 세목마다 따로 본다 (한 세목만 열리면 그 세목만 자체). holding은 둘 중 하나라도 열렸는지 - 허브가 카드 한 장으로 묶을 때 쓴다
  const open = tool === "holding" ? groupOpen(ctx.gateRows, "property", "ALL", ctx.engineHash) || groupOpen(ctx.gateRows, "comprehensive", "ALL", ctx.engineHash) : groupOpen(ctx.gateRows, tool, "ALL", ctx.engineHash);
  return selfOn && f.calc_holding && open ? { kind: "self", href: "/calc/holding" } : sm(SM_KEY[tool]);
}
