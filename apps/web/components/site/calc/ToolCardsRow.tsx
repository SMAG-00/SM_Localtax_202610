import { Pictogram, SmCalculatorCard, type OfficialLink } from "@ltr/ui";
import { selfHref, type ToolCard } from "@/lib/calc/tool-cards";
import type { OfficialLinkCard } from "@/lib/server/public/calc";
import { MeasureToolCards } from "./Measure";

// 도구 카드 한 줄 (HOME-08 홈 · REG1-10 지자체 허브) - 자체 계산기는 픽토그램 카드(글자 라벨 함께, R11), 게이트 전 세목은 같은 자리에 SM 카드(새 창·외부 표시).
// 360px 2열, 1024px 이상 4열. 카드를 누르면 첫 질문 화면이 열린다. 입력값은 주소에 없고, 지역 코드만 해시로 붙는다.
const toLink = (c: OfficialLinkCard): OfficialLink => ({ url: c.url, status: c.status, checkedAt: c.checkedOn ?? "" });
const SM_NAME: Record<string, "acquisition" | "holding"> = { acquisition: "acquisition", property_tax: "holding" };

export interface ToolCardsRowProps {
  cards: ToolCard[];
  smLinks: OfficialLinkCard[];
  fallbacks: OfficialLinkCard[];
  /** 지자체 허브에서만 - 이동 측정(content_to_tool)과 해시 지역 코드 */
  regionCode?: string | null;
  /** 이동 측정(content_to_tool)을 켤 화면 */
  measure?: "region_hub" | "search";
}

export function ToolCardsRow({ cards, smLinks, fallbacks, regionCode = null, measure }: ToolCardsRowProps) {
  const wetax = fallbacks.find((f) => f.key === "wetax");
  const items = cards.flatMap((c) => {
    if (c.link.kind === "self") {
      return [
        <li key={c.tool} data-tool-card={c.tool} data-tool-kind="self">
          <a href={selfHref(c.link.href, regionCode)} className="flex min-h-11 flex-col items-center gap-2 rounded-2xl border border-navy-100 bg-white p-4 text-center hover:border-navy-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500">
            <Pictogram name={c.pictogram} label={c.label} showLabel={false} size={32} />
            <span className="text-[15px] font-bold text-navy-900">{c.label}</span>
          </a>
        </li>,
      ];
    }
    const linkKey = c.link.linkKey;
    const sm = smLinks.find((s) => s.kind === "sm_calculator" && s.key === linkKey);
    const name = SM_NAME[linkKey];
    if (!sm || !name) return [];
    return [
      <li key={c.tool} data-tool-card={c.tool} data-tool-kind="sm">
        <SmCalculatorCard calcKey={name} link={toLink(sm)} fallback={wetax ? toLink(wetax) : { url: "", status: "broken", checkedAt: "" }} usageNote={sm.termsNote ?? ""} />
      </li>,
    ];
  });
  if (items.length === 0) return null;
  return (
    <div data-ui="tool-cards" className="mt-6">
      {measure && <MeasureToolCards contentKind={measure} regionCode={regionCode} />}
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">{items}</ul>
    </div>
  );
}
