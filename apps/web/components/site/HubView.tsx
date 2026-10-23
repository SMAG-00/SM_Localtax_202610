import { Chip, FieldHubHead, LocalHubBlocks, SituationCard, UiLink, type HubBlockContent } from "@ltr/ui";
import type { ArticleListItem, HubData } from "@/lib/server/public";
import { HUB_HEADINGS, SIDO_CHIP_LABELS, hubParts } from "@/lib/site/hub-view";
import { ArticleGrid, ArticleItem } from "./ArticleItem";
import { OfficialSourceCardView } from "./OfficialSourceCardView";
import { ProjectCardView } from "./ProjectView";
import { RealEstateChips, RealEstateLinkCards } from "./RealEstateHubParts";
import { OFFICIAL_GROUPS, RegionSourceLineView } from "./RegionView";
import { SUPPLY_COPY, SupplyCardView } from "./SupplyView";
import { TermChipList } from "./GlossaryView";
import { HotBlock } from "./HotBlock";
import { MeasureSituationCards, MeasureView } from "./Measure";
import { SiteSection, TEXT_LINK } from "./SiteSection";
import { UnavailableNotice } from "./Unavailable";

// 4대 분야 허브 공통 골격 (CAT-02 · UX-05 · PRD-01A 3장) — 네 허브가 이 컴포넌트 하나로 그린다.
// 머리(분야 허브 머리: 아이브로·제목·소개 → 지방세 포인트 → 탭) → 분야 고유 블록 자리 → 최신 목록 → 상담 사례 HOT(지방세 허브만 — HOME-05) → 상황 카드 0~상한 → 관련 용어.
// 내용 0건인 부분은 빠지고 순서는 그대로다. 부분마다 data-hub-part — E2E가 네 허브의 골격을 비교한다.
// 지자체뉴스 허브(/local 전국 화면 — W4 9단계)만 머리 뒤 시·도 카드(regions — region_hubs가 꺼지면 링크 없이 글자만)와 블록 ⑤ 공식 자료/해설(있을 때만),
// 맨 아래 데이터 출처 줄(source — REG-10)이 더 있다.

/** 시·도 카드 칩 (W4 11단계 — 5장 /local '시범·색인 표시'). 글자로 뜻을 전한다(PRD-00 8.9). 둘 다 아니면 요소 0 */
function SidoChips({ card }: { card: { pilot: boolean; indexed: boolean } }) {
  if (!card.pilot && !card.indexed) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {card.pilot && (
        <Chip>
          <span data-part="sido-chip" data-chip="pilot">
            {SIDO_CHIP_LABELS.pilot}
          </span>
        </Chip>
      )}
      {card.indexed && (
        <Chip>
          <span data-part="sido-chip" data-chip="indexed">
            {SIDO_CHIP_LABELS.indexed}
          </span>
        </Chip>
      )}
    </span>
  );
}

/** 블록 한 칸 — 기사 카드. 0건이면 블록째 없다 (빈 블록 0) */
function blockContent(items: readonly ArticleListItem[]): HubBlockContent | undefined {
  return items.length ? { items: items.map((a) => <ArticleItem key={a.id} item={a} />) } : undefined;
}

/** ⑤ 공식 자료/해설 (W4 9단계) — 묶음 '공식 자료 원문'·'감수 해설'. 0건이면 블록째 없다 (/local은 0건 블록을 숨긴다) */
function officialContent(official: NonNullable<HubData["blocks"]>["official"]): HubBlockContent | undefined {
  if (!official) return undefined;
  return {
    items: [],
    groups: [
      { key: "sources", ...OFFICIAL_GROUPS.sources, items: official.cards.map((c) => <OfficialSourceCardView key={c.id} card={c} as="article" articles={c.articles} />) },
      {
        key: "explainers",
        ...OFFICIAL_GROUPS.explainers,
        items: official.explainers.map((a) => (
          <div key={a.id} data-article-id={a.id} className="flex h-full">
            <ArticleItem item={a} />
          </div>
        )),
      },
    ],
  };
}

export function HubView({ hub }: { hub: HubData }) {
  const parts = hubParts(hub);
  return (
    <div data-ui="hub" data-hub={hub.section}>
      {/* 측정 (W2-c — hub_viewed, 지자체뉴스는 분야 탭). 닫힌 허브(공개 데이터를 읽지 못함)는 보내지 않는다. 그리는 것 0 */}
      {!hub.unavailable && <MeasureView name="hub_viewed" section={hub.section} props={hub.topic ? { topic: hub.topic } : undefined} />}
      {/* 상황 카드 누름 → situation_card_clicked (W2-c 3단계 — 첫 방문 깔때기). 그리는 것 0 */}
      {!hub.unavailable && <MeasureSituationCards section={hub.section} />}
      {parts.map(({ key, tone }) => {
        switch (key) {
          case "head":
            return (
              <SiteSection key={key} id="hub-head" tone={tone} first data={{ "data-hub-part": "head" }}>
                {hub.section === "tax" ? (
                  <FieldHubHead field="tax" eyebrow={hub.eyebrow} title={hub.name} intro={hub.intro} tabs={{ items: hub.tabs, current: hub.currentTab, label: "하위 분야" }} />
                ) : (
                  // 이 분야의 지방세 포인트 (CORE-02) — 세무 감수 서명이 있는 분야만 데이터에 있다. 없으면 블록째 없다
                  <FieldHubHead
                    field={hub.section}
                    eyebrow={hub.eyebrow}
                    title={hub.name}
                    intro={hub.intro}
                    taxPoint={hub.taxPoint ?? undefined}
                    tabs={{ items: hub.tabs, current: hub.currentTab, label: hub.section === "local" ? "분야" : "하위 분야" }}
                  />
                )}
                {hub.unavailable && <UnavailableNotice />}
              </SiteSection>
            );
          case "regions":
            // 시·도 카드 (W4 9단계 — 5장 /local 줄). 지역 허브(region_hubs)가 닫혀 있으면 링크 없이 이름만 (404 링크 0)
            return (
              <SiteSection key={key} id="hub-regions" tone={tone} heading={HUB_HEADINGS.regions} data={{ "data-hub-part": "regions" }}>
                <ul data-part="sido-cards" className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {(hub.local?.sido ?? []).map((r) => (
                    <li key={r.code} data-sido-code={r.code} data-pilot={r.pilot ? "true" : "false"} data-indexed={r.indexed ? "true" : "false"}>
                      {r.href ? (
                        <UiLink
                          href={r.href}
                          className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-navy-100 bg-white px-4 py-3 text-[16px] font-bold text-navy-900 transition hover:border-hermes-400 hover:bg-hermes-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500"
                        >
                          <span data-part="sido-name">{r.name}</span>
                          <SidoChips card={r} />
                        </UiLink>
                      ) : (
                        <span className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-navy-100 bg-white px-4 py-3 text-[16px] font-bold text-navy-700">
                          <span data-part="sido-name">{r.name}</span>
                          <SidoChips card={r} />
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </SiteSection>
            );
          case "chips":
            return hub.estate && (
              <SiteSection key={key} id="hub-chips" tone={tone} heading={HUB_HEADINGS.chips} data={{ "data-hub-part": "chips" }}>
                <RealEstateChips chips={hub.estate.chips} />
              </SiteSection>
            );
          case "landmarks":
            return hub.estate && (
              <SiteSection key={key} id="hub-landmarks" tone={tone} heading={HUB_HEADINGS.landmarks} data={{ "data-hub-part": "landmarks" }}>
                <ul data-part="hub-landmarks" className="mt-8 grid gap-4 sm:grid-cols-2">
                  {hub.estate.projects.cards.map((c) => (
                    <li key={c.id} className="flex">
                      <ProjectCardView card={c} />
                    </li>
                  ))}
                </ul>
                {hub.estate.projects.all && (
                  <p className="mt-6">
                    <UiLink href={hub.estate.projects.all} className={TEXT_LINK}>
                      프로젝트 전체 보기
                    </UiLink>
                  </p>
                )}
              </SiteSection>
            );
          case "supply":
            return hub.estate && (
              <SiteSection key={key} id="hub-supply" tone={tone} heading={HUB_HEADINGS.supply} data={{ "data-hub-part": "supply" }}>
                <p className="mt-4 text-[15px] text-navy-600">{SUPPLY_COPY.groupNote}</p>
                <ul data-part="hub-supply" className="mt-6 grid gap-4 sm:grid-cols-2">
                  {hub.estate.supply.cards.map((c) => (
                    <li key={c.id} className="flex">
                      <SupplyCardView card={c} />
                    </li>
                  ))}
                </ul>
                {hub.estate.supply.all && (
                  <p className="mt-6">
                    <UiLink href={hub.estate.supply.all} className={TEXT_LINK}>
                      분양 정보 전체 보기
                    </UiLink>
                  </p>
                )}
              </SiteSection>
            );
          case "links":
            return hub.estate && (
              <SiteSection key={key} id="hub-links" tone={tone} heading={HUB_HEADINGS.links} data={{ "data-hub-part": "links" }}>
                <RealEstateLinkCards cards={hub.estate.links} />
              </SiteSection>
            );
          case "columns":
            return hub.estate && (
              <SiteSection key={key} id="hub-columns" tone={tone} heading={HUB_HEADINGS.columns} data={{ "data-hub-part": "columns" }}>
                <ArticleGrid part="hub-columns" items={hub.estate.columns.items} />
                {hub.estate.columns.all && (
                  <p className="mt-6">
                    <UiLink href={hub.estate.columns.all} className={TEXT_LINK}>
                      칼럼 전체 보기
                    </UiLink>
                  </p>
                )}
              </SiteSection>
            );
          case "blocks":
            // 지자체 허브 블록 (LG-08 순서 고정 — 데이터가 있는 블록만). 블록마다 제목이 있다
            return (
              <SiteSection key={key} id="hub-blocks" tone={tone} data={{ "data-hub-part": "blocks" }}>
                <LocalHubBlocks
                  localTax={blockContent(hub.blocks?.localTax ?? [])}
                  realEstate={blockContent(hub.blocks?.realEstate ?? [])}
                  sources={officialContent(hub.blocks?.official ?? null)}
                />
              </SiteSection>
            );
          case "latest":
            return (
              <SiteSection key={key} id="hub-latest" tone={tone} heading={HUB_HEADINGS.latest} data={{ "data-hub-part": "latest" }}>
                {hub.latest.length > 0 ? (
                  <ArticleGrid part="hub-latest" items={hub.latest} />
                ) : (
                  // 고른 편집 분야에 기사가 0건 — 상위 허브 안내 (이 주소는 noindex)
                  <div data-part="empty-guide" className="mt-8 space-y-2">
                    <p className="text-[17px] text-navy-700">이 분야에는 아직 기사가 없습니다.</p>
                    <UiLink href={hub.href} className={TEXT_LINK}>
                      {`${hub.name} 전체 보기`}
                    </UiLink>
                  </div>
                )}
              </SiteSection>
            );
          case "hot":
            return (
              hub.hot && (
                <SiteSection key={key} id="hub-hot" tone={tone} heading={HUB_HEADINGS.hot} data={{ "data-hub-part": "hot" }}>
                  <HotBlock hot={hub.hot} moreLink />
                </SiteSection>
              )
            );
          case "situations":
            return (
              <SiteSection key={key} id="hub-situations" tone={tone} heading={HUB_HEADINGS.situations} data={{ "data-hub-part": "situations" }}>
                <ul data-part="hub-situations" className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {hub.situations.map((s) => (
                    <li key={s.slug} data-situation-slug={s.slug}>
                      <SituationCard href={s.href} pictogram={s.pictogram} title={s.title} description={s.subtitle} />
                    </li>
                  ))}
                </ul>
              </SiteSection>
            );
          case "source":
            // 데이터 출처 줄 (REG-10 — 전국 지자체 허브도)
            return (
              hub.local && (
                <SiteSection key={key} id="hub-source" tone={tone} data={{ "data-hub-part": "source" }}>
                  <RegionSourceLineView line={hub.local.source} />
                </SiteSection>
              )
            );
          case "terms":
            // 용어 칩 — 글자와 쉬운 풀이. 용어사전(기능 키 glossary — W2-d 3단계)이 열렸으면 칩이 그 용어 쪽 링크
            return (
              <SiteSection key={key} id="hub-terms" tone={tone} heading={HUB_HEADINGS.terms} data={{ "data-hub-part": "terms" }}>
                <TermChipList terms={hub.terms} part="hub-terms" className="mt-8 grid gap-3 sm:grid-cols-2" />
              </SiteSection>
            );
        }
      })}
    </div>
  );
}
