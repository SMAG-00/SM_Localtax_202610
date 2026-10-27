// 쟁점 타임라인 (LAW-08) - 순수 모듈. 날짜는 DB 원문 값(시행일·결정일)만 쓰고 지어내지 않는다. 날짜가 없거나 형식이 틀린 항목은 넣지 않는다.
export type TimelineKind = "law" | "interpretation" | "tribunal" | "case";
export const TIMELINE_ORDER: Readonly<Record<TimelineKind, number>> = { law: 0, interpretation: 1, tribunal: 2, case: 3 };
export const TIMELINE_LABELS: Readonly<Record<TimelineKind, string>> = { law: "법령 개정", interpretation: "해석", tribunal: "심판 결정", case: "대법원 판례" };
export type TimelineOrigin = "editor" | "auto" | "tag";
export const TIMELINE_ORIGIN_LABELS: Readonly<Record<TimelineOrigin, string>> = { editor: "편집자 확인", auto: "자동 연결", tag: "승인된 쟁점 태그" };

export interface TimelineItem {
  key: string;
  kind: TimelineKind;
  /** YYYY-MM-DD - DB 원문 값 */
  date: string;
  title: string;
  origin: TimelineOrigin;
  /** 결론 배지 (결정례의 decision_kind 라벨) - 없으면 null */
  conclusion: string | null;
  href: string;
  /** 분할 화면 패널 조각 (law:1:11 / case:55) */
  splitSpec: string;
  numericId: number;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** 실제 달력 날짜인가 (2월 30일 거부) */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = DATE.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** 해석 문서 종류 -> 타임라인 종류 (예규·통칙·유권해석 = 해석) */
export const timelineKindOfDoc = (docType: string): TimelineKind | null =>
  docType === "case" ? "case" : docType === "tribunal" ? "tribunal" : docType === "ruling" || docType === "circular" || docType === "interpretation" ? "interpretation" : null;

/** 날짜 오름차순 → 같은 날은 법령 → 해석 → 심판 → 판례 → 번호 오름차순. 같은 키는 한 번만, 날짜가 올바르지 않은 항목은 뺀다 */
export function buildTimeline(items: readonly TimelineItem[]): TimelineItem[] {
  const seen = new Set<string>();
  const out: TimelineItem[] = [];
  for (const i of items) {
    if (!isIsoDate(i.date) || seen.has(i.key)) continue;
    seen.add(i.key);
    out.push(i);
  }
  out.sort((a, b) => (a.date === b.date ? TIMELINE_ORDER[a.kind] - TIMELINE_ORDER[b.kind] || a.numericId - b.numericId : a.date < b.date ? -1 : 1));
  return out;
}
