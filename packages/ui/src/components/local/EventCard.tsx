import { Chip, cx } from "../base";
import { CARD, ExternalLink, Field } from "./shared";
import type { IsoDate } from "./dates";
import { computeEventStatus, isPublishableEvent, needsRecheck, type LocalEvent } from "./events";
import { EventStatusBadge } from "./EventStatusBadge";

export type EventCardProps = {
  event: LocalEvent;
  /** 오늘(KST 날짜) — 상태·재확인 계산 기준 */
  today: IsoDate;
  /** 확인 후 재확인까지의 운영 기준 일수 (settings, REG1-05) */
  recheckAfterDays: number;
};

/** 광고 표기 — 목록·상세·공유 미리보기의 같은 자리(표시 줄 맨 앞) (LG-13) */
function AdLabel() {
  return <span className="inline-flex items-center rounded-md border border-navy-200 bg-white px-2 py-0.5 text-[12px] font-bold text-navy-700">광고</span>;
}

/** 행사 카드 — 필수 필드가 빠진 회차는 렌더하지 않는다 (LG-11) */
export function EventCard({ event, today, recheckAfterDays }: EventCardProps) {
  if (!isPublishableEvent(event)) return null;
  const status = computeEventStatus(event, today);
  const stale = needsRecheck(event, today, recheckAfterDays);
  const period = event.start === event.end ? event.start : `${event.start} ~ ${event.end}`;

  return (
    <article data-ui="event-card" className={cx("group", CARD)}>
      <div data-event-labels className="flex flex-wrap items-center gap-2">
        {event.sponsored && <AdLabel />}
        <Chip>{event.category}</Chip>
        {event.regionName && <Chip>{event.regionName}</Chip>}
        <EventStatusBadge status={status} checkedAt={event.checkedAt} />
        {stale && (
          <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-[13px] font-bold text-amber-800">일정 재확인 필요</span>
        )}
      </div>
      <h3 className="mt-3 text-[19px] leading-snug font-black text-navy-900">
        {event.href ? (
          <a href={event.href} className="inline-flex min-h-11 items-center hover:text-hermes-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500">
            {event.title}
          </a>
        ) : (
          event.title
        )}
      </h3>
      <dl className="mt-3 space-y-1">
        {/* 변경 확인 중에는 종전 일정을 확정 일정처럼 보이지 않는다 (REG1-04) */}
        <Field term={status === "변경 확인 중" ? "종전 안내 일정" : "기간"} mono>
          {period}
        </Field>
        <Field term="장소">{event.place}</Field>
        <Field term="주최">{event.host}</Field>
        <Field term="출처">{event.source}</Field>
      </dl>
      <p className="mt-3">
        <ExternalLink href={event.officialUrl}>공식 안내</ExternalLink>
      </p>
    </article>
  );
}
