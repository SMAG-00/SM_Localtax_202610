import { Eyebrow, SituationCard } from "@ltr/ui";
import { REGION_TAX_LINKS_TITLE, type RegionTaxLinksView } from "@/lib/server/public/region-official-logic";
import { UNDER_REVIEW_LABEL } from "@/lib/site/source-cards";
import { ToolCardsRow } from "./calc/ToolCardsRow";
import { ArticleItem } from "./ArticleItem";
import { OfficialLinkCard, linkSiteLabel } from "./OfficialLinkCard";

// 지역 세금 연결 블록 (W4 9단계 — PRD-01B REG1-10 · REG-01 · 설계 2.3 · 12장 #25) — 지자체 허브 ⑤ 뒤, 데이터 출처 줄 앞의 흰 카드 'NEXT STEP'.
// 줄 넷: 상황 카드(지자체뉴스·부동산 허브 줄) · 지방세 감수 해설 · SM 취득세 카드(공용 카드 — 새 창·noreferrer·저장 주소 그대로, 끊김이면 대체 안내) · 공식 원문(새 창).
// 줄마다 0이면 줄째 숨김, 모두 0이면 블록째 0(화면이 null을 받는다). 자체 계산기(/calc/*)·정비사업 현황·조례 원문 링크 0(2·3단계 기능).
// 누름 측정(region_to_tax_clicked 등)은 24단계 — 이 블록은 화면만 그린다(측정 요소 0).

const ROW_TITLE = "text-[17px] font-black text-navy-900";

export function RegionTaxLinksBlock({ view }: { view: RegionTaxLinksView }) {
  return (
    <section data-ui="region-tax-links" aria-labelledby="region-tax-links-title" className="rounded-2xl border border-navy-100 bg-white p-6">
      <Eyebrow>NEXT STEP</Eyebrow>
      <h2 id="region-tax-links-title" className="mt-3 text-[22px] font-black tracking-tight text-navy-900">
        {REGION_TAX_LINKS_TITLE}
      </h2>
      {view.situations.length > 0 && (
        <div data-tax-links-row="situations" className="mt-6">
          <h3 className={ROW_TITLE}>상황별 안내</h3>
          <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {view.situations.map((s) => (
              <li key={s.slug} data-situation-slug={s.slug}>
                <SituationCard href={s.href} pictogram={s.pictogram} title={s.title} description={s.subtitle} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {view.explainers.length > 0 && (
        <div data-tax-links-row="explainers" className="mt-6">
          <h3 className={ROW_TITLE}>지방세 감수 해설</h3>
          <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {view.explainers.map((a) => (
              <li key={a.id} data-article-id={a.id} className="flex">
                <ArticleItem item={a} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {view.tools && view.tools.length > 0 && (
        <div data-tax-links-row="tools" className="mt-6">
          <h3 className={ROW_TITLE}>계산기</h3>
          <ToolCardsRow cards={view.tools} smLinks={[]} fallbacks={[]} regionCode={view.toolRegion ?? null} measure="region_hub" />
        </div>
      )}
      {view.sm && (
        <div data-tax-links-row="sm-calculator" className="mt-6">
          <h3 className={ROW_TITLE}>세금 계산기 (별도 사이트)</h3>
          <ul className="mt-3 grid gap-4 sm:grid-cols-2">
            <OfficialLinkCard card={view.sm.card} site={linkSiteLabel(view.sm.card.kind)} fallbacks={view.sm.fallbacks} rank={1} />
          </ul>
        </div>
      )}
      {view.originals.length > 0 && (
        <div data-tax-links-row="originals" className="mt-6">
          <h3 className={ROW_TITLE}>공식 원문</h3>
          <ul className="mt-2 space-y-1">
            {view.originals.map((o) => (
              <li key={o.id} data-source-id={o.id} className="text-[15px] text-navy-700 [overflow-wrap:anywhere]">
                <a href={o.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-bold text-navy-900 underline underline-offset-4 hover:text-hermes-900">
                  {o.label}
                  <span className="sr-only"> (새 창)</span>
                </a>
                <span className="ml-2 text-[13px] text-navy-600">{`${o.typeLabel} · ${o.issuer}`}</span>
                {o.underReview && <span className="ml-2 inline-flex rounded-md border border-hermes-200 bg-hermes-50 px-2 py-0.5 text-[13px] font-bold text-hermes-900">{UNDER_REVIEW_LABEL}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
