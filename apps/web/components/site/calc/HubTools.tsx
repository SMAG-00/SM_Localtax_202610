import { getToolCards } from "@/lib/server/public/tool-cards";
import { ToolCardsRow } from "./ToolCardsRow";

// 분야 허브(/tax · /realestate)의 계산기 줄 (TX-04) - toolLinkFor가 정한 카드 한 줄. 기능 키 calc가 꺼졌거나 읽지 못하면 아무것도 그리지 않는다(허브는 그대로).
export async function HubTools() {
  const data = await getToolCards(["acquisition", "holding", "refund"]).catch(() => null);
  if (!data || data.cards.length === 0) return null;
  return (
    <section aria-labelledby="hub-tools" data-ui="hub-tools" className="mx-auto w-full max-w-[1100px] px-4 pb-10">
      <h2 id="hub-tools" className="text-[19px] font-black text-navy-900">
        세금 계산기
      </h2>
      <ToolCardsRow cards={data.cards} smLinks={data.smLinks} fallbacks={data.fallbacks} />
    </section>
  );
}
