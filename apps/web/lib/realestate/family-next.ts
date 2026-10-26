import { toolLinkFor, type SmLinkKey, type ToolContext } from "@/lib/calc/tool-link";
import { HOUSE_COUNT_KIND } from "./house-count";

// 상속·증여 후 다음에 확인할 것 링크 묶음 (FAM-05 · b7) - 주택 수 판정 · 보유세 · 추후 양도세 안내, 카드 최대 3장.
//  · 대상 도구가 공개된 것만 보인다. 미공개면 그 카드 0장, "준비 중" 카드 0 (카드 목록에 자리를 만들지 않는다).
//  · 넘기는 값(원인·주택 수)은 주소에 싣지 않는다: href는 경로뿐이고 값은 handoff 메모리로만 간다(RE-04). 양도세 카드는 SM 외부 카드라 값 0.
//  · 상속과 증여는 판정표 종류가 다르다(house_count_inheritance / house_count_gift). 금액·세율·공제 표시 0.

export type FamilyCause = "INHERITANCE" | "GIFT";

export type FamilyNextCard =
  | { id: "house_count"; href: "/calc/house-count"; tableKinds: ("house_count_inheritance" | "house_count_gift")[] }
  | { id: "holding"; href: "/calc/holding" }
  | { id: "transfer"; smLinkKey: SmLinkKey };

export interface FamilyNextContext {
  /** 기능 키 house_count */
  houseCountOn: boolean;
  /** 서명(활성)된 판정표 종류들 (public_determination_tables) */
  activeTableKinds: readonly string[];
  tool: ToolContext;
}

/** cause가 null이면 원인을 알 수 없는 화면(안내 페이지·상황 페이지) - 상속·증여 중 서명된 판정표가 하나라도 있으면 주택 수 카드 1장 */
export function familyNextCards(cause: FamilyCause | null, ctx: FamilyNextContext): FamilyNextCard[] {
  const cards: FamilyNextCard[] = [];
  const wanted = (cause ? [cause] : (["INHERITANCE", "GIFT"] as const)).map((c) => HOUSE_COUNT_KIND[c] as "house_count_inheritance" | "house_count_gift");
  const tableKinds = wanted.filter((k) => ctx.activeTableKinds.includes(k));
  if (ctx.houseCountOn && tableKinds.length > 0) cards.push({ id: "house_count", href: "/calc/house-count", tableKinds });
  if (toolLinkFor("holding", null, ctx.tool).kind === "self") cards.push({ id: "holding", href: "/calc/holding" });
  const transfer = toolLinkFor("transfer", null, ctx.tool);
  if (transfer.kind === "sm") cards.push({ id: "transfer", smLinkKey: transfer.linkKey });
  return cards;
}
