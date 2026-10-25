import { toolLinkFor, type SmLinkKey, type ToolContext } from "./tool-link";

// 진입점 도구 카드 (HOME-08 · REG1-10 · TX-04) - 홈·지자체 허브·분야 허브가 같은 함수로 카드를 정한다.
// 세목마다 카드는 정확히 1장(자체 또는 SM), 환급 진단은 서명된 판정표가 있을 때만(없으면 카드 0). 이 함수에 켜기 스위치는 없고 toolLinkFor(게이트 결과)만 따른다.

export type CardTool = "acquisition" | "holding" | "refund";

export interface ToolCard {
  tool: CardTool;
  label: string;
  /** @ltr/ui 픽토그램 이름 */
  pictogram: "acquisition" | "property" | "refund";
  link: { kind: "self"; href: string } | { kind: "sm"; linkKey: SmLinkKey };
}

const META: Record<CardTool, { label: string; pictogram: ToolCard["pictogram"] }> = {
  acquisition: { label: "취득세 계산하기", pictogram: "acquisition" },
  holding: { label: "재산세·종합부동산세 계산하기", pictogram: "property" },
  refund: { label: "환급 자가진단", pictogram: "refund" },
};

export function toolCardsFor(ctx: ToolContext, tools: readonly CardTool[] = ["acquisition", "holding", "refund"]): ToolCard[] {
  const cards: ToolCard[] = [];
  for (const tool of new Set(tools)) {
    const link = toolLinkFor(tool, null, ctx);
    if (link.kind === "self") cards.push({ tool, ...META[tool], link: { kind: "self", href: link.href } });
    else if (link.kind === "sm") cards.push({ tool, ...META[tool], link: { kind: "sm", linkKey: link.linkKey } });
  }
  return cards;
}

/** 지역 코드를 해시로 붙인 자체 계산기 주소 - 해시는 서버로 가지 않고 엔진 입력에도 쓰지 않는다 (REG1-10). 입력값은 붙이지 않는다 */
export function selfHref(href: string, regionCode: string | null): string {
  return regionCode && /^[A-Za-z0-9_-]{1,20}$/.test(regionCode) ? `${href}#region=${regionCode}` : href;
}

/** AI 도우미 링크 - 자체 계산기가 열린 세목의 사이트 안 주소 (official_links 키 기준). 열리지 않은 세목은 빠져 SM 카드가 그대로 나간다 */
export function selfCalculatorDocs(ctx: ToolContext): Record<string, { title: string; url: string; text: string }> {
  const out: Record<string, { title: string; url: string; text: string }> = {};
  const acquisition = toolLinkFor("acquisition", null, ctx);
  if (acquisition.kind === "self") out.acquisition = { title: "취득세 계산기 (이 사이트)", url: acquisition.href, text: "이 사이트의 취득세 계산기입니다. 입력한 값은 저장하지 않습니다" };
  const holding = toolLinkFor("holding", null, ctx);
  if (holding.kind === "self") out.property_tax = { title: "재산세·종합부동산세 계산기 (이 사이트)", url: holding.href, text: "이 사이트의 재산세·종합부동산세 계산기입니다. 입력한 값은 저장하지 않습니다" };
  return out;
}
