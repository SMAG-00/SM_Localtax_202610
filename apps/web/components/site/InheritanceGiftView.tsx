import type { ReactNode } from "react";
import { SituationCard, TaxKindBadge, UiLink } from "@ltr/ui";
import type { InheritanceGiftView as View } from "@/lib/server/public/inheritance-gift";
import { ArticleItem } from "./ArticleItem";
import { MeasureCalculatorCards, MeasureInheritanceSituations } from "./Measure";
import { OfficialLinkCard, linkSiteLabel } from "./OfficialLinkCard";
import { OwnCards, ownCount } from "./igt/OwnCards";

// 상속·증여 안내 (/realestate/inheritance-gift · /inheritance · /gift — W4 23단계, FAM-01·02·08). 고지 문구 1개 · 국세/지방세 구분 · 상황 카드 · 입문 기사 카드(배지·최종 감수일) ·
// SM 취득세 카드 1 · FAM-08 카드 1. 계산·세액 입력 요소 0. 내용 문장은 설정·감수 기사에서 온다(여기는 이름과 구조만).

const H2 = "text-[19px] font-black text-navy-900";
const RELATION = "별도 사이트 · 새 창 · 이 사이트의 결과와 합산하지 않습니다";

export function InheritanceGiftView({ view, after }: { view: View; after?: ReactNode }) {
  return (
    <main id="main" data-ui="inheritance-gift" data-path={view.path} className="mx-auto w-full max-w-[1100px] px-4 py-10">
      <MeasureInheritanceSituations />
      {/* FAM-08·SM 취득세 카드의 이동 링크 누름 → calculator_card_clicked(화면 inheritance_gift) (W4 24단계) */}
      <MeasureCalculatorCards screen="inheritance_gift" section="realestate" />
      <h1 className="text-[28px] font-black text-navy-900">{view.title}</h1>
      <section data-part="tax-kinds" aria-label="국세와 지방세 구분" className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-navy-100 bg-white p-5">
          <p><TaxKindBadge kind="local" /></p>
          <p className="mt-2 text-[16px] font-bold text-navy-900">취득세</p>
        </div>
        <div className="rounded-2xl border border-navy-100 bg-white p-5">
          <p><TaxKindBadge kind="national" /></p>
          <p className="mt-2 text-[16px] font-bold text-navy-900">상속세·증여세</p>
          <p data-part="notice" className="mt-2 text-[15px] leading-6 text-navy-800">{view.notice}</p>
        </div>
      </section>
      {view.situations.length > 0 && (
        <section data-part="ig-situations" aria-labelledby="ig-situations-title" className="mt-10">
          <h2 id="ig-situations-title" className={H2}>상황별 안내</h2>
          <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {view.situations.map((s) => (
              <li key={s.slug} data-situation-slug={s.slug}>
                <SituationCard href={s.href} pictogram={s.pictogram} title={s.title} description={s.subtitle} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {view.articles.length > 0 && (
        <section data-part="intro-articles" aria-labelledby="ig-articles-title" className="mt-10">
          <h2 id="ig-articles-title" className={H2}>취득세 입문 기사</h2>
          <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {view.articles.map((a) => (
              <li key={a.item.id} data-article-id={a.item.id} className="flex flex-col gap-2">
                <p data-part="intro-badge"><TaxKindBadge kind="local" reviewedAt={a.reviewedOn} /></p>
                <ArticleItem item={a.item} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {(view.sm || view.selfCalculatorHref) && (
        <section data-part="sm-card" aria-labelledby="ig-sm-title" className="mt-10">
          <h2 id="ig-sm-title" className={H2}>취득세 계산 (별도 사이트)</h2>
          {view.sm && (
            <ul className="mt-3 grid gap-4 sm:grid-cols-2">
              <OfficialLinkCard card={view.sm.card} site={linkSiteLabel(view.sm.card.kind)} fallbacks={view.sm.fallbacks} rank={1} />
            </ul>
          )}
          {view.selfCalculatorHref && (
            <p data-part="self-calculator" className="mt-3">
              <UiLink href={view.selfCalculatorHref} className="inline-flex min-h-11 items-center font-bold underline underline-offset-4">
                취득세 계산하기
              </UiLink>
            </p>
          )}
        </section>
      )}
      {view.own && ownCount(view.own) > 0 && (
        <section data-part="own-calc" aria-labelledby="ig-own-title" className="mt-10">
          <h2 id="ig-own-title" className={H2}>상속세·증여세 계산 (이 사이트)</h2>
          <ul className="mt-3 grid gap-4 sm:grid-cols-2">
            <OwnCards state={view.own} startRank={1} />
          </ul>
        </section>
      )}
      {view.fam08 && !(view.own && view.own.gift && view.own.inheritance) && (
        <section data-part="fam08" aria-labelledby="ig-fam08-title" className="mt-10">
          <h2 id="ig-fam08-title" className={H2}>상속세·증여세 계산은 안심 상속증여계산기(별도 사이트)에서</h2>
          <ul className="mt-3 grid gap-4 sm:grid-cols-2">
            <OfficialLinkCard card={view.fam08.card} site={RELATION} fallbacks={view.fam08.fallbacks} rank={1} />
          </ul>
        </section>
      )}
      {after}
    </main>
  );
}
