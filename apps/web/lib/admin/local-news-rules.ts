// 지자체뉴스 관리 입력 검사 (W6 — PRD-01B LG-01~06 · LG-09 · LG-11~14, docs/dev/W6_설계.md 2장) — 순수 함수.
// 관리 API(/api/admin/local-news)와 관리 화면이 같이 쓴다. 모양(칸·길이·날짜·목록)만 보고, 요약 길이 상한·공식 주소 규칙·영리 주최·취소 출처·
// 기간·발행 검사는 DB 트리거(마이그레이션 …63·64)가 정본이다. 이 모듈은 보도 내용·행사 사실을 만들지 않는다. 오류는 "칸: 문장".

export const LOCAL_NEWS_OPS = [
  "candidate",
  "candidate_status",
  "select",
  "item",
  "item_remove",
  "similarity",
  "convert",
  "publish",
  "event",
  "event_status",
  "event_publish",
  "event_link",
  "event_unlink",
] as const;
export type LocalNewsOp = (typeof LOCAL_NEWS_OPS)[number];

export const LICENSE_TYPES = ["kogl1", "kogl2", "kogl3", "kogl4", "none", "unknown"] as const;
export const EVENT_CATEGORY_KEYS = ["tax_finance", "development", "festival", "commercial", "other"] as const;
export const EVENT_ORGANIZER_KEYS = ["government", "public_body", "nonprofit", "commercial"] as const;
export const EVENT_STATES = ["normal", "changing", "cancelled"] as const;
export const EVENT_LINK_KINDS = ["project", "article"] as const;

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CODE_RE = /^\d{10}$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string) => DATE_RE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

/** 'YYYY-MM-DD' 또는 'YYYY-MM-DDTHH:mm' (한국 시각) → ISO 8601 +09:00. 틀리면 null */
export function kstToIso(text: string, defaultTime = "09:00"): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(text.trim());
  if (!m || !validDate(m[1]!)) return null;
  const hh = m[2] ?? defaultTime.slice(0, 2);
  const mm = m[3] ?? defaultTime.slice(3, 5);
  if (Number(hh) > 23 || Number(mm) > 59) return null;
  return `${m[1]}T${hh}:${mm}:00+09:00`;
}

function build<T>(body: unknown, make: (b: Record<string, unknown>, fail: (field: string, msg: string) => void) => T): Parsed<T> {
  if (!isObj(body)) return { ok: false, errors: ["요청 본문이 JSON 객체가 아닙니다"] };
  const errors: string[] = [];
  const value = make(body, (field, msg) => errors.push(`${field}: ${msg}`));
  return errors.length ? { ok: false, errors } : { ok: true, value };
}
const need = (b: Record<string, unknown>, fail: (f: string, m: string) => void, field: string, max: number): string => {
  const s = str(b[field]);
  if (s === "") fail(field, "비워 둘 수 없습니다");
  else if (s.length > max) fail(field, `${max}자 이하여야 합니다`);
  return s;
};
const oneOf = <T extends string>(b: Record<string, unknown>, fail: (f: string, m: string) => void, field: string, list: readonly T[]): T => {
  const s = str(b[field]);
  if (!(list as readonly string[]).includes(s)) fail(field, `${list.join("·")} 중 하나여야 합니다`);
  return s as T;
};
const positiveId = (b: Record<string, unknown>, fail: (f: string, m: string) => void, field: string): number => {
  const n = typeof b[field] === "number" ? (b[field] as number) : Number(str(b[field]));
  if (!Number.isInteger(n) || n <= 0) fail(field, "1 이상의 번호여야 합니다");
  return n;
};
const urlField = (b: Record<string, unknown>, fail: (f: string, m: string) => void, field: string): string => {
  const s = need(b, fail, field, 500);
  if (s !== "" && !URL_RE.test(s)) fail(field, "http:// 또는 https://로 시작하는 주소여야 합니다");
  return s;
};

export const parseCandidate = (body: unknown) =>
  build(body, (b, fail) => {
    const sido = str(b.sido_code);
    if (!CODE_RE.test(sido)) fail("sido_code", "시·도 법정동코드 10자리여야 합니다");
    const region = str(b.region_code) || sido;
    if (!CODE_RE.test(region)) fail("region_code", "지역 법정동코드 10자리여야 합니다");
    const source_id = str(b.source_id);
    if (!/^[a-z0-9_]{2,30}$/.test(source_id)) fail("source_id", "설정 digest_sources의 출처 id(영문 소문자·숫자·밑줄)여야 합니다");
    const announced = kstToIso(str(b.announced_at), "09:00");
    if (!announced) fail("announced_at", "YYYY-MM-DD 또는 YYYY-MM-DDTHH:mm(한국 시각) 형식이어야 합니다");
    const original = str(b.original_text);
    if (original.length > 20000) fail("original_text", "20000자 이하여야 합니다");
    return {
      sido_code: sido,
      region_code: region,
      source_id,
      title: need(b, fail, "title", 200),
      press_org: need(b, fail, "press_org", 80),
      announced_at: announced ?? "",
      source_url: urlField(b, fail, "source_url"),
      license_type: str(b.license_type) === "" ? "unknown" : oneOf(b, fail, "license_type", LICENSE_TYPES),
      original_text: original === "" ? null : original,
    };
  });

export const parseCandidateStatus = (body: unknown) =>
  build(body, (b, fail) => ({ id: positiveId(b, fail, "id"), status: oneOf(b, fail, "status", ["new", "dismissed"] as const) }));

export const parseSelect = (body: unknown) =>
  build(body, (b, fail) => ({ candidate_id: positiveId(b, fail, "candidate_id"), summary: need(b, fail, "summary", 2000), figures_checked: b.figures_checked === true }));

export const parseItem = (body: unknown) =>
  build(body, (b, fail) => {
    const patch: Record<string, unknown> = {};
    if (b.summary !== undefined) patch.summary = need(b, fail, "summary", 2000);
    if (b.title !== undefined) patch.title = need(b, fail, "title", 200);
    if (b.figures_checked !== undefined) patch.figures_checked = b.figures_checked === true;
    if (b.license_type !== undefined) patch.license_type = oneOf(b, fail, "license_type", LICENSE_TYPES);
    if (b.original_text !== undefined) {
      const o = str(b.original_text);
      if (o.length > 20000) fail("original_text", "20000자 이하여야 합니다");
      patch.original_text = o === "" ? null : o;
    }
    if (Object.keys(patch).length === 0) fail("summary", "고칠 칸(summary·title·figures_checked·license_type·original_text)이 하나도 없습니다");
    return { id: positiveId(b, fail, "id"), patch };
  });

export const parseItemId = (body: unknown) => build(body, (b, fail) => ({ id: positiveId(b, fail, "id") }));
export const parseDigestId = (body: unknown) => build(body, (b, fail) => ({ digest_id: positiveId(b, fail, "digest_id") }));

export const parseEvent = (body: unknown) =>
  build(body, (b, fail) => {
    const slug = need(b, fail, "slug", 80);
    if (slug !== "" && !SLUG_RE.test(slug)) fail("slug", "영문 소문자·숫자·-만 쓸 수 있습니다");
    const series = need(b, fail, "series_key", 80);
    if (series !== "" && !SLUG_RE.test(series)) fail("series_key", "영문 소문자·숫자·-만 쓸 수 있습니다 (같은 행사의 회차는 같은 값)");
    const starts = kstToIso(str(b.starts_at), "09:00");
    const ends = kstToIso(str(b.ends_at), "18:00");
    if (!starts) fail("starts_at", "YYYY-MM-DDTHH:mm(한국 시각) 형식이어야 합니다");
    if (!ends) fail("ends_at", "YYYY-MM-DDTHH:mm(한국 시각) 형식이어야 합니다");
    if (starts && ends && Date.parse(ends) < Date.parse(starts)) fail("ends_at", "종료 일시가 시작 일시보다 이릅니다");
    const region = str(b.region_code);
    if (!CODE_RE.test(region)) fail("region_code", "지역 법정동코드 10자리여야 합니다");
    const confirmed = str(b.confirmed_on);
    if (!validDate(confirmed)) fail("confirmed_on", "YYYY-MM-DD 형식의 정보 확인일이어야 합니다");
    return {
      slug,
      series_key: series,
      title: need(b, fail, "title", 120),
      category: oneOf(b, fail, "category", EVENT_CATEGORY_KEYS),
      organizer: need(b, fail, "organizer", 80),
      organizer_type: oneOf(b, fail, "organizer_type", EVENT_ORGANIZER_KEYS),
      venue: need(b, fail, "venue", 120),
      region_code: region,
      starts_at: starts ?? "",
      ends_at: ends ?? "",
      official_url: urlField(b, fail, "official_url"),
      source_name: need(b, fail, "source_name", 80),
      confirmed_on: confirmed,
      sponsored: b.sponsored === true,
    };
  });

export const parseEventStatus = (body: unknown) =>
  build(body, (b, fail) => {
    const state = oneOf(b, fail, "state", EVENT_STATES);
    const url = str(b.source_url);
    if (state === "cancelled" && url === "") fail("source_url", "취소는 공식 출처 주소가 필요합니다");
    if (url !== "" && !URL_RE.test(url)) fail("source_url", "http:// 또는 https://로 시작하는 주소여야 합니다");
    return { slug: need(b, fail, "slug", 80), state, source_url: url === "" ? null : url };
  });

export const parseEventPublish = (body: unknown) => build(body, (b, fail) => ({ slug: need(b, fail, "slug", 80), published: b.published === true }));

export const parseEventLink = (body: unknown) =>
  build(body, (b, fail) => ({ slug: need(b, fail, "slug", 80), target_kind: oneOf(b, fail, "target_kind", EVENT_LINK_KINDS), target_id: positiveId(b, fail, "target_id"), reason: need(b, fail, "reason", 200) }));

// ─────────────────────────────────────────────────────────────
// 설정 검사 (DB 트리거 digest_settings_guard · event_settings_guard와 같은 모양 검사)
// ─────────────────────────────────────────────────────────────
export function digestSidosErrors(value: unknown): string[] {
  if (!Array.isArray(value)) return ["값은 시·도 코드 배열이어야 합니다 — [\"1100000000\", …]"];
  const errors: string[] = [];
  const seen = new Set<string>();
  value.forEach((v, i) => {
    if (typeof v !== "string" || !CODE_RE.test(v)) errors.push(`[${i}]: 시·도 법정동코드 10자리여야 합니다`);
    else if (seen.has(v)) errors.push(`[${i}]: 같은 시·도가 두 번 있습니다`);
    else seen.add(v);
  });
  return errors;
}

export function digestSummaryMaxErrors(value: unknown): string[] {
  return typeof value === "number" && Number.isInteger(value) && value >= 50 && value <= 2000 ? [] : ["50~2000 사이의 정수(글자 수)여야 합니다"];
}

export function digestSourcesErrors(value: unknown): string[] {
  if (!Array.isArray(value)) return ["값은 출처 배열이어야 합니다"];
  const errors: string[] = [];
  const seen = new Set<string>();
  value.forEach((v, i) => {
    if (!isObj(v)) return errors.push(`[${i}]: 객체여야 합니다`);
    const id = str(v.id);
    if (!/^[a-z0-9_]{2,30}$/.test(id)) errors.push(`[${i}].id: 영문 소문자·숫자·밑줄 2~30자여야 합니다`);
    else if (seen.has(id)) errors.push(`[${i}].id: 겹칩니다`);
    seen.add(id);
    if (str(v.name) === "" || str(v.name).length > 60) errors.push(`[${i}].name: 1~60자여야 합니다`);
    if (str(v.host).length < 3 || str(v.host).length > 100) errors.push(`[${i}].host: 도메인 3~100자여야 합니다`);
    if (v.kind !== "rss" && v.kind !== "board") errors.push(`[${i}].kind: rss 또는 board여야 합니다`);
    if (str(v.basis) === "" || str(v.basis).length > 200) errors.push(`[${i}].basis: 허용 근거(약관·robots 확인 내용) 1~200자가 필요합니다`);
    if (!validDate(str(v.checked_on))) errors.push(`[${i}].checked_on: YYYY-MM-DD 확인일이 필요합니다`);
  });
  return errors;
}

export function eventBlockedDomainsErrors(value: unknown): string[] {
  if (!Array.isArray(value)) return ["값은 도메인 배열이어야 합니다"];
  return value.flatMap((v, i) => (typeof v === "string" && /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(v) ? [] : [`[${i}]: 소문자 도메인이어야 합니다`]));
}

export function eventRecheckErrors(value: unknown): string[] {
  if (!isObj(value)) return ['값은 { "days": 1~90, "hide_stale": true/false } 객체여야 합니다'];
  const errors: string[] = [];
  for (const k of Object.keys(value)) if (k !== "days" && k !== "hide_stale") errors.push(`${k}: 모르는 칸입니다`);
  if (typeof value.days !== "number" || !Number.isInteger(value.days) || value.days < 1 || value.days > 90) errors.push("days: 1~90 정수여야 합니다");
  if (typeof value.hide_stale !== "boolean") errors.push("hide_stale: true 또는 false여야 합니다");
  return errors;
}

/** 기능 키 weekly_digest 켜기 사전 검사 - 시·도 2곳 이상 (DB 트리거 weekly_digest_flag_guard와 같다) */
export function weeklyDigestEnableErrors(sidos: unknown): string[] {
  return Array.isArray(sidos) && sidos.length >= 2 ? [] : ["설정 digest_sidos에 시·도가 2곳 이상 있어야 금주 핫뉴스를 켤 수 있습니다 (PRD_최종 §13 #7)"];
}
