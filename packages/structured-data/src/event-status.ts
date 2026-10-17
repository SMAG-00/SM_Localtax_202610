/**
 * 행사 화면 상태 → schema.org `eventStatus` (LG-12 · LG-16 · REG1-04).
 * 화면 배지와 JSON-LD가 같은 칸(EventView.status) 하나에서 나오므로 한쪽만 바뀔 수 없다.
 *
 * - 예정 · 진행 · 종료 → EventScheduled. schema.org 정의가 "예정대로 열리고 있거나 열렸다"이고,
 *   진행 중·끝남을 뜻하는 별도 값은 없다. 끝난 회차도 상세 URL은 200으로 남는다 (REG-04).
 * - 취소 → EventCancelled. 원래 시작·종료 일시는 그대로 둔다.
 * - 변경 확인 중 → null = Event를 내지 않는다. LG-16 "확정되지 않은 일정을 확정처럼 보이지 않게
 *   `Event` 데이터를 내지 않는다". EventRescheduled·EventPostponed는 확정된 새 일정을 전제하므로 쓰지 않는다.
 */
import type { EventScreenStatus } from "./models";

export const EVENT_STATUS_URL = {
  scheduled: "https://schema.org/EventScheduled",
  cancelled: "https://schema.org/EventCancelled",
  postponed: "https://schema.org/EventPostponed",
  rescheduled: "https://schema.org/EventRescheduled",
  movedOnline: "https://schema.org/EventMovedOnline",
} as const;

/** schema.org EventStatusType의 값 전부 (검사기가 쓴다) */
export const SCHEMA_EVENT_STATUSES: readonly string[] = Object.values(EVENT_STATUS_URL);

export const EVENT_STATUS_MAP: Readonly<Record<EventScreenStatus, string | null>> = {
  예정: EVENT_STATUS_URL.scheduled,
  진행: EVENT_STATUS_URL.scheduled,
  종료: EVENT_STATUS_URL.scheduled,
  취소: EVENT_STATUS_URL.cancelled,
  "변경 확인 중": null,
};
