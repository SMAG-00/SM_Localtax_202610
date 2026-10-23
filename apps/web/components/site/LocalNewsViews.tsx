import { breadcrumbList, toJsonLdScriptContent } from "@ltr/structured-data";
import { UiLink, type HubBlockContent } from "@ltr/ui";
import type { EventDetailView, EventListView, WeeklyPageView } from "@/lib/server/public/local-news";
import {
  buildCalendar,
  eventJsonLdScript,
  LICENSE_LABELS,
  RECHECK_NOTICE,
  type EventCard,
  type EventsBlockView,
  type WeeklyBlockView,
} from "@/lib/server/public/local-news-logic";
import { siteUrl } from "@/lib/server/env";
import { SiteSection, TEXT_LINK } from "./SiteSection";

// 지자체뉴스 W6 공개 화면 조각 (LG-01 · LG-08 · LG-09 · LG-10 · LG-12 · LG-14 · LG-16 · REG-04). 규칙은 lib/server/public/local-news-logic.ts.
// 행사는 기사가 아니다 - 기사 유형 배지 대신 '행사안내' 표시, 카드마다 [공식 안내 (새 창)](새 창)·상태 배지(글자)·정보 확인일(고정폭). 수익률·가입·예약 요소 0.

const MONO = "font-mono text-[13px] tracking-wide";
const CHIP = "inline-flex items-center rounded-full border border-navy-200 px-2.5 py-0.5 text-[13px] font-bold text-navy-800";
const CHIP_STRONG = "inline-flex items-center rounded-full bg-navy-900 px-2.5 py-0.5 text-[13px] font-bold text-white";

/** 새 창 원문·공식 안내 링크 */
function External({ href, children, part }: { href: string; children: string; part: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" data-part={part} className={`${TEXT_LINK} inline-flex min-h-11 items-center`}>
      {children}
    </a>
  );
}

/** 행사 카드 - 목록·허브 블록 공용. 상태 배지는 색이 아니라 글자로 뜻을 전한다 (PRD-00 8.9) */
export function EventCardView({ card }: { card: EventCard }) {
  return (
    <article data-event-card="true" data-event-id={card.id} data-event-slug={card.slug} data-event-status={card.statusLabel} data-event-category={card.category} className="flex h-full flex-col rounded-2xl border border-navy-100 bg-white p-5">
      <p className="flex flex-wrap items-center gap-2">
        <span data-part="event-kind" className={CHIP}>
          행사안내
        </span>
        <span data-part="event-status" className={CHIP_STRONG}>
          {card.statusLabel}
        </span>
        {card.sponsored && (
          <span data-part="sponsored" className={CHIP}>
            광고
          </span>
        )}
        <span className={CHIP}>{card.categoryLabel}</span>
      </p>
      <h3 className="mt-3 text-[19px] font-black text-navy-900">
        <UiLink href={card.href} className={TEXT_LINK}>
          {card.title}
        </UiLink>
      </h3>
      <p className={`mt-2 ${MONO} text-navy-700`} data-part="event-period">
        {card.period}
      </p>
      <p className="mt-1 text-[15px] text-navy-700">
        {card.venue} · {card.organizer}
      </p>
      <p className={`mt-2 ${MONO} text-navy-600`} data-part="event-confirmed">
        정보 확인일 {card.confirmedOn}
      </p>
      {card.recheckDue && (
        <p data-part="recheck" className="mt-1 text-[14px] font-bold text-navy-900">
          {RECHECK_NOTICE}
        </p>
      )}
      <p className="mt-auto pt-3">
        <External href={card.officialUrl} part="official-link">
          공식 안내 (새 창)
        </External>
      </p>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────
// 허브 블록 내용 (RegionView가 @ltr/ui LocalHubBlocks에 넘긴다)
// ─────────────────────────────────────────────────────────────
export function weeklyBlockContent(block: WeeklyBlockView): HubBlockContent {
  return {
    meta: block.meta,
    items: block.items.map((i) => (
      <article key={i.id} data-weekly-item={i.id} className="flex h-full flex-col rounded-2xl border border-navy-100 bg-white p-5">
        <p className={CHIP + " self-start"}>금주 핫뉴스</p>
        <h3 className="mt-3 text-[17px] font-black text-navy-900">
          <UiLink href={i.href} className={TEXT_LINK}>
            {i.title}
          </UiLink>
        </h3>
        <p className={`mt-2 ${MONO} text-navy-600`}>
          {i.pressOrg} · {i.announcedOn}
        </p>
      </article>
    )),
    more: { href: block.href, label: "이 주의 핫뉴스 전체 보기" },
    ...(block.fallbackNotice ? { fallbackNotice: block.fallbackNotice } : {}),
    ...(block.items.length === 0 ? { empty: "이 주의 항목은 주간 페이지에서 볼 수 있습니다." } : {}),
  };
}

export function eventsBlockContent(block: EventsBlockView): HubBlockContent {
  return {
    items: block.items.map((c) => <EventCardView key={c.id} card={c} />),
    more: block.more,
  };
}

// ─────────────────────────────────────────────────────────────
// 행사 목록·달력 /local/events (LG-09 · REG-04)
// ─────────────────────────────────────────────────────────────
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function listHref(regionSlugParam: string | null, month: string | null) {
  const q = new URLSearchParams();
  if (regionSlugParam) q.set("region", regionSlugParam);
  if (month) q.set("month", month);
  const s = q.toString();
  return s ? `/local/events?${s}` : "/local/events";
}

export function EventsListView({ view }: { view: EventListView }) {
  const site = siteUrl();
  const jsonLd = site ? toJsonLdScriptContent([breadcrumbList({ items: [{ name: "홈", url: `${site}/` }, { name: "지자체뉴스", url: `${site}/local` }, { name: "행사안내", url: `${site}/local/events` }] })]) : null;
  const regionParam = view.regionCode;
  return (
    <div data-ui="events-page" data-events-count={view.cards.length}>
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />}
      <SiteSection id="events-head" tone="ivory" first data={{ "data-events-part": "head" }}>
        <p className="text-[14px] font-bold text-navy-600">
          <UiLink href="/" className={TEXT_LINK}>
            홈
          </UiLink>{" "}
          &gt;{" "}
          <UiLink href="/local" className={TEXT_LINK}>
            지자체뉴스
          </UiLink>{" "}
          &gt; 행사안내
        </p>
        <h1 className="mt-3 text-[32px] font-black tracking-tight text-navy-900">행사안내</h1>
        <p className="mt-3 text-[16px] text-navy-700">세무·재정 설명회와 개발·정비 주민설명회 같은 행사를 정보 목록으로 모았습니다. 기사가 아니며, 일정은 반드시 공식 안내에서 다시 확인하세요.</p>
        <nav aria-label="지역 필터" className="mt-6 flex flex-wrap gap-2" data-part="region-filter">
          <UiLink href={listHref(null, view.month)} className={!view.regionCode ? CHIP_STRONG : CHIP} aria-current={!view.regionCode ? "true" : undefined}>
            전국
          </UiLink>
          {view.sidos.map((s) => (
            <UiLink key={s.code} href={listHref(s.code, view.month)} className={view.regionCode === s.code ? CHIP_STRONG : CHIP} aria-current={view.regionCode === s.code ? "true" : undefined}>
              {s.name}
            </UiLink>
          ))}
        </nav>
        {view.badRegion && <p className="mt-4 text-[15px] text-navy-700">알 수 없는 지역이라 보이는 행사가 없습니다. 위에서 지역을 고르세요.</p>}
        {view.regionName && <p className="mt-4 text-[15px] text-navy-700">{view.regionName}과 그 아래 시·군·구의 행사를 보입니다.</p>}
      </SiteSection>
      {view.months.map((m, idx) => {
        const cal = buildCalendar(m.month, m.cards);
        return (
          <SiteSection key={m.month} id={`events-${m.month}`} tone={idx % 2 === 0 ? "ivory-dark" : "ivory"} heading={{ eyebrow: "CALENDAR", title: `${m.month.replace("-", "년 ")}월` }} data={{ "data-events-part": "month", "data-month": m.month }}>
            <p className={`mt-2 ${MONO} text-navy-600`} data-part="month-count">
              {m.cards.length}건
            </p>
            <div className="mt-6 overflow-x-auto">
              <table data-part="calendar" data-month={m.month} className="w-full min-w-[640px] table-fixed border-collapse">
                <caption className="sr-only">{m.month} 행사 달력. 같은 내용이 아래 목록에 있습니다.</caption>
                <thead>
                  <tr>
                    {WEEKDAYS.map((w) => (
                      <th key={w} scope="col" className="border border-navy-100 bg-white px-2 py-1 text-[13px] font-bold text-navy-700">
                        {w}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cal.weeks.map((week, wi) => (
                    <tr key={wi}>
                      {week.map((cell, ci) => (
                        <td key={ci} data-cal-date={cell?.date} className="h-20 border border-navy-100 bg-white p-1 align-top">
                          {cell && (
                            <>
                              <span className={`${MONO} text-navy-600`}>{cell.day}</span>
                              <ul>
                                {cell.events.map((e) => (
                                  <li key={e.id} data-cal-event={e.id} className="mt-0.5 truncate text-[12px]">
                                    <UiLink href={e.href} className={TEXT_LINK}>
                                      {e.title}
                                    </UiLink>
                                  </li>
                                ))}
                              </ul>
                            </>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3 className="mt-10 text-[19px] font-black text-navy-900">{m.month} 목록</h3>
            {m.cards.length === 0 ? (
              <p data-part="events-empty" className="mt-4 text-[16px] text-navy-700">
                현재 확인된 일정 없음
              </p>
            ) : (
              <ul data-part="event-list" data-month={m.month} className="mt-4 grid gap-4 sm:grid-cols-2">
                {m.cards.map((c) => (
                  <li key={c.id}>
                    <EventCardView card={c} />
                  </li>
                ))}
              </ul>
            )}
          </SiteSection>
        );
      })}
      {view.archive.length > 0 && (
        <SiteSection id="events-archive" tone="ivory" heading={{ eyebrow: "ARCHIVE", title: "지난 행사" }} data={{ "data-events-part": "archive" }}>
          <ul data-part="archive-list" className="mt-6 grid gap-4 sm:grid-cols-2">
            {view.archive.map((c) => (
              <li key={c.id}>
                <EventCardView card={c} />
              </li>
            ))}
          </ul>
        </SiteSection>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 행사 상세 /local/events/[slug] (LG-09 · LG-12 · LG-14 · LG-16)
// ─────────────────────────────────────────────────────────────
export function EventDetailPage({ view }: { view: EventDetailView }) {
  const { card, row } = view;
  const ld = eventJsonLdScript(card, row.starts_at, row.ends_at, siteUrl());
  return (
    <div data-ui="event-detail" data-event-status={card.statusLabel}>
      {ld && <script type="application/ld+json" data-part="event-jsonld" dangerouslySetInnerHTML={{ __html: ld }} />}
      <SiteSection id="event-head" tone="ivory" first data={{ "data-event-part": "head" }}>
        <p className="flex flex-wrap items-center gap-2">
          <span data-part="event-kind" className={CHIP}>
            행사안내
          </span>
          <span data-part="event-status" className={CHIP_STRONG}>
            {card.statusLabel}
          </span>
          {card.sponsored && (
            <span data-part="sponsored" className={CHIP}>
              광고
            </span>
          )}
          <span className={CHIP}>{card.categoryLabel}</span>
        </p>
        <h1 className="mt-4 text-[32px] font-black tracking-tight text-navy-900">{card.title}</h1>
        <dl className="mt-6 grid gap-3 text-[16px] text-navy-800 sm:grid-cols-[8rem_1fr]">
          <dt className="font-bold">일시</dt>
          <dd className={MONO} data-part="event-period">
            {card.period}
          </dd>
          <dt className="font-bold">장소</dt>
          <dd data-part="event-venue">{card.venue}</dd>
          <dt className="font-bold">지역</dt>
          <dd>{view.regionName ?? "-"}</dd>
          <dt className="font-bold">주최</dt>
          <dd data-part="event-organizer">{card.organizer}</dd>
          <dt className="font-bold">출처</dt>
          <dd>{row.source_name}</dd>
          <dt className="font-bold">정보 확인일</dt>
          <dd className={MONO} data-part="event-confirmed">
            {card.confirmedOn}
          </dd>
        </dl>
        {card.status === "changing" && (
          <p data-part="changing-notice" className="mt-6 text-[16px] font-bold text-navy-900">
            일정 변경 여부를 확인하고 있습니다. 위 일정은 확정이 아닙니다 - 공식 안내를 확인하세요.
          </p>
        )}
        {card.status === "cancelled" && (
          <p data-part="cancelled-notice" className="mt-6 text-[16px] font-bold text-navy-900">
            이 행사는 취소되었습니다.
            {view.statusConfirmedOn ? ` (확인일 ${view.statusConfirmedOn})` : ""}
            {view.statusSourceUrl && (
              <>
                {" "}
                <External href={view.statusSourceUrl} part="status-source">
                  취소 근거 (새 창)
                </External>
              </>
            )}
          </p>
        )}
        {card.recheckDue && (
          <p data-part="recheck" className="mt-4 text-[15px] font-bold text-navy-900">
            {RECHECK_NOTICE}
          </p>
        )}
        <p className="mt-6">
          <External href={card.officialUrl} part="official-link">
            공식 안내 (새 창)
          </External>
        </p>
        {view.links.length > 0 && (
          <section aria-labelledby="event-links-title" className="mt-10" data-part="event-links">
            <h2 id="event-links-title" className="text-[19px] font-black text-navy-900">
              관련 항목
            </h2>
            <ul className="mt-3 space-y-2">
              {view.links.map((l) => (
                <li key={l.id} data-event-link={l.kind}>
                  <UiLink href={l.href} className={TEXT_LINK}>
                    {l.label}
                  </UiLink>
                  <span className="ml-2 text-[14px] text-navy-600">{l.reason}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="mt-10">
          <UiLink href="/local/events" className={TEXT_LINK}>
            행사 목록·달력으로
          </UiLink>
        </p>
      </SiteSection>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 주간 페이지 /local/[sido]/weekly/[yyyy-ww] (LG-01 · LG-02)
// ─────────────────────────────────────────────────────────────
export function WeeklyPage({ view }: { view: WeeklyPageView }) {
  const site = siteUrl();
  const jsonLd = site
    ? toJsonLdScriptContent([
        breadcrumbList({
          items: [
            { name: "홈", url: `${site}/` },
            { name: "지자체뉴스", url: `${site}/local` },
            { name: view.sidoName, url: `${site}/local/${view.sidoSlug}` },
            { name: `금주 핫뉴스 ${view.weekKey}`, url: `${site}/local/${view.sidoSlug}/weekly/${view.weekKey}` },
          ],
        }),
      ])
    : null;
  return (
    <div data-ui="weekly-page" data-week-key={view.weekKey} data-item-count={view.items.length}>
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />}
      <SiteSection id="weekly-head" tone="ivory" first data={{ "data-weekly-part": "head" }}>
        <p className="text-[14px] font-bold text-navy-600">
          <UiLink href={`/local/${view.sidoSlug}`} className={TEXT_LINK}>
            {view.sidoName}
          </UiLink>{" "}
          &gt; 금주 핫뉴스
        </p>
        <p className="mt-3">
          <span data-part="digest-badge" className={CHIP}>
            금주 핫뉴스
          </span>
        </p>
        <h1 className="mt-3 text-[32px] font-black tracking-tight text-navy-900">{view.sidoName} 금주 핫뉴스</h1>
        <p className={`mt-2 ${MONO} text-navy-600`} data-part="weekly-meta">
          {view.meta}
        </p>
        <p className="mt-4 text-[15px] text-navy-700">편집자가 고른 지자체 발표를 짧게 정리했습니다. 원문은 발표기관에 있으니 [원문 보기]에서 확인하세요.</p>
      </SiteSection>
      <SiteSection id="weekly-items" tone="ivory-dark" data={{ "data-weekly-part": "items" }}>
        <ul className="space-y-6">
          {view.items.map((i) => (
            <li key={i.id}>
              <article data-weekly-item={i.id} className="rounded-2xl border border-navy-100 bg-white p-6">
                <h2 className="text-[20px] font-black text-navy-900">{i.title}</h2>
                <p className={`mt-2 ${MONO} text-navy-600`} data-part="weekly-source">
                  {i.press_org} · {i.announced_on}
                </p>
                <p className="mt-3 text-[16px] text-navy-800" data-part="weekly-summary">
                  {i.summary}
                </p>
                <p className="mt-3 flex flex-wrap items-center gap-3">
                  <External href={i.source_url} part="source-link">
                    원문 보기 (새 창)
                  </External>
                  <span className="text-[13px] text-navy-600">{LICENSE_LABELS[i.license_type] ?? LICENSE_LABELS.unknown}</span>
                </p>
              </article>
            </li>
          ))}
        </ul>
        {view.otherWeeks.length > 0 && (
          <nav aria-label="다른 주" className="mt-10" data-part="weekly-archive">
            <h2 className="text-[19px] font-black text-navy-900">지난 핫뉴스</h2>
            <ul className="mt-3 flex flex-wrap gap-3">
              {view.otherWeeks.map((w) => (
                <li key={w}>
                  <UiLink href={`/local/${view.sidoSlug}/weekly/${w}`} className={TEXT_LINK}>
                    {w}
                  </UiLink>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </SiteSection>
    </div>
  );
}
