import { FieldHubHead, LocalHubBlocks, SituationCard, UiLink, type HubBlockContent } from "@ltr/ui";
import type { ArticleListItem, HubData } from "@/lib/server/public";
import { HUB_HEADINGS, hubParts } from "@/lib/site/hub-view";
import { ArticleGrid, ArticleItem } from "./ArticleItem";
import { TermChipList } from "./GlossaryView";
import { HotBlock } from "./HotBlock";
import { MeasureSituationCards, MeasureView } from "./Measure";
import { SiteSection, TEXT_LINK } from "./SiteSection";
import { UnavailableNotice } from "./Unavailable";

// 4대 분야 허브 공통 골격 (CAT-02 · UX-05 · PRD-01A 3장) — 네 허브가 이 컴포넌트 하나로 그린다.
// 머리(분야 허브 머리: 아이브로·제목·소개 → 지방세 포인트 → 탭) → 분야 고유 블록 자리 → 최신 목록 → 상담 사례 HOT(지방세 허브만 — HOME-05) → 상황 카드 0~상한 → 관련 용어.
// 내용 0건인 부분은 빠지고 순서는 그대로다. 부분마다 data-hub-part — E2E가 네 허브의 골격을 비교한다.

/** 블록 한 칸 — 기사 카드. 0건이면 블록째 없다 (빈 블록 0) */
function blockContent(items: readonly ArticleListItem[]): HubBlockContent | undefined {
  return items.length ? { items: items.map((a) => <ArticleItem key={a.id} item={a} />) } : undefined;
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
          case "blocks":
            // 지자체 허브 블록 (LG-08 순서 고정 — 데이터가 있는 블록만). 블록마다 제목이 있다
            return (
              <SiteSection key={key} id="hub-blocks" tone={tone} data={{ "data-hub-part": "blocks" }}>
                <LocalHubBlocks
                  localTax={blockContent(hub.blocks?.localTax ?? [])}
                  realEstate={blockContent(hub.blocks?.realEstate ?? [])}
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
