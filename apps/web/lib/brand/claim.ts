// 경력 연수 표기('50년'과 변형) 검사 · 시그니처 연재 입력 검사 (W3 8단계 — PRD-01C BR-01·04, docs/dev/W3_설계.md 2.6 · 12장 #25~#28) — 순수 모듈.
// DB 함수 brand_claim_token(마이그레이션 …36)과 같은 규칙이다. 두 시험(claim.test.ts · DB w3-signature)이 설계 2.6 표의 같은 예를 읽는다.
//  · 준비: NFKC(전각 숫자·㊿ → 50) · 소문자 · 보이지 않는 글자 지우기 · (주소는) 퍼센트 인코딩 풀기
//  · 막는 것: 앞에 숫자가 없는 50 + 구분 글자 + (여) + 년(뒤 '대' 제외)·年·주년·years·yrs·nyeon·nyun / 오십(앞에 수 글자 없음) + 년·주년·해 /
//    쉰 해·쉰 년 / 五十年 / 반세기 / fifty years / half a century
//  · 막지 않는 것: 1950년·2050년·150년(앞에 숫자) · 50년대(연대) · 500년 · 천구백오십년
// 쓰는 곳: 연재 제목(승인 뒤에만) · 시그니처 회차의 제목·요약·주소·본문 · 기사 연재 이름 칸 · 「그때와 지금」 항목(늘 거부 — 근거 링크를 붙일 수 없는 자리라서)

const INVISIBLE = /[­​-‍⁠﻿]/g;
const SEP = "[\\s_·.\\-]*";
const CLAIM = new RegExp(
  [
    `(?<![0-9])50${SEP}(?:여${SEP})?(?:년(?!대)|年|주년|years?|yrs?|nyeon|nyun)`,
    `(?<![일이삼사오육칠팔구십백천만억])오십${SEP}(?:여${SEP})?(?:년(?!대)|주년|해)`,
    `(?<![가-힣])쉰${SEP}(?:해|년(?!대))`,
    `五十${SEP}年`,
    "반세기",
    `fifty${SEP}years?`,
    `half${SEP}(?:a${SEP})?century`,
  ].join("|"),
  "u",
);

function prepare(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(INVISIBLE, "");
}

function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** 경력 연수 표기('50년' 등)가 들어 있나 — 글자가 아니면 false */
export function hasClaimToken(text: unknown): boolean {
  if (typeof text !== "string" || text === "") return false;
  return CLAIM.test(prepare(text)) || CLAIM.test(prepare(decoded(text)));
}

/** 본문(블록 JSON 등) 안의 모든 글자 값 */
export function textsOf(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) textsOf(v, out);
  else if (typeof value === "object" && value !== null) for (const v of Object.values(value)) textsOf(v, out);
  return out;
}

export const SERIES_KEYS = ["signature", "then_now"] as const;
export type SeriesKey = (typeof SERIES_KEYS)[number];
export const isSeriesKey = (v: unknown): v is SeriesKey => typeof v === "string" && (SERIES_KEYS as readonly string[]).includes(v);
/** 연재 제목 설정 키 (settings — 설계 2.2) */
export const SERIES_SETTING_KEY: Readonly<Record<SeriesKey, string>> = { signature: "series_title_signature", then_now: "series_title_then_now" };
export const SERIES_TITLE_MAX = 100;
export const CADENCE_MAX = 100;
export const EPISODE_MAX = 9999;
export const THEN_NOW_MAX_ITEMS = 20;
export const THEN_NOW_TEXT_MAX = 500;
export const THEN_NOW_SOURCE_MAX = 300;
export const BASE_YEAR_MIN = 1900;

const CLAIM_NOTE = "경력 연수 표기('50년' 등)";

/** 기사 연재 이름 칸(어떤 기사든) — 경력 연수 표기는 시그니처 연재 제목(설정)에서만, 승인 뒤에 쓴다 */
export function freeSeriesTitleErrors(seriesTitle: unknown): string[] {
  return hasClaimToken(seriesTitle) ? [`seriesTitle: 연재 이름에는 ${CLAIM_NOTE}를 쓸 수 없습니다 — 시그니처 연재 제목(설정)에서만, 경력 표시 승인 뒤에 씁니다`] : [];
}

export interface EpisodeText {
  title?: string | null;
  summary?: string | null;
  slug?: string | null;
  body?: unknown;
  seriesTitle?: string | null;
}

const FIELD_NAMES: Record<"title" | "summary" | "slug" | "body", string> = { title: "제목", summary: "요약", slug: "주소(slug)", body: "본문" };

/** 시그니처 연재 회차의 글 — 경력 연수 표기 0(승인과 상관없이), 기사 연재 이름 칸은 비운다. 칸별 오류 ["칸: 문장"] */
export function episodeTextErrors(t: EpisodeText): string[] {
  const errors: string[] = [];
  for (const key of ["title", "summary", "slug"] as const) {
    if (hasClaimToken(t[key])) errors.push(`${key}: 시그니처 연재 회차의 ${FIELD_NAMES[key]}에는 ${CLAIM_NOTE}를 쓸 수 없습니다 — 연수 표기는 승인된 연재 제목에만(근거 링크와 함께) 나옵니다`);
  }
  if (textsOf(t.body).some(hasClaimToken)) errors.push(`body: 시그니처 연재 회차의 ${FIELD_NAMES.body}에는 ${CLAIM_NOTE}를 쓸 수 없습니다 — 연도는 「그때와 지금」 항목의 기준연도 칸에 적습니다`);
  if (typeof t.seriesTitle === "string" && t.seriesTitle.trim() !== "") errors.push("seriesTitle: 시그니처 연재 회차는 기사의 연재 이름·회차 칸을 비웁니다 — 연재 이름은 설정에서 옵니다");
  return errors;
}

/** 연재 제목 — 1~100자, 경력 연수 표기는 경력 표시 승인(근거 증빙이 지금도 승인) 뒤에만 */
export function seriesTitleErrors(title: unknown, claimApproved: boolean): string[] {
  if (typeof title !== "string" || title.trim() === "") return ["title: 연재 제목이 필요합니다"];
  if (title.trim().length > SERIES_TITLE_MAX) return [`title: 연재 제목은 ${SERIES_TITLE_MAX}자까지입니다`];
  if (hasClaimToken(title) && !claimApproved) return [`title: 연재 제목의 ${CLAIM_NOTE}는 경력 표시 승인(career_claim_approved — 승인된 근거 증빙) 뒤에만 쓸 수 있습니다`];
  return [];
}

type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };
const int = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);

/** op = signature — 기사를 연재 회차로 지정(seriesKey·episode) 또는 빼기(seriesKey null) */
export function parseEpisodeAssign(raw: Record<string, unknown>): Parsed<{ articleId: number; seriesKey: SeriesKey | null; episode: number | null }> {
  const errors: string[] = [];
  const articleId = int(raw.articleId);
  if (articleId === null || articleId < 1) errors.push("articleId: 기사 번호가 필요합니다");
  const seriesKey = raw.seriesKey === null ? null : isSeriesKey(raw.seriesKey) ? raw.seriesKey : undefined;
  if (seriesKey === undefined) errors.push(`seriesKey: ${SERIES_KEYS.join("·")} 중 하나이거나 null(연재에서 빼기)이어야 합니다`);
  let episode: number | null = null;
  if (seriesKey) {
    episode = int(raw.episode);
    if (episode === null || episode < 1 || episode > EPISODE_MAX) errors.push(`episode: 1~${EPISODE_MAX} 회차 번호가 필요합니다`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: { articleId: articleId!, seriesKey: seriesKey!, episode } };
}

export interface ThenNowItem {
  label: string | null;
  then_text: string;
  now_text: string;
  source: string;
  source_url: string | null;
  base_year: number;
}

/**
 * op = then_now — 「그때와 지금」 비교 항목 한 벌. 과거 수치·제도는 출처(source)와 기준연도(baseYear)가 둘 다 있어야 한다(BR-04).
 * 빠지면 칸별 오류 ["items[0].source: …", "items[0].baseYear: …"]. currentYear = 한국 날짜 기준 올해(기준연도 상한)
 */
export function parseThenNowItems(raw: unknown, currentYear: number): Parsed<ThenNowItem[]> {
  if (!Array.isArray(raw)) return { ok: false, errors: ["items: 비교 항목 목록이 필요합니다"] };
  if (raw.length > THEN_NOW_MAX_ITEMS) return { ok: false, errors: [`items: 비교 항목은 ${THEN_NOW_MAX_ITEMS}개까지입니다`] };
  const errors: string[] = [];
  const items: ThenNowItem[] = [];
  raw.forEach((v, i) => {
    const at = `items[${i}]`;
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
      errors.push(`${at}: 항목은 객체여야 합니다`);
      return;
    }
    const o = v as Record<string, unknown>;
    const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
    const label = str("label");
    const thenText = str("thenText");
    const nowText = str("nowText");
    const source = str("source");
    const sourceUrl = str("sourceUrl");
    if (label.length > 100) errors.push(`${at}.label: 항목 이름은 100자까지입니다`);
    if (!thenText) errors.push(`${at}.thenText: 그때(과거 수치·제도) 내용이 필요합니다`);
    else if (thenText.length > THEN_NOW_TEXT_MAX) errors.push(`${at}.thenText: ${THEN_NOW_TEXT_MAX}자까지입니다`);
    if (!nowText) errors.push(`${at}.nowText: 지금 내용이 필요합니다`);
    else if (nowText.length > THEN_NOW_TEXT_MAX) errors.push(`${at}.nowText: ${THEN_NOW_TEXT_MAX}자까지입니다`);
    if (!source) errors.push(`${at}.source: 출처가 필요합니다 — 과거 수치·제도는 출처가 있을 때만 보입니다`);
    else if (source.length > THEN_NOW_SOURCE_MAX) errors.push(`${at}.source: 출처는 ${THEN_NOW_SOURCE_MAX}자까지입니다`);
    if (sourceUrl && !/^https?:\/\/\S+$/.test(sourceUrl)) errors.push(`${at}.sourceUrl: 출처 주소는 http(s)로 시작해야 합니다`);
    const year = o.baseYear;
    if (year === undefined || year === null || year === "") errors.push(`${at}.baseYear: 기준연도가 필요합니다 — 과거 수치·제도는 기준연도가 있을 때만 보입니다`);
    else if (int(year) === null || (year as number) < BASE_YEAR_MIN || (year as number) > currentYear) errors.push(`${at}.baseYear: 기준연도는 ${BASE_YEAR_MIN}~${currentYear} 사이의 연도 숫자여야 합니다`);
    for (const [k, text] of [["label", label], ["thenText", thenText], ["nowText", nowText], ["source", source]] as const) {
      if (hasClaimToken(text)) errors.push(`${at}.${k}: 「그때와 지금」 항목에는 ${CLAIM_NOTE}를 쓸 수 없습니다 — 연도는 기준연도 칸에 적습니다`);
    }
    items.push({ label: label || null, then_text: thenText, now_text: nowText, source, source_url: sourceUrl || null, base_year: year as number });
  });
  return errors.length ? { ok: false, errors } : { ok: true, value: items };
}
