import { JsonLd } from "./JsonLd";
import type { ReactNode } from "react";
import { breadcrumbList, toJsonLdScriptContent } from "@ltr/structured-data";
import { Eyebrow, PresaleInfoCard, SourceLine, UiLink, cx } from "@ltr/ui";
import type { SupplyCard } from "@/lib/server/public/supply-logic";
import type { SupplyListView } from "@/lib/server/public/supply";
import { SiteSection } from "./SiteSection";

// 분양 정보 화면 (W4 17단계 — PRD-01B 3.2 '분양 정보' · PR-04 · PR-01 · PR-05, docs/dev/W4_설계.md 5장 · 12장 #11 · 140번~).
//  · 목록 /realestate/supply — '정보 목록' 표시(기사 유형 배지 아님) · 지역 칩(JS 없이 링크) · 분양 정보 카드(사업명·지역 이름·코드·청약 단계·공급 규모·청약 일정 고정폭·
//    출처(공고 기관)·기준일(모집공고일)·확인일·[공식 공고 — 새 창]) · 데이터 출처 줄. 청약 마감일 다음 날 00:00(KST)부터 빠진다
//  · 지역 허브 ③ 묶음 '분양 정보'·프로젝트 화면 '분양 정보'가 같은 카드(SupplyCardView)
//  · 가격·분양가·분담금·수익률·시세 요소 0(공개 뷰에 칸이 없다 — PR-05) · 구조화 데이터는 BreadcrumbList만(NewsArticle·Offer·Event 0)

/** 화면 글자 — 가격 낱말 0 (시험이 화면 글자를 가격 사전으로 본다) */
export const SUPPLY_COPY = {
  lead: "분양 공고를 기사와 나눠 모은 정보 목록입니다. 공급 규모와 청약 일정은 공식 공고를 보고 적었고, 자세한 내용은 공식 공고에서 확인하세요.",
  listMark: "정보 목록",
  empty: "청약 마감일이 지나지 않은 분양 정보가 아직 없습니다.",
  filteredEmpty: "고른 지역의 분양 정보가 없습니다.",
  groupNote: "청약 마감일이 지나지 않은 분양 공고입니다. 공식 공고에서 확인하세요.",
  groupMore: "이 지역 분양 정보 더 보기",
  projectNote: "이 프로젝트와 이은 분양 공고입니다. 청약이 끝난 공고도 기록으로 남깁니다.",
} as const;

/** 분양 정보 카드 — 목록·지역 허브 ③·프로젝트 화면이 같은 카드 (칸이 빈 카드는 supply-logic이 만들지 않는다) */
export function SupplyCardView({ card }: { card: SupplyCard }) {
  return (
    <div
      data-supply-card={card.id}
      data-region-code={card.region.code}
      data-phase={card.phase.key}
      data-apply-end={card.applyEnd}
      data-source={card.issuer}
      data-base-date={card.noticeDate}
      data-verified={card.verifiedOn}
      className="flex h-full w-full [&>article]:w-full"
    >
      <PresaleInfoCard
        name={card.name}
        region={card.region.name}
        regionCode={card.region.code}
        supply={card.supplyScale}
        subscriptionStart={card.applyStart}
        subscriptionEnd={card.applyEnd}
        phase={card.phase.label}
        issuer={card.issuer}
        noticeDate={card.noticeDate}
        {...(card.license ? { license: card.license } : {})}
        noticeUrl={card.noticeUrl}
        checkedAt={card.verifiedOn}
        {...(card.project ? { projectHref: card.project.href } : {})}
      />
    </div>
  );
}

function Crumbs({ crumbs }: { crumbs: SupplyListView["crumbs"] }) {
  return (
    <nav aria-label="현재 위치" data-part="crumbs">
      <ol className="flex flex-wrap items-center gap-x-2 text-[15px]">
        {crumbs.map((c, i) => (
          <li key={c.href} className="inline-flex items-center gap-x-2">
            {i > 0 && (
              <span aria-hidden="true" className="text-navy-300">
                ›
              </span>
            )}
            <UiLink
              href={c.href}
              aria-current={i === crumbs.length - 1 ? "page" : undefined}
              className="inline-flex min-h-11 items-center font-semibold text-navy-600 transition hover:text-hermes-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500 aria-[current=page]:font-bold aria-[current=page]:text-navy-900"
            >
              {c.name}
            </UiLink>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function SupplyList({ view }: { view: SupplyListView }) {
  const jsonLd = view.breadcrumb ? toJsonLdScriptContent([breadcrumbList(view.breadcrumb)]) : null;
  return (
    <div data-ui="supply-list" data-supply-total={String(view.total)} data-list-kind="info">
      <JsonLd content={jsonLd} />
      <SiteSection id="supply-head" tone="ivory" first data={{ "data-supply-part": "head" }}>
        <Crumbs crumbs={view.crumbs} />
        <div className="mt-6">
          <Eyebrow>SUPPLY</Eyebrow>
          <h1 className="mt-3 text-[32px] leading-tight font-black tracking-tight text-navy-900 sm:text-[40px]">분양 정보</h1>
          <p className="mt-3">
            <span data-part="list-mark" className="inline-flex items-center rounded-md border border-navy-200 bg-white px-2 py-0.5 text-[13px] font-bold text-navy-800">
              {SUPPLY_COPY.listMark}
            </span>
          </p>
          <p className="mt-4 max-w-2xl text-[17px] text-navy-700">{SUPPLY_COPY.lead}</p>
        </div>
      </SiteSection>
      <SiteSection id="supply-items" tone="ivory-dark" data={{ "data-supply-part": "list" }}>
        {view.chips.length > 0 && (
          <div data-part="filter-region">
            <p className="text-[13px] font-bold text-navy-600">지역</p>
            <ul aria-label="지역" className="mt-2 flex flex-wrap gap-2">
              {view.chips.map((c) => (
                <li key={c.value ?? "all"}>
                  <UiLink
                    href={c.href}
                    aria-current={c.current ? "true" : undefined}
                    data-filter-value={c.value ?? ""}
                    className={cx(
                      "inline-flex min-h-11 items-center rounded-md border px-3 text-[15px] font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500",
                      c.current ? "border-navy-900 bg-navy-900 text-white" : "border-navy-100 bg-white text-navy-700 hover:border-hermes-400",
                    )}
                  >
                    {c.label}
                    {c.value !== null && <span className="ml-1.5 font-mono text-[13px] font-normal">{c.count}</span>}
                  </UiLink>
                </li>
              ))}
            </ul>
          </div>
        )}
        {view.items.length === 0 ? (
          <p data-part="empty" className="mt-10 text-[17px] text-navy-600">
            {view.total === 0 ? SUPPLY_COPY.empty : SUPPLY_COPY.filteredEmpty}
          </p>
        ) : (
          <ul data-part="supply-cards" className="mt-10 grid gap-4 sm:grid-cols-2">
            {view.items.map((c) => (
              <li key={c.id} className="flex">
                <SupplyCardView card={c} />
              </li>
            ))}
          </ul>
        )}
        {view.sourceLine && (
          <div data-supply-part="source" className="mt-12">
            <SourceLine source={view.sourceLine.source} baseDate={view.sourceLine.baseDate} checkedAt={view.sourceLine.checkedAt} />
          </div>
        )}
      </SiteSection>
    </div>
  );
}

/** 프로젝트 화면 '분양 정보' — 그 프로젝트에 이은 공개 항목(예정·접수 중 먼저, 지난 항목은 '청약 마감' 기록). 0건이면 자리 0 */
export function ProjectSupplySection({ cards, tone, footer }: { cards: readonly SupplyCard[]; tone: "ivory" | "ivory-dark"; footer?: ReactNode }) {
  if (cards.length === 0) return null;
  return (
    <SiteSection id="project-supply" tone={tone} heading={{ eyebrow: "SUPPLY", title: "분양 정보" }} data={{ "data-project-part": "supply" }}>
      <p className="mt-3 text-[15px] text-navy-600">{SUPPLY_COPY.projectNote}</p>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <li key={c.id} className="flex">
            <SupplyCardView card={c} />
          </li>
        ))}
      </ul>
      {footer}
    </SiteSection>
  );
}
