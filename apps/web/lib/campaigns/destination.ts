// 캠페인 도착 주소 (GROW-03) - 도착은 키 4개 중 하나. 열려 있는 도착(바로가기 열림 판정)만 주소가 있고, 닫혀 있으면 null
//  · 계산기는 도구가 지정돼 있고 자체 계산기가 열려 있으면(toolLinkFor 결과 self) 그 계산기 화면, 아니면 허브 /calc (허브가 SM 연결 카드를 보여준다 - W10-b 규칙)
//  · 주소에는 쿼리·태그를 싣지 않는다
import { stripTrackingParams } from "./utm";

export const CALC_TOOLS = ["acquisition", "holding", "refund"] as const;

/** 도구별 자체 계산기 주소 - toolLinkFor가 self일 때만 주소, 게이트가 닫혔거나 SM·외부·없음이면 null */
export type SelfToolHrefs = Partial<Record<(typeof CALC_TOOLS)[number], string | null>>;

export function campaignDestinationHref(target: string, tool: string | null, open: readonly { key: string; href: string }[], selfTools: SelfToolHrefs = {}): string | null {
  const hit = open.find((o) => o.key === (target === "calc" ? "calc" : target));
  if (!hit) return null;
  if (target === "calc" && tool && (CALC_TOOLS as readonly string[]).includes(tool)) return selfTools[tool as keyof SelfToolHrefs] ?? hit.href;
  return stripTrackingParams(hit.href);
}
