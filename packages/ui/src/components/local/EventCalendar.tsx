import { useId, type ReactNode } from "react";
import { Tabs, cx } from "../base";
import { addMonths, dateIn, dayNumber, daysInMonth, firstWeekday, monthLabel, monthOf, type IsoDate, type YearMonth } from "./dates";
import { FESTIVAL_CATEGORY, computeEventStatus, isPastEvent, isPublishableEvent, type LocalEvent } from "./events";
import { EventCard } from "./EventCard";
import { EventStatusBadge } from "./EventStatusBadge";

export type EventCalendarProps = {
  events: LocalEvent[];
  /** 오늘(KST 날짜) — 이번 달·다음 달 범위와 종료 판정 기준 */
  today: IsoDate;
  /** 확인 후 재확인까지의 운영 기준 일수 (settings, REG1-05) */
  recheckAfterDays: number;
  /** events-page = /local/events (축제 0, LG-10) · region-hub = 지자체 허브 `행사안내` 블록 안 */
  scope: "events-page" | "region-hub";
  /** 지역(시·도 > 시·군·구)·분류 필터 — 주소(쿼리)로 거르는 링크를 넣는다 */
  filters?: ReactNode;
  title?: string;
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function overlapsMonth(e: LocalEvent, ym: YearMonth): boolean {
  const first = dayNumber(dateIn(ym, 1));
  const last = dayNumber(dateIn(ym, daysInMonth(ym)));
  return dayNumber(e.start) <= last && dayNumber(e.end) >= first;
}

/** 달을 넘는 행사는 그 달 안의 첫날 칸에 한 번만 둔다 — 달력 칸과 목록의 항목 수가 같다 (REG-04) */
function placementDay(e: LocalEvent, ym: YearMonth): number {
  return monthOf(e.start) === ym ? Number(e.start.slice(8, 10)) : 1;
}

function byStart(a: LocalEvent, b: LocalEvent) {
  return dayNumber(a.start) - dayNumber(b.start) || a.title.localeCompare(b.title, "ko");
}

function MonthGrid({ ym, events, today }: { ym: YearMonth; events: LocalEvent[]; today: IsoDate }) {
  const lead = firstWeekday(ym);
  const total = daysInMonth(ym);
  const cells: Array<number | null> = [...Array.from({ length: lead }, () => null), ...Array.from({ length: total }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));

  return (
    <table className="hidden w-full table-fixed border-collapse text-left sm:table">
      <caption className="sr-only">{monthLabel(ym)} 달력</caption>
      <thead>
        <tr>
          {WEEKDAYS.map((d) => (
            <th key={d} scope="col" className="border-b border-navy-100 py-2 text-center text-[13px] font-bold text-navy-600">
              {d}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week, w) => (
          <tr key={w}>
            {week.map((day, i) => {
              if (day === null) return <td key={i} className="h-24 border border-navy-100 bg-ivory" />;
              const date = dateIn(ym, day);
              const entries = events.filter((e) => placementDay(e, ym) === day);
              return (
                <td key={i} data-date={date} className={cx("h-24 border border-navy-100 p-1.5 align-top", date === today ? "bg-hermes-50" : "bg-white")}>
                  <span className="font-mono text-[13px] tracking-wide text-navy-600">{day}</span>
                  {entries.length > 0 && (
                    <ul className="mt-1 space-y-1">
                      {entries.map((e) => (
                        <li key={e.id} data-calendar-entry className="space-y-0.5">
                          <span className="line-clamp-2 block text-[13px] leading-snug font-bold text-navy-900">{e.title}</span>
                          <EventStatusBadge status={computeEventStatus(e, today)} />
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EventList({ label, events, today, recheckAfterDays, empty }: { label: string; events: LocalEvent[]; today: IsoDate; recheckAfterDays: number; empty: string }) {
  if (events.length === 0) return <p className="mt-6 text-[15px] text-navy-600">{empty}</p>;
  return (
    <ul aria-label={label} className="mt-6 grid gap-4 sm:grid-cols-2">
      {events.map((e) => (
        <li key={e.id}>
          <EventCard event={e} today={today} recheckAfterDays={recheckAfterDays} />
        </li>
      ))}
    </ul>
  );
}

/** 행사 달력 — 이번 달·다음 달 월 그리드(모바일은 목록) + 같은 내용의 목록, 지난 행사 탭 (REG-04·8.9) */
export function EventCalendar({ events, today, recheckAfterDays, scope, filters, title = "행사 달력" }: EventCalendarProps) {
  const headingId = useId();
  const shown = events.filter((e) => isPublishableEvent(e) && !(scope === "events-page" && e.category === FESTIVAL_CATEGORY));
  const upcoming = shown.filter((e) => !isPastEvent(e, today));
  const past = shown.filter((e) => isPastEvent(e, today)).sort((a, b) => dayNumber(b.end) - dayNumber(a.end));

  const thisMonth = monthOf(today);
  const month = (ym: YearMonth) => {
    const list = upcoming.filter((e) => overlapsMonth(e, ym)).sort(byStart);
    return (
      <div>
        <h3 className="text-[19px] font-black text-navy-900">{monthLabel(ym)}</h3>
        <div className="mt-4">
          <MonthGrid ym={ym} events={list} today={today} />
        </div>
        <EventList label={`${monthLabel(ym)} 행사 목록`} events={list} today={today} recheckAfterDays={recheckAfterDays} empty="현재 확인된 일정 없음" />
      </div>
    );
  };

  return (
    <section data-ui="event-calendar" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-[28px] font-black tracking-tight text-navy-900 sm:text-[32px]">
        {title}
      </h2>
      {filters && <div className="mt-4">{filters}</div>}
      <div className="mt-6">
        <Tabs
          label="행사 기간"
          items={[
            { id: "this-month", label: "이번 달", panel: month(thisMonth) },
            { id: "next-month", label: "다음 달", panel: month(addMonths(thisMonth, 1)) },
            {
              id: "past",
              label: "지난 행사",
              panel: (
                <div>
                  <h3 className="text-[19px] font-black text-navy-900">지난 행사</h3>
                  <EventList label="지난 행사 목록" events={past} today={today} recheckAfterDays={recheckAfterDays} empty="확인된 지난 행사 없음" />
                </div>
              ),
            },
          ]}
        />
      </div>
    </section>
  );
}
