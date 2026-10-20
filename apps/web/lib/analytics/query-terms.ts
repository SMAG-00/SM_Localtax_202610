// 검색어 집계 — 순수 규칙 (SRCH-03 · OPT-04 원본 query_terms, docs/dev/W2-d_설계.md 2.7 · 2.8 · 8.3 · 10장). DB·네트워크·시계를 쓰지 않는다.
// 서버(lib/server/analytics/query-terms.ts)가 검색 한 번마다 이 규칙으로 '세는가'를 정하고 가린 값만 저장한다.
//  · 가림 — 검색어 원문은 이 모듈 밖으로 나가지 않는다. 저장·기록하는 것은 maskQuery의 가린 값(term_masked)과 정규형(normalized)뿐이다.
//    이메일 → 주민등록번호·전화번호·그 밖의 9자리 이상 숫자 줄 차례로 가린다(설계 2.8 견본 — DB check도 같은 모양을 거부한다)
//  · 정규형 — 가림 글자를 뺀 글을 검색과 같은 낱말 규칙(설계 4장 3 — queryTerms)으로. 같은 정규형은 기간(한국 날짜)마다 한 행으로 합산
//  · 세는가 — 사람이 새로 찾은 한 번만. 봇·편집국·측정 거부(GPC)·미리 받기·2쪽 이상·같은 검색 안에서 탭·쪽·거르개 바꾸기·30분 안 다시 찾기는 0
import { leftChars, queryTerms } from "@/lib/server/public/search-normalize";
import { addDays, daysBetween, isDate, kstDate } from "./metrics";

/** 출처 (설계 2.7 query_terms.source — PRD-01A 6.1). 4단계는 site_search만 넣는다 */
export const QUERY_TERM_SOURCES = ["site_search", "search_console", "search_advisor", "assistant_unresolved", "inquiry"] as const;
export type QueryTermSource = (typeof QUERY_TERM_SOURCES)[number];

/** 가림 글자 (설계 2.7 query_terms.mask_labels) */
export const MASK_LABELS = { email: "[이메일]", rrn: "[주민등록번호]", phone: "[전화번호]", number: "[번호]" } as const;
export type MaskKind = keyof typeof MASK_LABELS;

/** 값 (설계 2.7 — 시험이 표와 대조한다) */
export const QUERY_TERMS = {
  period: "day",
  digitRun: 9,
  termChars: 100,
  scanChars: 200,
  dedupeMinutes: 30,
  listSize: 100,
  presets: [7, 30, 90],
} as const;

// ── 가림 ──────────────────────────────────────────────────

/** 남기는 글자 (검색 정규화 4장 1 — DB public.search_squash와 같은 범위 + 소문자로 바꾸기 전의 대문자 영문) */
const KEEP = "0-9A-Za-z가-힣ᄀ-ᇿㄱ-ㆎ一-鿿";
/** 가림 자리 표시 — 유니코드 사용 영역 글자 하나씩(가림 글자는 여러 글자라 자르기·정규화가 끝날 때까지 한 글자로 둔다). 사용자 글의 사용 영역 글자는 먼저 지운다 */
const PLACE: Record<MaskKind, string> = {
  email: String.fromCharCode(0xe000),
  rrn: String.fromCharCode(0xe001),
  phone: String.fromCharCode(0xe002),
  number: String.fromCharCode(0xe003),
};
const PRIVATE_RANGE = `${String.fromCharCode(0xe000)}-${String.fromCharCode(0xf8ff)}`;
const PRIVATE_USE = new RegExp(`[${PRIVATE_RANGE}]`, "gu");
/** 이메일 — '@' 앞뒤(띄어쓰기 허용)에 글자·숫자가 붙은 덩어리 (한글 주소 포함) */
// 반복 길이를 묶는다(앞부분 64자·띄어쓰기 3자·도메인 조각 63자 — 이메일 규격의 한도) — 묶지 않으면 '@' 없는 긴 글에서 자리마다 끝까지 읽고 되돌아와 글 길이의 제곱만큼 느려진다(한글 5천 자 0.4초)
const EMAIL = /[\p{L}\p{N}_.%+-]{1,64}\s{0,3}@\s{0,3}[\p{L}\p{N}-]{1,63}(?:\.[\p{L}\p{N}-]{1,63})*/gu;
/** 숫자 줄 — 숫자 사이에 남기는 글자 밖(띄어쓰기·하이픈·점·괄호·슬래시 등)만 낀 숫자들. 가림 자리 표시는 넘지 않는다. 앞의 '+'·'('도 함께 가린다 */
const CHAIN = new RegExp(`[+(]?[0-9](?:[^${KEEP}${PRIVATE_RANGE}]*[0-9])*`, "gu");
/** DB check와 같은 모양 — 9자리 이상 숫자 줄 · 이메일 (저장 전 마지막 확인) */
const DIGIT_RUN = new RegExp(`[0-9](?:[^${KEEP}]*[0-9]){${QUERY_TERMS.digitRun - 1}}`, "u");
const EMAIL_SHAPE = new RegExp(`[${KEEP}_.%+-]\\s*@\\s*[${KEEP}]`, "u");
const KIND_OF = new Map(Object.entries(PLACE).map(([k, v]) => [v, k as MaskKind]));

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** YYMMDD — 실제 있을 수 있는 생년월일 (윤년은 따지지 않는다 — 2월 29일까지) */
function isBirthDate(yymmdd: string): boolean {
  const m = Number(yymmdd.slice(2, 4));
  const d = Number(yymmdd.slice(4, 6));
  return m >= 1 && m <= 12 && d >= 1 && d <= DAYS_IN_MONTH[m - 1]!;
}

/** 9자리 이상 숫자 줄의 종류 — 13자리 생년월일 + 성별 숫자 1~8이면 주민등록번호, 0으로 시작하는 9~11자리(국가 번호 +82·82는 0으로)면 전화번호, 그 밖은 번호 */
function classify(chain: string): MaskKind {
  const digits = chain.replace(/[^0-9]/g, "");
  if (digits.length === 13 && isBirthDate(digits.slice(0, 6)) && /^[1-8]$/.test(digits[6]!)) return "rrn";
  const national = chain.startsWith("+") || (digits.startsWith("82") && digits.length >= 11) ? `0${digits.slice(2)}` : digits;
  return /^0[0-9]{8,10}$/.test(national) ? "phone" : "number";
}

const digitCount = (s: string) => s.replace(/[^0-9]/g, "").length;

export interface MaskedQuery {
  /** 가린 값 — 저장하는 꼴. NFKC · 띄어쓰기 하나로 · 앞뒤 공백 없음 · 앞 100자(가림 글자 중간에서 자르지 않는다). 남는 글자가 없으면 "" */
  text: string;
  /** 정규형 — 가림 글자를 뺀 낱말 목록(설계 4장 3)을 띄어쓰기 하나로 이음. 남는 낱말이 없으면 "" (저장 0) */
  normalized: string;
  /** 가린 것 (글 차례) */
  masked: MaskKind[];
}

/** 검색어 → 가린 값·정규형 (설계 2.8 견본) */
export function maskQuery(raw: string | null | undefined): MaskedQuery {
  let s = leftChars(raw ?? "", QUERY_TERMS.scanChars).normalize("NFKC").replace(PRIVATE_USE, "");
  s = s.replace(EMAIL, PLACE.email);
  s = s.replace(CHAIN, (m) => (digitCount(m) >= QUERY_TERMS.digitRun ? PLACE[classify(m)] : m));
  s = s.replace(/\s+/gu, " ").trim();
  // 앞 100자 — 가림 글자는 보이는 글자 수로 센다(통째로 넣거나 뺀다)
  let cut = "";
  let length = 0;
  for (const ch of s) {
    const kind = KIND_OF.get(ch);
    const size = kind ? Array.from(MASK_LABELS[kind]).length : 1;
    if (length + size > QUERY_TERMS.termChars) break;
    cut += ch;
    length += size;
  }
  cut = cut.trimEnd();
  const masked = Array.from(cut).flatMap((ch) => KIND_OF.get(ch) ?? []);
  const text = Array.from(cut)
    .map((ch) => {
      const kind = KIND_OF.get(ch);
      return kind ? MASK_LABELS[kind] : ch;
    })
    .join("");
  const normalized = queryTerms(cut.replace(PRIVATE_USE, " ")).terms.join(" ");
  return { text, normalized, masked };
}

/**
 * 저장할 수 있는 값인가 — DB check(query_terms_term_masked_shape · normalized_shape · no_digit_run · no_email)와 같은 판정.
 * 가림 뒤에도 걸리는 드문 꼴(겹친 낱말을 빼며 숫자 낱말이 이웃이 되는 경우 등)은 세지 않는다 — DB 오류 대신 0
 */
export function storable(m: MaskedQuery): boolean {
  const { text, normalized } = m;
  if (text === "" || normalized === "") return false;
  if (Array.from(text).length > QUERY_TERMS.termChars || text !== text.trim()) return false;
  if (normalized.length > 200 || !/^[0-9a-z가-힣ᄀ-ᇿㄱ-ㆎ一-鿿]+( [0-9a-z가-힣ᄀ-ᇿㄱ-ㆎ一-鿿]+){0,7}$/u.test(normalized)) return false;
  const nfkc = text.normalize("NFKC");
  return !DIGIT_RUN.test(nfkc) && !DIGIT_RUN.test(normalized) && !EMAIL_SHAPE.test(nfkc);
}

// ── 세는가 ────────────────────────────────────────────────

interface HeaderGetter {
  get(name: string): string | null;
}

/**
 * 미리 받기 요청 — 브라우저 추측 미리 받기(Sec-Purpose·Purpose) · Next 화면 전환 미리 받기 (사람이 찾은 것이 아니다).
 * Next 16은 화면(서버 컴포넌트)의 headers()에서 자기 머리글(next-router-prefetch)을 숨긴다 — 그 머리글은 라우트 처리기에서만 보인다.
 * 공개 화면의 링크는 미리 받기를 끈다(SiteLinkProvider)
 */
export function isPrefetch(headers: HeaderGetter): boolean {
  if (headers.get("next-router-prefetch") !== null) return true;
  return ["purpose", "sec-purpose", "x-purpose", "x-moz"].some((h) => /prefetch|prerender/i.test(headers.get(h) ?? ""));
}

/**
 * 같은 검색 안의 이동 — Referer가 같은 사이트의 /search이고 검색어 정규형이 같다(탭·쪽·거르개를 바꾸거나 같은 검색어를 다시 보냄).
 * 새 검색어를 보내면 정규형이 달라 센다. Referer가 없거나 다른 사이트면 새 검색
 */
export function isSameSearch(referer: string | null | undefined, hosts: readonly (string | null | undefined)[], normalized: string): boolean {
  if (!referer || normalized === "") return false;
  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return false;
  }
  const host = url.host.toLowerCase();
  if (!hosts.some((h) => typeof h === "string" && h.toLowerCase() === host)) return false;
  if (url.pathname.replace(/\/+$/, "") !== "/search") return false;
  return maskQuery(url.searchParams.get("q")).normalized === normalized;
}

export type SkipReason = "empty" | "page" | "prefetch" | "refused" | "bot" | "staff" | "same_search" | "repeat";

export interface CountSignals {
  /** maskQuery·storable을 지난 값인가 */
  storable: boolean;
  /** 결과 쪽 (1부터) */
  page: number;
  prefetch: boolean;
  /** 측정 거부 쿠키·GPC (설정이 DNT를 거부로 보면 DNT도) */
  refused: boolean;
  bot: boolean;
  staff: boolean;
  sameSearch: boolean;
}

/** 세지 않는 까닭 — 없으면 null (세기 전 마지막으로 30분 안 다시 찾기를 서버 메모리에서 본다 — RecentSearches) */
export function skipReason(s: CountSignals): Exclude<SkipReason, "repeat"> | null {
  if (!s.storable) return "empty";
  if (s.page !== 1) return "page";
  if (s.prefetch) return "prefetch";
  if (s.refused) return "refused";
  if (s.bot) return "bot";
  if (s.staff) return "staff";
  if (s.sameSearch) return "same_search";
  return null;
}

/**
 * 30분 안 다시 찾기 — 열쇠(방문자 또는 IP 해시 + 정규형)마다 마지막으로 센 시각. 서버(프로세스) 메모리, 열쇠 수 상한(오래 안 쓴 것부터 버린다).
 * seen이 거짓이면 지금 센 것으로 적는다
 */
export class RecentSearches {
  private readonly at = new Map<string, number>();

  constructor(
    private readonly windowMs = QUERY_TERMS.dedupeMinutes * 60_000,
    private readonly maxKeys = 20_000,
  ) {}

  seen(key: string, nowMs: number): boolean {
    const prev = this.at.get(key);
    // 시계가 조금 뒤로 가도(같은 프로세스 안 몇 ms — Windows 시계 다시 맞춤) 다시 찾기로 본다
    if (prev !== undefined && Math.abs(nowMs - prev) < this.windowMs) return true;
    this.at.delete(key);
    if (this.at.size >= this.maxKeys) {
      const oldest = this.at.keys().next().value;
      if (oldest !== undefined) this.at.delete(oldest);
    }
    this.at.set(key, nowMs);
    return false;
  }

  get size(): number {
    return this.at.size;
  }
}

// ── 기간 (한국 날짜 — 설계 2.7 query_terms.period) ──────────

/** 지금 시각의 기간 행 — 한국 날짜 하루 */
export const periodOf = (nowMs: number): string => kstDate(nowMs);

export interface TermsPeriod {
  /** 한국 날짜 — 첫날 · 끝날 (둘 다 포함) */
  from: string;
  to: string;
  days: number;
  /** 최근 n일 단추로 고른 기간이면 n, 직접 고른 기간이면 null */
  preset: number | null;
}

export interface TermsPeriodChoice {
  period: TermsPeriod;
  /** 고른 기간을 쓸 수 없어 기본 기간(최근 7일)으로 보일 때의 이유 */
  error: string | null;
}

const recentDays = (today: string, days: number): TermsPeriod => ({ from: addDays(today, -(days - 1)), to: today, days, preset: days });

/**
 * 편집국 화면 주소의 기간 → 기간. ?days=7|30|90(오늘 포함 최근 n일, 기본 7) 또는 ?from=YYYY-MM-DD&to=YYYY-MM-DD(오늘까지, 보존 일수 안).
 * 쓸 수 없는 값이면 기본 기간 + 이유
 */
export function resolveTermsPeriod(query: { days?: string; from?: string; to?: string }, nowMs: number, retentionDays: number): TermsPeriodChoice {
  const today = kstDate(nowMs);
  const fallback = (error: string | null): TermsPeriodChoice => ({ period: recentDays(today, QUERY_TERMS.presets[0]), error });
  const { days, from, to } = query;
  if (from !== undefined || to !== undefined) {
    if (!isDate(from) || !isDate(to)) return fallback("시작일과 끝날을 YYYY-MM-DD 날짜로 적어 주세요");
    if (from > to) return fallback("시작일이 끝날보다 늦습니다");
    if (to > today) return fallback(`끝날은 오늘(${today})까지 고를 수 있습니다`);
    if (daysBetween(from, to) + 1 > retentionDays) return fallback(`기간은 보존 일수(${retentionDays}일)까지 고를 수 있습니다`);
    return { period: { from, to, days: daysBetween(from, to) + 1, preset: null }, error: null };
  }
  if (days === undefined) return fallback(null);
  const preset = QUERY_TERMS.presets.find((d) => String(d) === days);
  return preset ? { period: recentDays(today, preset), error: null } : fallback("알 수 없는 기간입니다");
}

// ── 설정 query_terms (설계 2.7 — 운영 설정 화면과 화면·배치가 같은 검사) ──

export const QUERY_TERMS_SETTING_KEY = "query_terms";

export interface QueryTermsSettings {
  version: string;
  /** 기간 행 보존(일) — 매일 정리 배치(analytics-retention)가 이보다 오래된 날 행을 지운다 */
  retention_days: number;
  /** 편집국 화면에 보이는 최소 합계 횟수 — 그보다 적게 찾은 검색어는 숨기고 수만 보인다 */
  display_min_count: number;
}

const SETTING_KEYS = ["version", "retention_days", "display_min_count"] as const;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const intIn = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/** 설정 값 검사 — 문제 문장 목록(없으면 통과). current를 주면 내용을 바꿀 때 버전도 바꿨는지 본다 */
export function checkQueryTermsSettings(value: unknown, current?: unknown): string[] {
  if (!isObj(value)) return ["값은 JSON 객체여야 합니다"];
  const errors: string[] = [];
  for (const k of SETTING_KEYS) if (value[k] === undefined) errors.push(`${k}: 필요합니다`);
  for (const k of Object.keys(value)) if (!(SETTING_KEYS as readonly string[]).includes(k)) errors.push(`${k}: 모르는 칸입니다`);
  if (value.version !== undefined && (typeof value.version !== "string" || value.version.trim() === "" || value.version.length > 80)) errors.push("version: 버전 글자가 필요합니다");
  // 31일 이상 — 화면의 최근 30일을 고를 수 있게, 1,825일(5년)까지
  if (value.retention_days !== undefined && !intIn(value.retention_days, 31, 1825)) errors.push("retention_days: 31~1825 정수여야 합니다");
  if (value.display_min_count !== undefined && !intIn(value.display_min_count, 1, 100)) errors.push("display_min_count: 1~100 정수여야 합니다");
  if (errors.length === 0 && isObj(current) && value.version === current.version && SETTING_KEYS.some((k) => k !== "version" && value[k] !== current[k])) {
    errors.push(`version: 값을 바꾸면 버전도 바꿔야 합니다 (지금 ${String(current.version)})`);
  }
  return errors;
}

/** 저장된 설정 → 값 (검사를 지나지 못하면 null — 화면·배치는 멈춘 쪽으로) */
export function readQueryTermsSettings(value: unknown): QueryTermsSettings | null {
  return checkQueryTermsSettings(value).length === 0 ? (value as QueryTermsSettings) : null;
}

// ── 문의 본문 가림 (W2-e 설계 2.8 · 7.4) — 검색어와 같은 가림 규칙을 쓰되 길이를 자르지 않고 줄바꿈을 지킨다 ──

/** 긴 글(문의 본문)의 이메일·주민등록번호·전화번호·9자리 이상 숫자 줄을 가림 글자로 바꾼다. NFKC로 정규화하고 사용 영역 글자는 지운다 */
export function maskBody(raw: string): { text: string; masked: MaskKind[] } {
  let s = raw.normalize("NFKC").replace(PRIVATE_USE, "");
  s = s.replace(EMAIL, PLACE.email);
  s = s.replace(CHAIN, (m) => (digitCount(m) >= QUERY_TERMS.digitRun ? PLACE[classify(m)] : m));
  const masked = Array.from(s).flatMap((ch) => KIND_OF.get(ch) ?? []);
  const text = Array.from(s)
    .map((ch) => {
      const kind = KIND_OF.get(ch);
      return kind ? MASK_LABELS[kind] : ch;
    })
    .join("");
  return { text: text.trim(), masked };
}
