// 행사안내 자료 규칙 — 회차·상태 계산(REG1-04), 필수 필드(LG-11), 재확인(REG1-05). 렌더와 분리한 순수 함수
import { daysBetween, dayNumber, filled, isIsoDate, type IsoDate } from "./dates";

export type LocalEventStatus = "예정" | "진행" | "종료" | "취소" | "변경 확인 중";
export const LOCAL_EVENT_STATUSES: readonly LocalEventStatus[] = ["예정", "진행", "종료", "취소", "변경 확인 중"];

/** 축제 분류 — 지자체 허브 `행사안내` 블록에서만 보인다 (LG-10) */
export const FESTIVAL_CATEGORY = "축제";

/** 행사 회차 한 건 (`local_events` 한 행) */
export type LocalEvent = {
  id: string;
  /** 행사명 */
  title: string;
  /** 분류 — 값 목록은 settings (세무·재정 · 개발·정비 · 기타 · 축제) */
  category: string;
  /** 주최 */
  host: string;
  place: string;
  /** 행정구역 표준코드 */
  regionCode: string;
  /** 화면에 보일 지역 이름 (선택) */
  regionName?: string;
  start: IsoDate;
  end: IsoDate;
  /** 주최 기관·지자체의 공식 안내 주소 */
  officialUrl: string;
  /** 출처 */
  source: string;
  /** 상태(정보) 확인일 */
  checkedAt: IsoDate;
  /** 편집자가 공식 출처를 확인해 지정하는 상태 — 예정·진행·종료는 날짜로 계산한다 */
  editorStatus?: "취소" | "변경 확인 중";
  /** 상업 행사 — '광고' 표기 (LG-13) */
  sponsored?: boolean;
  /** 상세 주소 /local/events/[slug] */
  href?: string;
};

const REQUIRED = ["title", "category", "host", "place", "regionCode", "officialUrl", "source"] as const;

/** 필수 필드가 모두 있고 날짜가 맞는 회차만 공개 대상이다 (LG-11) */
export function isPublishableEvent(e: LocalEvent): boolean {
  if (!REQUIRED.every((k) => filled(e[k]))) return false;
  if (!isIsoDate(e.start) || !isIsoDate(e.end) || !isIsoDate(e.checkedAt)) return false;
  return dayNumber(e.end) >= dayNumber(e.start);
}

/** 오늘 기준 행사 상태 — 편집자 지정(취소·변경 확인 중)이 먼저, 아니면 날짜로 (REG1-04) */
export function computeEventStatus(e: LocalEvent, today: IsoDate): LocalEventStatus {
  if (e.editorStatus) return e.editorStatus;
  if (dayNumber(today) < dayNumber(e.start)) return "예정";
  if (dayNumber(today) > dayNumber(e.end)) return "종료";
  return "진행";
}

/** 끝난 회차 — 예정 목록에서 빠지고 `지난 행사`에 남는다 (REG-04) */
export function isPastEvent(e: LocalEvent, today: IsoDate): boolean {
  return dayNumber(today) > dayNumber(e.end);
}

/** 마지막 확인 뒤 기준 일수(settings N일)를 넘긴 예정·진행 회차 — N일째는 정상, N+1일째부터 재확인 (REG1-05) */
export function needsRecheck(e: LocalEvent, today: IsoDate, recheckAfterDays: number): boolean {
  const status = computeEventStatus(e, today);
  if (status !== "예정" && status !== "진행") return false;
  return daysBetween(e.checkedAt, today) > recheckAfterDays;
}
