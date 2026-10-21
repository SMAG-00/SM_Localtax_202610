// 지역 주소(/local/[sido] · /local/[sido]/[sigungu])의 판정 — 순수 모듈 (시험 region-route.test.ts).
// docs/dev/W4_설계.md 1장 3단계 · 2.7 · 3장, PRD-01B REG1-01 '폐지된 코드의 옛 slug 주소는 후속 지역 페이지로 301 한 번(연쇄 0)'.
//  · 화면(app/(site)/local/[sido]…)은 matchRegion으로 200·404를 정하고, proxy.ts는 regionGateDecision으로 옛 주소 301·읽지 못함 503을 정한다 — 같은 규칙 한 벌.
//  · 지역 = slug로 찾고 오늘(한국 날짜) 유효해야 한다(valid_from ≤ 오늘 ≤ valid_to). 다른 시·도 아래의 시·군·구 slug는 없는 주소(404).
//  · 예약 이름(events·weekly 등 — W2-b regions.slug check와 같은 목록)은 지역으로 잡지 않는다 (/local/events · /local/[sido]/weekly는 W6 전 404).
//  · 옛 주소: 지금 지역이 아니면 ① 옛 주소 표(region_slug_redirects — service_role만 읽는 표, migration 39) ② 그 slug의 폐지 지역의 후속 지역(successor_code) 순서로
//    출발 지역을 정하고, 오늘 유효한 지역이 나올 때까지 후속을 따라가 그 지역 주소로 301 한 번 — 사슬은 한 번에 접고(연쇄 0), 돌고 돌면·너무 길면·끝이 유효하지 않으면 404.
// proxy가 불러오므로 서버 전용 모듈을 부르지 않는다 — 의존 없이 글자만 다룬다.

/** 지역 slug로 쓸 수 없는 예약 이름 (W2-b `regions.slug` check와 같다 — /local/events · /local/[sido]/weekly · PRD-X 후보 경로) */
export const RESERVED_REGION_SLUGS = ["events", "weekly", "places", "festivals", "food", "life"] as const;
/** 지역 slug 형식 (W2-b `regions.slug` check와 같다) */
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** 법정동코드 10자리 (W2-b `regions.code` check와 같다) */
const CODE = /^[0-9]{10}$/;
/** 후속 지역을 따라가는 최대 횟수 — DB가 사슬을 접어 두므로(migration 39 트리거) 실제로는 1번이다. 넘으면 404 */
export const MAX_SUCCESSOR_HOPS = 10;
/** 옛 주소 도착을 찾으며 지역 행을 더 읽는 최대 횟수 (proxy 요청 수의 상한) */
export const MAX_REGION_FETCHES = 4;

export interface RegionRoute {
  sido: string;
  sigungu: string | null;
  /** 끝의 '/'를 뗀 주소 — 옛 주소 표의 old_path와 같은 모양 */
  path: string;
}

export const isReservedRegionSlug = (slug: string) => (RESERVED_REGION_SLUGS as readonly string[]).includes(slug);
const isRegionSlug = (slug: string) => KEBAB.test(slug) && !isReservedRegionSlug(slug);

/** 지역 화면 주소 */
export const regionHref = (sidoSlug: string, sigunguSlug?: string | null) => (sigunguSlug ? `/local/${sidoSlug}/${sigunguSlug}` : `/local/${sidoSlug}`);

/** 지역 주소인가 — 형식 밖·예약 이름·세 단계 이상이면 null (화면이 404를 그린다) */
export function regionRoute(pathname: string): RegionRoute | null {
  const m = pathname.match(/^\/local\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (!m) return null;
  const sido = m[1]!;
  const sigungu = m[2] ?? null;
  if (!isRegionSlug(sido) || (sigungu !== null && !isRegionSlug(sigungu))) return null;
  return { sido, sigungu, path: regionHref(sido, sigungu) };
}

/** 지역 판정에 쓰는 regions 칸 (successor_code는 migration 39) */
export interface RegionRouteRow {
  code: string;
  parent_code: string | null;
  level: string;
  name: string;
  slug: string;
  valid_from: string | null;
  valid_to: string | null;
  successor_code?: string | null;
}

/** 그날(한국 날짜 "2026-10-22") 유효한 지역인가 — 폐지일(valid_to) 당일까지 유효 (W2-b 기사 지역 태그 검사·migration 39 후속 검사와 같다) */
export const isValidOn = (r: Pick<RegionRouteRow, "valid_from" | "valid_to">, today: string) =>
  (r.valid_from === null || r.valid_from <= today) && (r.valid_to === null || r.valid_to >= today);

/** 시·군·구의 시·도 코드 — 법정동코드 앞 2자리 + 0 여덟 개 (W2-b regions_sido_code · regions_sigungu_code check) */
export const sidoCodeOf = (code: string) => `${code.slice(0, 2)}00000000`;

export type RegionMatch<R extends RegionRouteRow = RegionRouteRow> =
  | { kind: "current"; sido: R; sigungu: R | null }
  /** 주소의 지역 행은 있지만 오늘 유효하지 않다(폐지·시작 전) — 후속 지역이 있으면 301, 없으면 404 */
  | { kind: "stale"; row: R }
  | { kind: "none" };

/** 주소 → 지역. 시·도는 부모 없는 sido 행, 시·군·구는 그 시·도를 부모로 둔 sigungu 행만 (다른 시·도 아래의 slug는 none) */
export function matchRegion<R extends RegionRouteRow>(route: RegionRoute, rows: readonly R[], today: string): RegionMatch<R> {
  const sido = rows.find((r) => r.level === "sido" && r.parent_code === null && r.slug === route.sido);
  if (!sido) return { kind: "none" };
  if (route.sigungu === null) return isValidOn(sido, today) ? { kind: "current", sido, sigungu: null } : { kind: "stale", row: sido };
  const sigungu = rows.find((r) => r.level === "sigungu" && r.parent_code === sido.code && r.slug === route.sigungu);
  if (!sigungu) return { kind: "none" };
  if (!isValidOn(sigungu, today)) return { kind: "stale", row: sigungu };
  return isValidOn(sido, today) ? { kind: "current", sido, sigungu } : { kind: "stale", row: sido };
}

export type FollowStep =
  /** 도착 — 오늘 유효한 지역의 지금 주소 */
  | { kind: "target"; path: string }
  /** 이 코드의 지역 행을 더 읽어야 한다 */
  | { kind: "need"; codes: string[] }
  | { kind: "none"; reason: "cycle" | "too_long" | "no_successor" | "missing" | "parent_invalid" | "self" | "bad_code" };

/**
 * 출발 지역에서 오늘 유효한 지역이 나올 때까지 후속 지역을 따라간다 — 사슬 A→B→C는 C 한 번(연쇄 0).
 * known = 읽은 지역 행, absent = 읽었지만 없던 코드. 유효한 지역을 만나면 거기서 멈춘다(폐지 예정이라 후속이 미리 적힌 지역은 아직 그 지역).
 * 도착 주소가 출발 주소와 같으면(제자리 301) none
 */
export function followSuccessors(
  startCode: string,
  known: ReadonlyMap<string, RegionRouteRow>,
  absent: ReadonlySet<string>,
  today: string,
  fromPath: string,
): FollowStep {
  const seen = new Set<string>();
  let code = startCode;
  for (let hop = 0; ; hop++) {
    if (!CODE.test(code)) return { kind: "none", reason: "bad_code" };
    if (seen.has(code)) return { kind: "none", reason: "cycle" };
    if (hop > MAX_SUCCESSOR_HOPS) return { kind: "none", reason: "too_long" };
    seen.add(code);
    const row = known.get(code);
    if (!row) {
      if (absent.has(code)) return { kind: "none", reason: "missing" };
      // 시·군·구면 그 시·도 행도 함께 읽는다 (주소에 시·도 slug가 필요하다)
      return { kind: "need", codes: [...new Set([code, sidoCodeOf(code)])].filter((c) => !known.has(c) && !absent.has(c)) };
    }
    if (!isValidOn(row, today)) {
      if (!row.successor_code) return { kind: "none", reason: "no_successor" };
      code = row.successor_code;
      continue;
    }
    let path: string;
    if (row.level === "sido") path = regionHref(row.slug);
    else {
      const parentCode = row.parent_code ?? sidoCodeOf(row.code);
      const parent = known.get(parentCode);
      if (!parent) return absent.has(parentCode) ? { kind: "none", reason: "missing" } : { kind: "need", codes: [parentCode] };
      if (!isValidOn(parent, today)) return { kind: "none", reason: "parent_invalid" };
      path = regionHref(parent.slug, row.slug);
    }
    return path === fromPath ? { kind: "none", reason: "self" } : { kind: "target", path };
  }
}

// ─────────────────────────────────────────────────────────────
// proxy 판정 — 공개 표 읽기를 함수로 받는다 (proxy.ts는 fetch, 시험은 가짜 읽기)
// ─────────────────────────────────────────────────────────────

export type RegionGateDecision = { kind: "pass" } | { kind: "redirect"; path: string } | { kind: "unavailable" };

/** 공개 표 읽기 — 행 목록, 읽지 못하면 null. key = anon(공개 표) · service(옛 주소 표 — service_role만, migration 39) */
export type RegionReader = (path: string, key: "anon" | "service") => Promise<unknown[] | null>;

export const REGION_ROUTE_COLUMNS = "code,parent_code,level,name,slug,valid_from,valid_to,successor_code";

/** 확인 요청 경로 (Supabase REST) — slug·코드는 형식 검사를 지난 값만 넣는다(쉼표·괄호 없음), 옛 주소는 인코딩한 값 하나 */
export const regionProbePaths = {
  flags: "/rest/v1/settings?select=value&key=eq.feature_flags&limit=1",
  bySlug: (route: RegionRoute) => `/rest/v1/regions?select=${REGION_ROUTE_COLUMNS}&slug=in.(${[...new Set([route.sido, route.sigungu ?? route.sido])].join(",")})`,
  redirect: (route: RegionRoute) => `/rest/v1/region_slug_redirects?select=region_code&old_path=eq.${encodeURIComponent(route.path)}&limit=1`,
  byCode: (codes: readonly string[]) => `/rest/v1/regions?select=${REGION_ROUTE_COLUMNS}&code=in.(${codes.filter((c) => CODE.test(c)).join(",")})`,
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function toRows(raw: readonly unknown[]): RegionRouteRow[] {
  return raw.flatMap((r) =>
    isObj(r) && typeof r.code === "string" && typeof r.slug === "string" && typeof r.level === "string"
      ? [{ code: r.code, parent_code: str(r.parent_code), level: r.level, name: str(r.name) ?? "", slug: r.slug, valid_from: str(r.valid_from), valid_to: str(r.valid_to), successor_code: str(r.successor_code) }]
      : [],
  );
}

/** 기능 공개 목록(settings.feature_flags)의 region_hubs — 없거나 true가 아니면 닫힘 (W2-b 2.3 · lib/server/public/settings.ts parseFeatures와 같은 판정, 의존 키 없음) */
export function regionHubsOpen(flagRows: readonly unknown[]): boolean {
  const value = isObj(flagRows[0]) ? flagRows[0].value : null;
  return isObj(value) && value.region_hubs === true;
}

/**
 * 지역 주소의 proxy 판정 — 기능 키 region_hubs가 꺼졌으면 화면으로(404 — 옛 주소 301도 0), 지금 지역이면 화면으로(200),
 * 아니면 옛 주소 표 → 폐지 지역의 후속 순서로 도착을 찾아 301, 도착이 없으면 화면으로(404). 어느 읽기든 실패하면 503.
 * 기능 키를 먼저 읽는다 — 꺼져 있으면 지역 행·옛 주소 표(migration 39의 칸·표)를 읽지 않는다(원격 DB에 39가 없어도 꺼진 동안은 지금처럼 404)
 */
export async function regionGateDecision(route: RegionRoute, read: RegionReader, today: string): Promise<RegionGateDecision> {
  const flags = await read(regionProbePaths.flags, "anon");
  if (!flags) return { kind: "unavailable" };
  if (!regionHubsOpen(flags)) return { kind: "pass" };
  const slugRows = await read(regionProbePaths.bySlug(route), "anon");
  if (!slugRows) return { kind: "unavailable" };
  const rows = toRows(slugRows);
  const match = matchRegion(route, rows, today);
  if (match.kind === "current") return { kind: "pass" };

  const redirect = await read(regionProbePaths.redirect(route), "service");
  if (!redirect) return { kind: "unavailable" };
  const mapped = isObj(redirect[0]) ? str(redirect[0].region_code) : null;
  const start = mapped ?? (match.kind === "stale" ? (match.row.successor_code ?? null) : null);
  if (!start) return { kind: "pass" };

  const known = new Map(rows.map((r) => [r.code, r]));
  const absent = new Set<string>();
  for (let i = 0; i <= MAX_REGION_FETCHES; i++) {
    const step = followSuccessors(start, known, absent, today, route.path);
    if (step.kind === "target") return { kind: "redirect", path: step.path };
    if (step.kind === "none" || i === MAX_REGION_FETCHES || step.codes.length === 0) return { kind: "pass" };
    const more = await read(regionProbePaths.byCode(step.codes), "anon");
    if (!more) return { kind: "unavailable" };
    for (const r of toRows(more)) known.set(r.code, r);
    for (const c of step.codes) if (!known.has(c)) absent.add(c);
  }
  return { kind: "pass" };
}
