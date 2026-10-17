import type { ReactNode } from "react";
import { Chip, Eyebrow, FieldCards, Hero, HomeSearch, ProgressStageBadge, UiLink, brand, cx } from "@ltr/ui";
import type { AmendmentsSection, HomeData, HomeSection, StoryCard, TrackerCard } from "@/lib/server/public";
import { HERO_EYEBROW, HERO_HIGHLIGHT, SEARCH_LABEL, SEARCH_PLACEHOLDER, SECTION_HEADINGS, sectionTones, type SectionTone } from "@/lib/site/home-view";
import { ArticleItem } from "./ArticleItem";
import { UnavailableNotice } from "./Unavailable";

// 홈 섹션 (HOME-01 · HOME-03 · HOME-04 · PRD-01A 3장 홈 골격) — 홈 데이터(getHomeData)가 정한 순서·섹션만 그린다 (내용 0건 섹션은 데이터에 없다).
// 섹션마다 data-home-section=<키> — E2E가 DOM 순서·화면 위치를 PRD_최종 §4.1 순서와 대조한다.

function CardGrid({ part, children }: { part: string; children: ReactNode }) {
  return (
    <ul data-part={part} className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {children}
    </ul>
  );
}

/** 섹션 틀 — 세로 여백 80px(R7), 바탕은 보이는 순서대로 ivory와 ivory-dark를 번갈아, 경계에 navy-100 선 (PRD-00 8.5) */
function HomeBlock({ sectionKey, tone, children }: { sectionKey: Exclude<HomeSection["key"], "hero">; tone: SectionTone; children: ReactNode }) {
  const heading = SECTION_HEADINGS[sectionKey];
  const titleId = `home-${sectionKey}-title`;
  return (
    <section data-home-section={sectionKey} aria-labelledby={titleId} className={cx("border-t border-navy-100", tone === "ivory" ? "bg-ivory" : "bg-ivory-dark")}>
      <div className="mx-auto max-w-5xl px-4 py-20">
        <Eyebrow>{heading.eyebrow}</Eyebrow>
        <h2 id={titleId} className="mt-3 text-[28px] leading-tight font-black tracking-tight text-navy-900 sm:text-[32px]">
          {heading.title}
        </h2>
        {children}
      </div>
    </section>
  );
}

/** 개정 트래커 카드 — 진행 단계 배지(현재 단계·원문 링크)와 확정 전이면 '확정 아님' 칩 하나 (HOME-03 · TX-07·08). 트래커 페이지 공개 전에는 제목만 */
function TrackerItem({ card, today }: { card: TrackerCard; today: string }) {
  return (
    <article data-part="tracker-card" data-tracker-id={card.id} data-stage={card.stage.current ?? "none"} className="rounded-2xl border border-navy-100 bg-white p-6">
      {card.lawNames.length > 0 && (
        <ul aria-label="관련 법령" className="flex flex-wrap gap-2">
          {card.lawNames.map((name) => (
            <li key={name}>
              <Chip>{name}</Chip>
            </li>
          ))}
        </ul>
      )}
      <h3 className="mt-3 text-[19px] leading-snug font-black text-navy-900">
        {card.href ? (
          <UiLink href={card.href} className="inline-flex min-h-11 items-center underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500">
            {card.title}
          </UiLink>
        ) : (
          card.title
        )}
      </h3>
      <div className="mt-4">
        <ProgressStageBadge events={card.stage.events} today={today} confirmStage={card.stage.confirmStage} />
      </div>
    </article>
  );
}

function AmendmentsBody({ section, today }: { section: AmendmentsSection; today: string }) {
  return (
    <>
      <ul data-part="trackers" className="mt-8 grid gap-4">
        {section.trackers.map((t) => (
          <li key={t.id}>
            <TrackerItem card={t} today={today} />
          </li>
        ))}
      </ul>
      {section.stories.length > 0 && (
        <>
          <h3 className="mt-12 text-[22px] leading-snug font-black text-navy-900">해설 스토리</h3>
          <CardGrid part="stories">
            {section.stories.map((s: StoryCard) => (
              <li key={s.id} data-story-id={s.id} className="flex">
                <ArticleItem item={s} />
              </li>
            ))}
          </CardGrid>
        </>
      )}
    </>
  );
}

/** 섹션 안 내용 — 아직 화면이 없는 섹션은 null (섹션째 그리지 않는다 — 빈 섹션 0) */
function sectionBody(section: Exclude<HomeSection, { key: "hero" }>, today: string): ReactNode | null {
  switch (section.key) {
    case "fields":
      // 분야마다 '이 분야의 지방세 포인트' 한 줄은 01B W3(CORE-02)이 채운다
      return (
        <div className="mt-8">
          <FieldCards />
        </div>
      );
    case "latest_reports":
      return (
        <CardGrid part="latest-reports">
          {section.items.map((a) => (
            <li key={a.id} data-article-id={a.id} className="flex">
              <ArticleItem item={a} />
            </li>
          ))}
        </CardGrid>
      );
    case "amendments":
      return <AmendmentsBody section={section} today={today} />;
    // 금주 핫뉴스(01B W6)·김의효 칼럼·자사 상품·전문가 소개(01C)는 그 작업이 데이터와 화면을 함께 만든다 — 지금 홈 데이터에는 늘 없다
    case "weekly_hot":
    case "column":
    case "product":
    case "experts":
      return null;
  }
}

export function HomeSections({ home }: { home: HomeData }) {
  const hero = home.sections.find((s): s is Extract<HomeSection, { key: "hero" }> => s.key === "hero");
  const blocks = home.sections.flatMap((s) => {
    if (s.key === "hero") return [];
    const body = sectionBody(s, home.today);
    return body === null ? [] : [{ key: s.key, body }];
  });
  const tones = new Map(sectionTones(blocks.map((b) => b.key)).map((t) => [t.key, t.tone]));
  return (
    <>
      {/* 페이지 제목 — 핵심 메시지(히어로 제목)가 없을 때만 화면 읽기용으로 둔다 */}
      {!hero?.coreMessage && <h1 className="sr-only">{brand.productName}</h1>}
      {/* 공개 데이터를 읽지 못한 닫힌 홈 — 무엇이 빠졌는지 쉬운 말로 한 줄 (원인은 서버 로그에만) */}
      {home.unavailable && <UnavailableNotice className="mx-auto max-w-5xl px-4 pt-10" />}
      {hero && (
        <div data-home-section="hero">
          <Hero eyebrow={HERO_EYEBROW} title={hero.coreMessage ?? undefined} highlight={HERO_HIGHLIGHT}>
            {hero.search && <HomeSearch label={SEARCH_LABEL} placeholder={SEARCH_PLACEHOLDER} suggestions={hero.search.chips} />}
          </Hero>
        </div>
      )}
      {blocks.map((b) => (
        <HomeBlock key={b.key} sectionKey={b.key} tone={tones.get(b.key) ?? "ivory"}>
          {b.body}
        </HomeBlock>
      ))}
    </>
  );
}
