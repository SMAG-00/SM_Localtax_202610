import { cx } from "../base";
import { MONO } from "./shared";
import type { IsoDate } from "./dates";
import type { LocalEventStatus } from "./events";

/** 의미 색 짝 (PRD-00 8.3 대비표·8.6) — 색에 더해 글자로 뜻을 전한다 (8.9) */
const TONE: Record<LocalEventStatus, string> = {
  예정: "bg-navy-50 text-navy-700",
  진행: "bg-emerald-50 text-emerald-800",
  종료: "bg-ivory-dark text-navy-800",
  취소: "bg-rose-50 text-rose-800",
  "변경 확인 중": "bg-amber-50 text-amber-800",
};

/** 행사 상태 배지 — 글자 배지 5종 + 상태 확인일(고정폭) (LG-12) */
export function EventStatusBadge({ status, checkedAt }: { status: LocalEventStatus; checkedAt?: IsoDate }) {
  const tone = TONE[status];
  if (!tone) return null;
  return (
    <span data-ui="event-status-badge" data-status={status} className="inline-flex flex-wrap items-center gap-2">
      <span className="sr-only">행사 상태 </span>
      <span data-status-label className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-bold", tone)}>
        {status}
      </span>
      {checkedAt && <span className={cx(MONO, "text-navy-600")}>상태 확인 {checkedAt}</span>}
    </span>
  );
}
