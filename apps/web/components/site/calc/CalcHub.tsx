import { Pictogram, RulesetLabel } from "@ltr/ui";
import { OfficialLinkCard, linkSiteLabel } from "@/components/site/OfficialLinkCard";
import { MeasureCalculatorCards } from "@/components/site/Measure";
import { OwnCards, hiddenExternalKeys, ownCount, type OwnState } from "@/components/site/igt/OwnCards";
import type { GuideRow } from "@/lib/calc/guide";
import type { ToolLink } from "@/lib/calc/tool-link";
import type { CalcView } from "@/lib/server/public/calc";

// 계산기 허브 (/calc, TX-04) - 세목마다 카드 정확히 1장: 자체 계산기 / SM 카드 / 외부 카드. 어느 쪽인지는 toolLinkFor(게이트 결과)가 정하고, 이 화면에 켜기 스위치는 없다.
export interface CalcHubProps {
  view: CalcView;
  acquisition: ToolLink;
  holding: ToolLink;
  refund: ToolLink;
  /** 게이트가 열린 국세 자체 카드 (W11-g, FAM-14) - 없으면 외부 카드 그대로 */
  own?: OwnState;
  compare: boolean;
  accuracy: boolean;
  rulesetVersion: string | null;
  /** 출처·확인일이 있는 위택스 이용 안내만 (WETAX-02) */
  guides: GuideRow[];
}

const CARD = "block rounded-2xl border border-navy-100 bg-white p-6 hover:border-navy-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500";

function SelfCard({ href, icon, title, note, rank }: { href: string; icon: "acquisition" | "property" | "refund"; title: string; note: string; rank: number }) {
  return (
    <li data-link-card={`self_${icon}`} data-link-rank={rank} data-tool-kind="self">
      <a href={href} className={CARD}>
        <Pictogram name={icon} label={title} showLabel={false} size={32} layout="center" />
        <span className="mt-3 block text-[19px] font-black text-navy-900">{title}</span>
        <span className="mt-1 block text-[14px] text-navy-600">{note}</span>
      </a>
    </li>
  );
}

export function CalcHub({ view, acquisition, holding, refund, own, compare, accuracy, rulesetVersion, guides }: CalcHubProps) {
  const cards: React.ReactNode[] = [];
  let rank = 0;
  if (acquisition.kind === "self") cards.push(<SelfCard key="acq" href={acquisition.href} icon="acquisition" title="취득세 계산하기" note="이 사이트 계산기" rank={++rank} />);
  if (holding.kind === "self") cards.push(<SelfCard key="hold" href={holding.href} icon="property" title="재산세·종합부동산세 계산하기" note="이 사이트 계산기" rank={++rank} />);
  const ownRank = rank + 1;
  rank += ownCount(own);
  const hidden = hiddenExternalKeys(own);
  const external = view.external.filter((c) => !hidden.includes(c.key));
  // SM 카드 - 자체 계산기로 바뀐 세목의 카드는 빠진다(세목마다 정확히 1장)
  const sm = view.sm.filter((c) => !(c.key === "acquisition" && acquisition.kind === "self") && !(c.key === "property_tax" && holding.kind === "self"));
  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-10" data-ui="calc-hub">
      <MeasureCalculatorCards screen="calc" section={null} />
      <h1 className="text-[28px] font-black text-navy-900">세금 계산기</h1>
      {rulesetVersion && (
        <div className="mt-1">
          <RulesetLabel version={rulesetVersion} />
        </div>
      )}
      <p className="mt-2 text-[15px] text-navy-700">입력한 값은 어느 사이트로도 넘어가지 않아요. {own && ownCount(own) > 0 ? "양도세는 이 사이트에서 계산하지 않고 별도 사이트로 연결만 해요. 상속세·증여세는 검증을 통과한 세목만 이 사이트에서 계산하고, 국세 금액은 지방세 금액과 합산하지 않아요." : "양도세·상속세·증여세는 이 사이트에서 계산하지 않고 별도 사이트로 연결만 해요."}</p>
      <ul data-part="tool-cards" className="mt-8 grid gap-4 sm:grid-cols-2">
        {cards}
        {own ? <OwnCards state={own} startRank={ownRank} /> : null}
        {sm.map((c) => (
          <OfficialLinkCard key={c.id} card={c} site={linkSiteLabel(c.kind)} fallbacks={view.fallbacks} rank={++rank} />
        ))}
      </ul>
      {(refund.kind === "self" || compare || accuracy) && (
        <ul data-part="in-site-tools" className="mt-8 flex flex-wrap gap-3">
          {refund.kind === "self" && (
            <li>
              <a href={refund.href} className="inline-flex min-h-11 items-center font-bold text-navy-900 underline underline-offset-4">환급 자가진단</a>
            </li>
          )}
          {compare && (
            <li>
              <a href="/calc/compare" className="inline-flex min-h-11 items-center font-bold text-navy-900 underline underline-offset-4">조건 바꿔 비교 (회원)</a>
            </li>
          )}
          {accuracy && (
            <li>
              <a href="/calc/accuracy" className="inline-flex min-h-11 items-center font-bold text-navy-900 underline underline-offset-4">계산 정확도 검증</a>
            </li>
          )}
        </ul>
      )}
      {guides.length > 0 && (
        <details data-part="wetax-guide" className="mt-8 rounded-2xl border border-navy-100 p-5">
          <summary className="min-h-11 cursor-pointer text-[17px] font-black text-navy-900">위택스 이용 안내</summary>
          <ul className="mt-3 space-y-3">
            {guides.map((g) => (
              <li key={g.key} data-guide={g.key}>
                <p className="font-bold text-navy-900">{g.label}</p>
                <p className="text-[15px] text-navy-800">{g.body}</p>
                <p className="font-mono text-[13px] text-navy-600">출처 {g.source} · 확인일 {g.confirmed_on}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
      {external.length > 0 && (
        <section aria-labelledby="calc-external" className="mt-10">
          <h2 id="calc-external" className="text-[17px] font-black text-navy-900">다른 사이트의 계산기</h2>
          <ul data-part="external-cards" className="mt-3 grid gap-4 sm:grid-cols-2">
            {external.map((c) => (
              <OfficialLinkCard key={c.id} card={c} site={linkSiteLabel(c.kind)} fallbacks={view.fallbacks} rank={++rank} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
