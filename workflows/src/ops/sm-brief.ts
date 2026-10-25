// SM 주간 브리핑 이식 (W10-e) - 코너 구조·수집 대상·달력/진행 중 개정안 규칙. 순수 함수 - 입출력·AI 없음.
// 가져온 것은 구조뿐입니다. 법령 이름·질의어는 공개 식별자이고, 실제 법령·해석·결정례 글자와 달력 문구는 코드에 없습니다(달력·진행 중 개정안은 편집자가 표에 입력).
// 원천 이용 조건(data_sources.terms_status)이 allowed가 되기 전에는 수집기가 돌지 않습니다 - 여기 목록은 "무엇을 어떻게 물을지"의 틀입니다.
import { REJECT_PREFIX, type ItemBadge } from "./brief-checkers.ts";

/** 호의 코너 순서 - SM 호 구성(한눈에 -> 지방세 원문 4종 -> 쉬운 요약 -> 알아둘 날짜)을 따른다. 뉴스·계산 사례 코너는 두지 않는다(BRIEF-01 기사 집계 0, 금액 계산 금지) */
export const BRIEF_CORNERS = [
  { key: "editor_notes", title: "이번 주 한눈에" },
  { key: "laws", title: "지방세 법령 개정" },
  { key: "amendments", title: "개정 단계 변경" },
  { key: "admrul", title: "행정규칙·운영예규" },
  { key: "interpretations", title: "행정안전부 유권해석" },
  { key: "tribunal", title: "조세심판원 결정례" },
  { key: "summary", title: "쉬운 요약" },
  { key: "dates", title: "알아둘 날짜" },
] as const;

/** 없으면 경고하는 코너 (SM 검사기의 필수 섹션 검사) */
export const REQUIRED_CORNER_KEYS: readonly string[] = ["laws", "dates"];

/** 지방세 4법과 시행령·시행규칙 - 법제처 target=law 검색에서 법령명이 정확히 같은 것만 */
export const LAW_NAMES: readonly string[] = [
  "지방세기본법", "지방세기본법 시행령", "지방세기본법 시행규칙",
  "지방세법", "지방세법 시행령", "지방세법 시행규칙",
  "지방세특례제한법", "지방세특례제한법 시행령", "지방세특례제한법 시행규칙",
  "지방세징수법", "지방세징수법 시행령", "지방세징수법 시행규칙",
];

export interface CollectTarget {
  key: string;
  /** data_sources.key - terms_status가 allowed이고 견본 계약 확인이 있어야 수집 */
  sourceKey: string;
  cornerKey: string;
  apiTarget: string;
  queries: readonly string[];
  params: Readonly<Record<string, string>>;
}

export const COLLECT_TARGETS: readonly CollectTarget[] = [
  { key: "brief_laws", sourceKey: "law_api", cornerKey: "laws", apiTarget: "law", queries: LAW_NAMES, params: { display: "100", match: "exact_name" } },
  { key: "brief_admrul", sourceKey: "admrul", cornerKey: "admrul", apiTarget: "admrul", queries: ["지방세", "시가표준액", "지방세 감면", "취득세", "재산세"], params: { display: "100", sort: "ddes", ministry: "행정안전부" } },
  { key: "brief_interpretations", sourceKey: "mois_interpretation", cornerKey: "interpretations", apiTarget: "moisCgmExpc", queries: ["", "취득세", "재산세", "지방세"], params: { display: "100", sort: "ddes" } },
  { key: "brief_tribunal", sourceKey: "tribunal_decision", cornerKey: "tribunal", apiTarget: "ttSpecialDecc", queries: ["취득세", "재산세"], params: { display: "100", sort: "ddes", range_param: "rslYd" } },
];

/** 해석·결정례 본문을 받을 후보를 좁히는 제목 낱말 (SM과 같은 방식) */
export const RELEVANT_TITLE = /취득|재산세|주택|부동산|토지|건축|감면|과세표준|아파트|오피스텔|재개발|재건축|조합|임대|분양|등록면허|지방세/;
export const DECISION_PRIORITY = /주택|아파트|생애최초|임대|재개발|재건축|경매|오피스텔|1세대|분양|입주권/;
export const MAX_INTERPRETATION_BODIES = 8;
export const MAX_DECISION_BODIES = 12;

/** since < d <= until (YYYY-MM-DD 문자열 비교) - 법령은 공포일 또는 시행일, 행정규칙은 발령일, 결정례는 의결일에 쓴다 */
export function isNewInRange(d: string | null | undefined, since: string, until: string): boolean {
  return !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d > since && d <= until;
}

/** YYYYMMDD -> YYYY-MM-DD, 모양이 다르면 null */
export function isoFromCompact(s: string | null | undefined): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec((s ?? "").trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** 제목이 관련 낱말에 걸리는 것만, 최대 limit개 */
export function pickRelevant<T>(rows: readonly T[], titleOf: (r: T) => string, limit: number): T[] {
  return rows.filter((r) => RELEVANT_TITLE.test(titleOf(r))).slice(0, limit);
}

/** 일반 독자 관련 사건을 앞으로(안정 정렬), 최대 limit개 */
export function prioritizeDecisions<T>(rows: readonly T[], titleOf: (r: T) => string, limit: number): T[] {
  return rows.map((r, i) => ({ r, i, p: DECISION_PRIORITY.test(titleOf(r)) ? 0 : 1 })).sort((a, b) => a.p - b.p || a.i - b.i).slice(0, limit).map((x) => x.r);
}

/** 결정례 결론 표지 - 주문이 기각이면 lose, 취소·경정이면 win, 그 밖이면 null(검수자가 표지를 정한다) */
export function decisionBadge(order: string): Extract<ItemBadge, "win" | "lose"> | null {
  const t = order.trim();
  if (t.startsWith(REJECT_PREFIX)) return "lose";
  return /취소|경정/.test(t) ? "win" : null;
}

// ── 달력 · 진행 중 개정안 (SM calendar.json · ongoing.json 구조) ─────────

export interface CalendarRule {
  id: number | string;
  text: string;
  isAlways?: boolean;
  isYearly?: boolean;
  /** 매년 반복 - MM-DD */
  startMd?: string | null;
  endMd?: string | null;
  /** 한 번만 - YYYY-MM-DD */
  startOn?: string | null;
  endOn?: string | null;
}

export interface CalendarOccurrence {
  id: number | string;
  text: string;
  start: string | null;
  end: string | null;
}

/** from~to(YYYY-MM-DD, 양끝 포함) 안에 걸리는 날짜를 날짜순으로, 상시 안내는 맨 뒤 */
export function calendarOccurrences(rules: readonly CalendarRule[], from: string, to: string, limit = 7): CalendarOccurrence[] {
  const dated: CalendarOccurrence[] = [];
  const always: CalendarOccurrence[] = [];
  const y0 = Number(from.slice(0, 4));
  const y1 = Number(to.slice(0, 4));
  for (const r of rules) {
    if (r.isAlways) {
      always.push({ id: r.id, text: r.text, start: null, end: null });
    } else if (r.isYearly && r.startMd) {
      for (let y = y0; y <= y1; y++) {
        const start = `${y}-${r.startMd}`;
        const end = r.endMd ? `${y}-${r.endMd}` : null;
        if ((end ?? start) >= from && start <= to) dated.push({ id: r.id, text: r.text, start, end });
      }
    } else if (r.startOn) {
      const end = r.endOn ?? null;
      if ((end ?? r.startOn) >= from && r.startOn <= to) dated.push({ id: r.id, text: r.text, start: r.startOn, end });
    }
  }
  dated.sort((a, b) => (a.start as string).localeCompare(b.start as string) || String(a.id).localeCompare(String(b.id)));
  return [...dated, ...always].slice(0, limit);
}

export interface OngoingEntry {
  id: number | string;
  name: string;
  stage: string;
  asOf: string;
}

/** 기준일이 staleDays보다 오래된 진행 중 개정안 - 편집자가 단계를 다시 확인해야 한다(SM "_관리" 규칙) */
export function ongoingNeedsRefresh(e: OngoingEntry, today: string, staleDays = 45): boolean {
  const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${e.asOf}T00:00:00Z`);
  return Number.isFinite(ms) && ms > staleDays * 86_400_000;
}
