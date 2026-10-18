// 검색어 집계 화면의 보기 값 (/admin/query-terms — SRCH-03, docs/dev/W2-d_설계.md 8.3) — 순수 모듈 (시험 query-terms-view.test.ts).
// 화면은 가린 값·정규형·합계만 보인다(검색어 원문은 DB에도 없다). 많이 찾은 검색어 옆에서 동의어 사전 '더하기'로 간다(설계 1장 4단계).
import { QUERY_TERMS, type TermsPeriod } from "@/lib/analytics/query-terms";
import { SYNONYM_LIMITS } from "./synonym-rules";

export const QUERY_TERMS_PATH = "/admin/query-terms";

export interface PeriodLink {
  key: string;
  label: string;
  href: string;
  current: boolean;
}

/** 기간 단추 — 최근 7·30·90일 (설계 2.7 query_terms.presets) */
export function termsPeriodLinks(period: TermsPeriod): PeriodLink[] {
  return QUERY_TERMS.presets.map((d) => ({ key: String(d), label: `최근 ${d}일`, href: `${QUERY_TERMS_PATH}?days=${d}`, current: period.preset === d }));
}

/** 기간 글자 — "2026-10-13 ~ 2026-10-19 (7일)", 하루면 날짜 하나 */
export function termsPeriodText(p: TermsPeriod): string {
  return p.from === p.to ? `${p.from} (하루)` : `${p.from} ~ ${p.to} (${p.days}일)`;
}

/** 동의어 사전 '더하기'로 — 낱말 칸을 정규형으로 채운 채 연다(동의어 사전 낱말 한도까지) */
export function synonymAddHref(normalized: string): string {
  const term = Array.from(normalized).slice(0, SYNONYM_LIMITS.termChars).join("");
  return `/admin/dictionaries?tab=synonyms&term=${encodeURIComponent(term)}#synonym-add`;
}

/** 동의어 사전에 있는 줄로 */
export const synonymLineHref = (id: number): string => `/admin/dictionaries?tab=synonyms#synonym-${id}`;

/** 숨긴 검색어 안내 — 최소 횟수 아래 정규형이 있을 때만 */
export function hiddenNote(r: { terms: number; shown: number; minCount: number }): string | null {
  const hidden = r.terms - r.shown;
  if (hidden <= 0) return null;
  return `${r.minCount}회보다 적게 찾은 검색어 ${hidden.toLocaleString("ko-KR")}개는 목록에 보이지 않습니다 — 한두 사람만 찾은 말에는 이름처럼 형식으로 가리지 못하는 정보가 있을 수 있습니다. 기준은 운영 설정 query_terms에서 바꿉니다.`;
}

/** 목록 상한 안내 — 보일 수 있는 정규형이 목록보다 많을 때만 */
export function moreNote(r: { shown: number; rows: readonly unknown[] }): string | null {
  return r.shown > r.rows.length ? `많이 찾은 앞 ${r.rows.length.toLocaleString("ko-KR")}개만 보입니다 (보일 수 있는 검색어 ${r.shown.toLocaleString("ko-KR")}개).` : null;
}
