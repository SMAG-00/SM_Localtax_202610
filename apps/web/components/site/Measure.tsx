"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { sectionOfHref, track } from "@/lib/analytics/client";
import { EngagementClock } from "@/lib/analytics/engagement";
import type { EventName } from "@/lib/analytics/events";
import { NEXT_ACTION_KEYS, isSectionKey, type SectionKey } from "@/lib/server/public/constants";
import { partnerViewedProps } from "@/lib/site/media-view";
import { createSearchMeasure } from "@/lib/site/search-measure";
import type { SearchEventProps } from "@/lib/site/search-view";

// 공개 화면 측정 연결 (docs/dev/W2-c_설계.md 6장) — 그리는 것 0(빈 요소). 보내기는 lib/analytics/client.ts track() 하나이고,
// 측정 거부 쿠키·브라우저 GPC 신호가 있으면 track()이 아무것도 보내지 않는다 (GROW-01 전송 0).
// 개발 모드(StrictMode)에서 효과를 두 번 돌려도 열람 이벤트는 한 번 — 보낸 열쇠를 ref에 둔다(ref는 다시 붙어도 남는다).

type Props = Record<string, string | number | boolean>;

/** 화면을 열 때 이벤트 1건 — 같은 이름·분야·속성이 바뀌면(지자체뉴스 분야 탭) 다시 1건 */
export function MeasureView({ name, section, props }: { name: EventName; section: SectionKey; props?: Props }) {
  const key = JSON.stringify([name, section, props ?? {}]);
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (sent.current === key) return;
    sent.current = key;
    const [n, s, p] = JSON.parse(key) as [EventName, SectionKey, Props];
    void track(n, { section: s, props: p });
  }, [key]);
  return null;
}

/** 기사 상세 — 열 때 article_viewed 1건, 화면이 보인 시간이 30초에 닿으면 article_engaged 1건 (탭이 숨으면 멈춘다) */
export function MeasureArticle({ articleId, section, format, contentType }: { articleId: number; section: SectionKey; format: string; contentType: string }) {
  const viewed = useRef<number | null>(null);
  useEffect(() => {
    const props = { article_id: articleId, format, content_type: contentType };
    if (viewed.current !== articleId) {
      viewed.current = articleId;
      void track("article_viewed", { section, props });
    }
    const visible = () => document.visibilityState === "visible";
    const clock = new EngagementClock(performance.now(), visible());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      const ms = clock.remaining(performance.now());
      if (ms !== null) timer = setTimeout(check, ms);
    };
    const check = () => {
      if (clock.reached(performance.now())) void track("article_engaged", { section, props });
      else schedule();
    };
    const onVisibility = () => {
      clock.setVisible(performance.now(), visible());
      schedule();
    };
    document.addEventListener("visibilitychange", onVisibility);
    schedule();
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [articleId, section, format, contentType]);
  return null;
}

/**
 * 제휴 기사를 열면 partner_content_viewed(제휴사·기사 번호) 1건 (ART-10 '제휴 기사를 열면 partner_content_viewed(제휴사) 1건').
 * 공개 제휴사가 지정된 기사만 부른다. 같은 기사를 다시 그려도(개발 모드 효과 두 번) 한 번 — 보낸 열쇠를 ref에 둔다
 */
export function MeasurePartnerContent({ partnerId, articleId, section }: { partnerId: number; articleId: number; section: SectionKey }) {
  const sent = useRef<string | null>(null);
  useEffect(() => {
    const key = `${partnerId}:${articleId}`;
    if (sent.current === key) return;
    sent.current = key;
    void track("partner_content_viewed", { section, props: partnerViewedProps(partnerId, articleId) });
  }, [partnerId, articleId, section]);
  return null;
}

/** 홈 4대 분야 카드를 누르면 home_entry_clicked(분야) — 카드 컴포넌트(@ltr/ui FieldCards)를 바꾸지 않고 누름을 듣는다 */
export function MeasureHomeEntry() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('[data-ui="field-cards"] a[href]') : null;
      const section = sectionOfHref(target?.getAttribute("href"));
      if (section) void track("home_entry_clicked", { section });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}

/** 문서에서 누른 링크가 고른 자리 안에 있으면 그 자리 요소 — 없으면 null */
function clickedIn(event: MouseEvent, itemSelector: string): Element | null {
  const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
  return link?.closest(itemSelector) ?? null;
}

/**
 * 다음 행동 띠 버튼을 누르면 next_action_clicked(버튼 종류·화면) 1건 — 첫 방문 깔때기 3단계(GROW-01, W2-c 설계 8.3).
 * 띠 컴포넌트(@ltr/ui NextActionBand)를 바꾸지 않고 문서에서 누름을 듣는다. 버튼 종류는 띠가 단 data-next-action(ART-06 버튼 키)
 */
export function MeasureNextActions({ section, screen }: { section: SectionKey | null; screen: "article" | "situation" }) {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const action = clickedIn(event, '[data-ui="next-action-band"] [data-next-action]')?.getAttribute("data-next-action");
      if (action && (NEXT_ACTION_KEYS as readonly string[]).includes(action)) void track("next_action_clicked", { section, props: { action, screen } });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [section, screen]);
  return null;
}

/** 분야 허브의 상황 카드를 누르면 situation_card_clicked(상황·위치 hub) 1건 — 첫 방문 깔때기 2단계(GROW-01). 카드 목록의 data-situation-slug */
export function MeasureSituationCards({ section }: { section: SectionKey }) {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const slug = clickedIn(event, '[data-part="hub-situations"] [data-situation-slug]')?.getAttribute("data-situation-slug");
      if (slug) void track("situation_card_clicked", { section, props: { situation: slug, position: "hub" } });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [section]);
  return null;
}

/** 상속·증여 안내의 상황 카드를 누르면 situation_card_clicked(상황·위치 inheritance_gift) 1건 (W4 23단계 · FAM-02). 카드 목록의 data-situation-slug */
export function MeasureInheritanceSituations() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const slug = clickedIn(event, '[data-part="ig-situations"] [data-situation-slug]')?.getAttribute("data-situation-slug");
      if (slug) void track("situation_card_clicked", { section: "realestate", props: { situation: slug, position: "inheritance_gift" } });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}

/**
 * 바깥 연결 카드(/calc·상황 페이지 공용 카드 OfficialLinkCard)의 이동 링크를 누르면 calculator_card_clicked 1건 (W3 10단계 · W2-c 2.2).
 * 속성은 카드 키(data-link-card — official_links.key)·화면·카드 차례(data-link-rank)뿐 — 카드 주소·이 화면의 입력값·검색어·쿼리는 읽지 않는다.
 * 카드 컴포넌트는 그리기만 하고, 누름은 문서에서 한 번 듣는다(화면마다 이 컴포넌트 하나). 대체 안내 링크(끊김 카드)는 세지 않는다
 */
export function MeasureCalculatorCards({ screen, section }: { screen: "calc" | "situation"; section: SectionKey | null }) {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('[data-link-card] a[data-part="go"]') : null;
      const item = link?.closest("[data-link-card]");
      const card = item?.getAttribute("data-link-card") ?? "";
      const rank = Number(item?.getAttribute("data-link-rank"));
      // 키 목록 검사는 수집 API(events.ts — 목록 밖 키 400)가 한다. 여기서는 모양만 보고 보낸다(브라우저 묶음에 규칙 모듈을 싣지 않는다)
      if (!/^[a-z][a-z_]{0,39}$/.test(card) || !Number.isSafeInteger(rank) || rank < 1) return;
      void track("calculator_card_clicked", { ...(section ? { section } : {}), props: { card, screen, rank } });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [screen, section]);
  return null;
}

/** 문서 하나에 하나 — 화면 전환(탭·쪽 링크)으로 같은 검색을 다시 그려도 한 번만 보낸다 (lib/site/search-measure.ts) */
const searchMeasure = createSearchMeasure();

/**
 * 검색 결과 화면을 열면 search_submitted 1건 (W2-c 2.2 · docs/dev/W2-d_설계.md 8장) — 속성은 길이·결과 수·결과 유형 수·지역 분류 여부뿐,
 * 검색어 원문은 이 컴포넌트에 오지도 않는다(서버가 센 숫자만 받는다). 같은 검색(검색어·거르개)에서 탭·쪽만 바꾸면 보내지 않는다
 */
export function MeasureSearch({ section, props }: { section: SectionKey | null; props: SearchEventProps }) {
  const key = JSON.stringify([section, props]);
  useEffect(() => {
    if (!searchMeasure.shouldSend(window.location.search)) return;
    const [s, p] = JSON.parse(key) as [SectionKey | null, SearchEventProps];
    void track("search_submitted", { section: s, props: p });
  }, [key]);
  return null;
}

/** 검색 결과 없음 화면의 상황 카드를 누르면 situation_card_clicked(상황·위치 search_empty) 1건 (UX-05 · W2-c 2.3). 분야는 카드의 data-situation-section */
export function MeasureSearchSituationCards() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const item = clickedIn(event, '[data-part="search-situations"] [data-situation-slug]');
      const slug = item?.getAttribute("data-situation-slug");
      const section = item?.getAttribute("data-situation-section");
      if (slug && isSectionKey(section)) void track("situation_card_clicked", { section, props: { situation: slug, position: "search_empty" } });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}

/** 순위 목록 누름 — 많이 본 기사(popular_article_clicked: 순위·위치)·상담 사례 HOT(hot_article_clicked: 순위·고정 여부) 1건.
 *  목록 컴포넌트(@ltr/ui PopularArticles 등)를 바꾸지 않고 감싼 요소에서 누름을 듣는다. 링크 주소로 항목을 찾는다 */
export function MeasureClicks({
  name,
  items,
  children,
}: {
  name: "popular_article_clicked" | "hot_article_clicked";
  items: ReadonlyArray<{ href: string; section: SectionKey; props: Props }>;
  children: ReactNode;
}) {
  return (
    <div
      data-measure-clicks={name}
      onClickCapture={(event) => {
        const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
        if (!link || !event.currentTarget.contains(link)) return;
        const item = items.find((i) => i.href === link.getAttribute("href"));
        if (item) void track(name, { section: item.section, props: item.props });
      }}
    >
      {children}
    </div>
  );
}

/**
 * 용어 쪽(/glossary/[번호])을 열면 glossary_opened(용어 번호) 1건 (PRD-01A 12장 '용어 수요' — W2-d 3단계).
 * 분야는 그 용어의 첫 분야(없으면 비운다 — 이 이벤트의 분야 칸은 선택). 같은 용어를 다시 그려도 한 번
 */
export function MeasureGlossaryTerm({ termId, section }: { termId: number; section: SectionKey | null }) {
  const sent = useRef<number | null>(null);
  useEffect(() => {
    if (sent.current === termId) return;
    sent.current = termId;
    void track("glossary_opened", { ...(section ? { section } : {}), props: { term_id: termId } });
  }, [termId, section]);
  return null;
}
