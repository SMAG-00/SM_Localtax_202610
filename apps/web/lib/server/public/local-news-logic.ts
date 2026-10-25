// 지자체뉴스 W6 공개 순수 규칙 (시험 local-news-logic.test.ts) — 행사 목록·달력·허브 블록·주간 페이지·Event 데이터.
// docs/dev/W6_설계.md 1장 3·4단계 · 2장, PRD-01B LG-01 · LG-08 · LG-09 · LG-10 · LG-12 · LG-16 · REG-04 · REG1-04 · REG1-05.
//  · 날짜는 한국 날짜 'YYYY-MM-DD' 글자 (시간대 계산은 kstDate 한 곳)
//  · 행사 상태 예정·진행·종료·취소·변경 확인 중은 공개 뷰(DB)가 계산한 값을 그대로 쓴다 — 화면 배지와 Event JSON-LD가 같은 칸에서 나온다
//  · 목록·달력·API는 selectEvents 한 함수 (달력 칸과 목록의 항목 수가 같다) / 축제는 목록·달력·API에 없고 허브 블록과 상세에만 있다 (LG-10)
import { event as eventJsonLd, toJsonLdScriptContent, type EventScreenStatus } from "@ltr/structured-data";
import { addDays } from "@/lib/site/iso-week";

export const EVENT_CATEGORIES = ["tax_finance", "development", "festival", "commercial", "other"] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];
export const EVENT_CATEGORY_LABELS: Readonly<Record<EventCategory, string>> = { tax_finance: "세무·재정", development: "개발·정비", festival: "축제", commercial: "상업", other: "기타" };
export const EVENT_ORGANIZER_TYPES = ["government", "public_body", "nonprofit", "commercial"] as const;
export const EVENT_ORGANIZER_LABELS: Readonly<Record<string, string>> = { government: "지자체·정부", public_body: "공공기관", nonprofit: "비영리", commercial: "영리 사업자" };

export type EventStatusKey = "upcoming" | "ongoing" | "ended" | "cancelled" | "changing";
export const EVENT_STATUS_LABELS: Readonly<Record<EventStatusKey, EventScreenStatus>> = { upcoming: "예정", ongoing: "진행", ended: "종료", cancelled: "취소", changing: "변경 확인 중" };

/** 공개 뷰 public_local_events 한 행 */
export interface EventRow {
  id: number;
  slug: string;
  series_key: string;
  title: string;
  category: EventCategory;
  organizer: string;
  organizer_type: string;
  venue: string;
  region_code: string;
  starts_at: string;
  ends_at: string;
  official_url: string;
  source_name: string;
  confirmed_on: string;
  sponsored: boolean;
  status_source_url: string | null;
  status_confirmed_at: string | null;
  status: EventStatusKey;
  recheck_due: boolean;
  /** W10-h 연동 항목의 공공누리 유형 (수동 입력 행사는 없음) */
  license_type?: string | null;
  /** W10-h 권리 확인분만 내려오는 이미지 주소 */
  image_url?: string | null;
}

const KST_MS = 9 * 3600_000;
export const kstDate = (iso: string): string => new Date(Date.parse(iso) + KST_MS).toISOString().slice(0, 10);
export const kstDateTime = (iso: string): string => new Date(Date.parse(iso) + KST_MS).toISOString().slice(0, 16).replace("T", " ");

/** 관리 화면용 상태 계산 - 공개 뷰(DB)와 같은 규칙: 취소·변경 확인 중은 지정값, 나머지는 시각으로 예정·진행·종료 */
export function eventStatusAt(row: { status_override: "cancelled" | "changing" | null; starts_at: string; ends_at: string }, now: Date): EventStatusKey {
  if (row.status_override === "cancelled") return "cancelled";
  if (row.status_override === "changing") return "changing";
  const t = now.getTime();
  return t < Date.parse(row.starts_at) ? "upcoming" : t <= Date.parse(row.ends_at) ? "ongoing" : "ended";
}

/** 재확인 필요 - 확인일 + N일이 오늘(한국 날짜)보다 이른 때 (확인 후 N일째는 정상, N+1일째부터 필요 - REG1-05) */
export function recheckDue(confirmedOn: string, days: number, today: string): boolean {
  return addDays(confirmedOn, days) < today;
}

export interface EventCard {
  id: number;
  slug: string;
  href: string;
  title: string;
  category: EventCategory;
  categoryLabel: string;
  status: EventStatusKey;
  statusLabel: EventScreenStatus;
  sponsored: boolean;
  startDate: string;
  endDate: string;
  period: string;
  venue: string;
  organizer: string;
  regionCode: string;
  officialUrl: string;
  confirmedOn: string;
  recheckDue: boolean;
}

export const RECHECK_NOTICE = "일정 재확인 필요";

export function eventCard(row: EventRow): EventCard {
  return {
    id: row.id,
    slug: row.slug,
    href: `/local/events/${row.slug}`,
    title: row.title,
    category: row.category,
    categoryLabel: EVENT_CATEGORY_LABELS[row.category],
    status: row.status,
    statusLabel: EVENT_STATUS_LABELS[row.status],
    sponsored: row.sponsored,
    startDate: kstDate(row.starts_at),
    endDate: kstDate(row.ends_at),
    period: `${kstDateTime(row.starts_at)} ~ ${kstDateTime(row.ends_at)}`,
    venue: row.venue,
    organizer: row.organizer,
    regionCode: row.region_code,
    officialUrl: row.official_url,
    confirmedOn: row.confirmed_on,
    recheckDue: row.recheck_due,
  };
}

/** 정렬 묶음 — 세무·재정·개발·정비(0) → 그 밖(1) → sponsored(2, 우선 노출 대상 아님 — LG-13). 같은 묶음 안은 시작 일시 순 */
export function eventPriority(card: Pick<EventCard, "category" | "sponsored">): number {
  if (card.sponsored) return 2;
  return card.category === "tax_finance" || card.category === "development" ? 0 : 1;
}
export function sortEvents<T extends Pick<EventCard, "category" | "sponsored" | "id" | "period">>(cards: readonly T[]): T[] {
  return [...cards].sort((a, b) => eventPriority(a) - eventPriority(b) || a.period.localeCompare(b.period) || a.id - b.id);
}

// ─────────────────────────────────────────────────────────────
// 기간 (REG-04)
// ─────────────────────────────────────────────────────────────
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const isMonth = (v: unknown): v is string => typeof v === "string" && MONTH_RE.test(v);
const nextMonth = (month: string): string => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};
const lastDay = (month: string): string => addDays(`${nextMonth(month)}-01`, -1);

export interface MonthRange {
  /** 보이는 달 — 기본은 이번 달·다음 달, ?month= 로 한 달 */
  months: string[];
  from: string;
  to: string;
}

/** 기본 범위 이번 달·다음 달(오늘 10-31 → 10·11월, 12-31 → 12월·다음 해 1월). month가 올바른 YYYY-MM이면 그 한 달 */
export function monthRange(today: string, month?: string | null): MonthRange {
  const months = isMonth(month) ? [month] : [today.slice(0, 7), nextMonth(today.slice(0, 7))];
  return { months, from: `${months[0]}-01`, to: lastDay(months[months.length - 1]!) };
}

export interface SelectOptions {
  today: string;
  /** 보이는 지역 코드 집합 — 시·도 필터는 하위 시·군·구를 포함한 집합을 넘긴다. null이면 전국 */
  regionCodes: ReadonlySet<string> | null;
  /** 기간 (null이면 기간 제한 없음) */
  range: Pick<MonthRange, "from" | "to"> | null;
  /** 지난 행사(아카이브) — 끝난 날(한국)이 오늘보다 앞선 회차만 */
  archive?: boolean;
  /** 허브 블록은 축제를 포함한다 (LG-10) — 목록·달력·API는 false */
  includeFestival?: boolean;
  /** 설정 event_recheck.hide_stale — 재확인 필요 회차를 예정 목록에서 숨긴다 */
  hideStale?: boolean;
}

/** 목록·달력·API가 같이 쓰는 선택 — 지난 일정은 예정 목록에서 빠지고(끝난 날 한국 날짜가 오늘 이전), 아카이브에 남는다 */
export function selectEvents(rows: readonly EventRow[], opt: SelectOptions): EventCard[] {
  const cards = rows
    .filter((r) => opt.includeFestival === true || r.category !== "festival")
    .filter((r) => opt.regionCodes === null || opt.regionCodes.has(r.region_code))
    .map(eventCard);
  const picked = cards.filter((c) => {
    if (opt.archive === true) return c.endDate < opt.today;
    if (c.endDate < opt.today) return false;
    if (opt.hideStale === true && c.recheckDue) return false;
    if (opt.range && (c.startDate > opt.range.to || c.endDate < opt.range.from)) return false;
    return true;
  });
  if (opt.archive === true) return [...picked].sort((a, b) => b.endDate.localeCompare(a.endDate) || b.id - a.id);
  return sortEvents(picked);
}

// ─────────────────────────────────────────────────────────────
// 달력 (REG-04 — 같은 내용의 목록을 함께 둔다)
// ─────────────────────────────────────────────────────────────
export interface CalendarCell {
  date: string;
  day: number;
  events: EventCard[];
}
export interface CalendarMonth {
  month: string;
  weeks: (CalendarCell | null)[][];
}

/** 월 격자 (일요일 시작). 여러 날 행사는 걸친 모든 칸에 보인다 */
export function buildCalendar(month: string, cards: readonly EventCard[]): CalendarMonth {
  const lead = new Date(`${month}-01T00:00:00Z`).getUTCDay();
  const last = Number(lastDay(month).slice(8, 10));
  const cells: (CalendarCell | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= last; day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    cells.push({ date, day, events: cards.filter((c) => c.startDate <= date && c.endDate >= date) });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (CalendarCell | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return { month, weeks };
}

/** 달력에 보이는 서로 다른 행사 수 — 같은 달 목록의 수와 같아야 한다 */
export function calendarEventCount(cal: CalendarMonth): number {
  const ids = new Set<number>();
  for (const week of cal.weeks) for (const cell of week) for (const e of cell?.events ?? []) ids.add(e.id);
  return ids.size;
}

/** 달에 걸친 회차만 — 달력 한 달의 목록 */
export const cardsInMonth = (cards: readonly EventCard[], month: string): EventCard[] => cards.filter((c) => c.startDate <= lastDay(month) && c.endDate >= `${month}-01`);

// ─────────────────────────────────────────────────────────────
// 지역 범위
// ─────────────────────────────────────────────────────────────
/** 지역 코드 집합 — 시·도면 하위 시·군·구 포함, 시·군·구면 자기만 */
export function regionCodeSet(code: string, regions: readonly { code: string; parent_code: string | null }[]): Set<string> {
  const out = new Set<string>([code]);
  for (const r of regions) if (r.parent_code === code) out.add(r.code);
  return out;
}

// ─────────────────────────────────────────────────────────────
// Event 구조화 데이터 (LG-16) — 화면과 같은 카드 값에서 만든다. 변경 확인 중이면 null(내지 않는다)
// ─────────────────────────────────────────────────────────────
export function eventJsonLdScript(card: EventCard, startsAt: string, endsAt: string, siteUrl: string | undefined): string | null {
  if (!siteUrl) return null;
  const node = eventJsonLd({
    url: `${siteUrl}${card.href}`,
    name: card.title,
    status: card.statusLabel,
    sponsored: card.sponsored,
    startDate: startsAt,
    endDate: endsAt,
    // local_events에는 주소 칸이 없다 - 장소 글자를 이름과 주소에 같이 쓴다(구조화 데이터 검사의 Place 주소 필수)
    venue: { name: card.venue, address: card.venue },
    organizer: { name: card.organizer },
    officialUrl: card.officialUrl,
  });
  return node ? toJsonLdScriptContent([node]) : null;
}

// ─────────────────────────────────────────────────────────────
// 허브 블록 ① 금주 핫뉴스 · ④ 행사안내 (LG-08)
// ─────────────────────────────────────────────────────────────
export interface DigestRow {
  id: number;
  sido_code: string;
  week_key: string;
  starts_on: string;
  ends_on: string;
  published_at: string;
}
export interface DigestItemRow {
  id: number;
  digest_id: number;
  region_code: string;
  title: string;
  source_url: string;
  press_org: string;
  announced_on: string;
  license_type: string;
  summary: string;
  position: number;
}

export const weeklyHref = (sidoSlug: string, weekKey: string) => `/local/${sidoSlug}/weekly/${weekKey}`;

export interface WeeklyBlockView {
  /** 주차·기간·발행일 (고정폭 한 줄) */
  meta: string;
  weekKey: string;
  href: string;
  items: { id: number; title: string; pressOrg: string; announcedOn: string; href: string }[];
  fallbackNotice: string | null;
}

/** 가장 최근 발행 주 — 주차 큰 것이 최근 */
export const latestDigest = (digests: readonly DigestRow[]): DigestRow | null => [...digests].sort((a, b) => b.week_key.localeCompare(a.week_key))[0] ?? null;

export function digestMeta(d: Pick<DigestRow, "week_key" | "starts_on" | "ends_on" | "published_at">): string {
  return `${d.week_key} · ${d.starts_on} ~ ${d.ends_on} · 발행 ${kstDate(d.published_at)}`;
}

/** 허브 ① — 시·군·구 허브는 그 시·군·구 코드 항목을 먼저, 없으면 시·도 주간 페이지 링크와 그 사실. 발행된 주가 없으면 null(블록째 빠짐) */
export function weeklyBlock(input: { sidoSlug: string; sidoName: string; sigungu: { code: string; name: string } | null; digests: readonly DigestRow[]; items: readonly DigestItemRow[] }): WeeklyBlockView | null {
  const digest = latestDigest(input.digests);
  if (!digest) return null;
  const href = weeklyHref(input.sidoSlug, digest.week_key);
  const mine = input.items.filter((i) => i.digest_id === digest.id);
  const ordered = input.sigungu ? [...mine.filter((i) => i.region_code === input.sigungu!.code), ...mine.filter((i) => i.region_code !== input.sigungu!.code)] : mine;
  const own = input.sigungu ? mine.filter((i) => i.region_code === input.sigungu!.code).length : 0;
  const items = ordered.slice(0, 5).map((i) => ({ id: i.id, title: i.title, pressOrg: i.press_org, announcedOn: i.announced_on, href }));
  return {
    meta: digestMeta(digest),
    weekKey: digest.week_key,
    href,
    items,
    fallbackNotice: input.sigungu && own === 0 ? `${input.sigungu.name} 항목이 없어 ${input.sidoName} 주간 페이지를 보입니다` : null,
  };
}

export interface EventsBlockView {
  items: EventCard[];
  more: { href: string; label: string };
}

/** 허브 ④ — 그 지역의 예정·진행 회차(축제 포함, 지난 회차 제외), 최대 5건 */
export function eventsBlock(rows: readonly EventRow[], regionCodes: ReadonlySet<string>, today: string, hideStale = false): EventsBlockView {
  const items = selectEvents(rows, { today, regionCodes, range: null, includeFestival: true, hideStale }).slice(0, 5);
  return { items, more: { href: "/local/events", label: "행사 목록·달력 보기" } };
}

// ─────────────────────────────────────────────────────────────
// 라이선스 글자
// ─────────────────────────────────────────────────────────────
export const LICENSE_LABELS: Readonly<Record<string, string>> = {
  kogl1: "공공누리 1유형",
  kogl2: "공공누리 2유형",
  kogl3: "공공누리 3유형",
  kogl4: "공공누리 4유형",
  none: "이용 조건 표시 없음",
  unknown: "이용 조건 확인 중",
};
