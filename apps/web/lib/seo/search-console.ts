// 서치 콘솔 질의 수집 — 순수 부분 (W7 · OPT-01, docs/dev/W7_설계.md 1장 4단계). 시험 search-console.test.ts.
//  · 외부 호출(토큰·질의 API)은 lib/server/seo/jobs.ts가 하고, 여기는 응답을 가린 값·정규형 행으로 바꾸는 규칙만 둔다
//  · 개인정보 0 — 질의는 검색어 집계와 같은 가림 규칙(전화·이메일·주민등록번호·9자리 이상 숫자 가림)을 거쳐야 저장된다
//  · 같은 날 두 번 돌려도 행이 늘지 않는다 — 한 날의 합계를 '덮어쓰기'로 저장한다(더하기 아님). 같은 정규형은 한 행으로 합친다
import { maskQuery, storable } from "@/lib/analytics/query-terms";

export interface ConsoleQueryRow {
  keys?: unknown;
  clicks?: unknown;
  impressions?: unknown;
}

export interface TermRow {
  term: string;
  normalized: string;
  /** 그날의 노출 수 합계 (정규형이 같은 질의는 합산) */
  count: number;
}

/** 서치 콘솔 searchAnalytics 응답의 rows → 저장할 행 (노출 0, 가림 뒤 저장할 수 없는 값, 키 모양이 틀린 줄은 건너뜀) */
export function toTermRows(apiRows: unknown): TermRow[] {
  if (!Array.isArray(apiRows)) return [];
  const merged = new Map<string, TermRow>();
  for (const raw of apiRows as ConsoleQueryRow[]) {
    const query = Array.isArray(raw?.keys) && typeof raw.keys[0] === "string" ? raw.keys[0] : null;
    const impressions = typeof raw?.impressions === "number" && Number.isFinite(raw.impressions) ? Math.round(raw.impressions) : 0;
    if (query === null || impressions <= 0) continue;
    const masked = maskQuery(query);
    if (!storable(masked)) continue;
    const prev = merged.get(masked.normalized);
    if (prev) prev.count += impressions;
    else merged.set(masked.normalized, { term: masked.text, normalized: masked.normalized, count: impressions });
  }
  return [...merged.values()].sort((a, b) => b.count - a.count || (a.normalized < b.normalized ? -1 : 1));
}

/** 수집할 한국 날짜들 — 서치 콘솔 데이터는 며칠 늦게 완성되므로 오늘 −3일부터 거꾸로 days일 (실패한 날은 다음 실행이 다시 채운다) */
export function datesToCollect(todayKst: string, days = 3, lagDays = 3): string[] {
  const shift = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  return Array.from({ length: days }, (_, i) => shift(todayKst, -(lagDays + i)));
}

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

/** 환경변수 SEARCH_CONSOLE_CREDENTIALS(서비스 계정 JSON 글) 읽기 — 모양이 틀리거나 없으면 null(수집 건너뜀) */
export function readServiceAccount(raw: string | undefined): ServiceAccount | null {
  if (!raw?.trim()) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (typeof v.client_email !== "string" || typeof v.private_key !== "string") return null;
    return { client_email: v.client_email, private_key: v.private_key, ...(typeof v.token_uri === "string" ? { token_uri: v.token_uri } : {}) };
  } catch {
    return null;
  }
}

/** IndexNow 전송 판정 — 꺼짐·색인 관문 닫힘·열쇠 없음이면 전송 요청 0 (OPT-01) */
export function indexnowDecision(input: { indexingOpen: boolean; enabled: boolean; keyPresent: boolean }): { send: boolean; reason: string | null } {
  if (!input.indexingOpen) return { send: false, reason: "색인 관문이 닫혀 있습니다 (SITE_INDEXING=off 또는 크롤러 정책 미결정)" };
  if (!input.enabled) return { send: false, reason: "IndexNow 설정이 꺼져 있습니다" };
  if (!input.keyPresent) return { send: false, reason: "IndexNow 열쇠(INDEXNOW_KEY)가 없습니다" };
  return { send: true, reason: null };
}
