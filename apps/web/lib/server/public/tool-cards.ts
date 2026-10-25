import "server-only";
import { toolCardsFor, type CardTool, type ToolCard } from "@/lib/calc/tool-cards";
import type { OfficialLinkCard } from "./calc";
import { getCalcTools } from "./calc-tools";

// 홈·지자체 허브·분야 허브의 도구 카드 자료 (HOME-08 · REG1-10) - toolLinkFor 하나가 카드를 정한다. 기능 키 calc가 꺼져 있으면 null(카드 0).
export interface ToolCardsData {
  cards: ToolCard[];
  smLinks: OfficialLinkCard[];
  fallbacks: OfficialLinkCard[];
}

export async function getToolCards(tools?: readonly CardTool[]): Promise<ToolCardsData | null> {
  const t = await getCalcTools();
  if (!t) return null;
  return { cards: toolCardsFor(t.context, tools), smLinks: t.links.sm, fallbacks: t.links.fallbacks };
}
