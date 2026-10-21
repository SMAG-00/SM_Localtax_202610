// 지역 주소 판정 — slug로 찾기·예약 이름·다른 시·도 아래 slug·유효 기간, 옛 주소 301 도착(사슬 한 번에 접기·순환·길이 상한), proxy 판정(꺼짐·503)
// (docs/dev/W4_설계.md 1장 3단계 · 2.7, PRD-01B REG1-01). 시험용 지역은 법정동코드에 없는 접두 99 가짜 코드다 (설계 8장)
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  MAX_REGION_FETCHES,
  MAX_SUCCESSOR_HOPS,
  RESERVED_REGION_SLUGS,
  followSuccessors,
  isValidOn,
  matchRegion,
  regionGateDecision,
  regionHubsOpen,
  regionProbePaths,
  regionRoute,
  sidoCodeOf,
  type RegionReader,
  type RegionRoute,
  type RegionRouteRow,
} from "./region-route";

const TODAY = "2026-10-22";
const YESTERDAY = "2026-10-21";
const TOMORROW = "2026-10-23";

const row = (code: string, slug: string, over: Partial<RegionRouteRow> = {}): RegionRouteRow => {
  const sido = /^[0-9]{2}0{8}$/.test(code);
  return { code, parent_code: sido ? null : sidoCodeOf(code), level: sido ? "sido" : "sigungu", name: `시험용 ${slug}`, slug, valid_from: null, valid_to: null, successor_code: null, ...over };
};

const SEOUL = row("1100000000", "seoul", { name: "서울특별시" });
const GASANG = row("9900000000", "gasang", { name: "시험용 가상도" });
const GU = row("9901100000", "gadeuk-gu", { name: "시험용 가득구" });
const OTHER_GU = row("9902100000", "bin-gu");
const route = (p: string) => regionRoute(p) as RegionRoute;

describe("지역 주소 모양", () => {
  test.each([
    ["/local/seoul", { sido: "seoul", sigungu: null, path: "/local/seoul" }],
    ["/local/seoul/", { sido: "seoul", sigungu: null, path: "/local/seoul" }],
    ["/local/gasang/gadeuk-gu", { sido: "gasang", sigungu: "gadeuk-gu", path: "/local/gasang/gadeuk-gu" }],
    ["/local/gasang/gadeuk-gu/", { sido: "gasang", sigungu: "gadeuk-gu", path: "/local/gasang/gadeuk-gu" }],
  ])("%s → 지역 주소", (p, expected) => expect(regionRoute(p)).toEqual(expected));

  test.each([
    "/local",
    "/local/",
    "/local/events",
    "/local/events/2026-gangnam",
    "/local/seoul/weekly",
    "/local/seoul/weekly/2026-42",
    "/local/seoul/festivals",
    "/local/food/gadeuk-gu",
    "/local/places",
    "/local/life",
    "/local/Seoul",
    "/local/seoul/Gadeuk-gu",
    "/local/a--b",
    "/local/-seoul",
    "/local/%EC%84%9C%EC%9A%B8",
    "/local/seoul/a/b",
    "/localx/seoul",
    "/news/seoul",
  ])("%s → 지역 주소 아님 (화면이 404)", (p) => expect(regionRoute(p)).toBeNull());

  test("예약 이름 목록 = W2-b regions.slug check의 목록 (DB와 같은 값)", () => {
    const sql = fs.readFileSync(path.resolve(__dirname, "../../../../packages/db/supabase/migrations/20261018000009_regions.sql"), "utf8");
    const m = sql.match(/slug <> all \(array\[([^\]]+)\]\)/);
    expect(m, "regions.slug check").not.toBeNull();
    const inDb = [...m![1]!.matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
    expect([...RESERVED_REGION_SLUGS]).toEqual(inDb);
  });
});

describe("유효 기간 (한국 날짜)", () => {
  test("폐지일 당일까지 유효, 다음 날부터 아님 · 시작일 당일부터 유효", () => {
    expect(isValidOn({ valid_from: null, valid_to: TODAY }, TODAY)).toBe(true);
    expect(isValidOn({ valid_from: null, valid_to: YESTERDAY }, TODAY)).toBe(false);
    expect(isValidOn({ valid_from: TODAY, valid_to: null }, TODAY)).toBe(true);
    expect(isValidOn({ valid_from: TOMORROW, valid_to: null }, TODAY)).toBe(false);
    expect(isValidOn({ valid_from: null, valid_to: null }, TODAY)).toBe(true);
  });
  test("시·군·구의 시·도 코드 = 앞 2자리 + 0 여덟 개", () => {
    expect(sidoCodeOf("9901100000")).toBe("9900000000");
    expect(sidoCodeOf("9900000000")).toBe("9900000000");
  });
});

describe("slug로 지역 찾기", () => {
  const rows = [SEOUL, GASANG, GU, OTHER_GU];

  test("시·도 · 시·군·구 — 오늘 유효하면 지금 지역", () => {
    expect(matchRegion(route("/local/seoul"), rows, TODAY)).toEqual({ kind: "current", sido: SEOUL, sigungu: null });
    expect(matchRegion(route("/local/gasang/gadeuk-gu"), rows, TODAY)).toEqual({ kind: "current", sido: GASANG, sigungu: GU });
  });

  test("다른 시·도 아래의 시·군·구 slug는 없는 주소 (404 — 301 아님)", () => {
    expect(matchRegion(route("/local/seoul/gadeuk-gu"), rows, TODAY)).toEqual({ kind: "none" });
  });

  test("없는 slug · 시·도 slug를 시·군·구 자리에 · 시·군·구 slug를 시·도 자리에 → 없음", () => {
    expect(matchRegion(route("/local/nowhere"), rows, TODAY)).toEqual({ kind: "none" });
    expect(matchRegion(route("/local/gasang/nothing-gu"), rows, TODAY)).toEqual({ kind: "none" });
    expect(matchRegion(route("/local/gasang/seoul"), rows, TODAY)).toEqual({ kind: "none" });
    expect(matchRegion(route("/local/gadeuk-gu"), rows, TODAY)).toEqual({ kind: "none" });
  });

  test("시·도와 같은 slug의 시·군·구가 다른 시·도에 있어도 시·도 주소는 시·도 행만", () => {
    const sameSlug = row("9903100000", "seoul");
    expect(matchRegion(route("/local/seoul"), [sameSlug, SEOUL], TODAY)).toEqual({ kind: "current", sido: SEOUL, sigungu: null });
  });

  test("이름만 바뀐 지역(slug 그대로)은 지금 이름으로 지금 지역", () => {
    const renamed = { ...GU, name: "시험용 새이름구" };
    const m = matchRegion(route("/local/gasang/gadeuk-gu"), [GASANG, renamed], TODAY);
    expect(m.kind === "current" && m.sigungu?.name).toBe("시험용 새이름구");
  });

  test("폐지된 지역(폐지일 다음 날부터)·시작 전 지역은 지금 지역이 아니다 — 폐지일 당일은 지금 지역", () => {
    const retired = { ...GU, valid_to: YESTERDAY };
    expect(matchRegion(route("/local/gasang/gadeuk-gu"), [GASANG, retired], TODAY)).toEqual({ kind: "stale", row: retired });
    const lastDay = { ...GU, valid_to: TODAY };
    expect(matchRegion(route("/local/gasang/gadeuk-gu"), [GASANG, lastDay], TODAY).kind).toBe("current");
    const future = { ...GU, valid_from: TOMORROW };
    expect(matchRegion(route("/local/gasang/gadeuk-gu"), [GASANG, future], TODAY)).toEqual({ kind: "stale", row: future });
    const retiredSido = { ...GASANG, valid_to: YESTERDAY };
    expect(matchRegion(route("/local/gasang"), [retiredSido], TODAY)).toEqual({ kind: "stale", row: retiredSido });
    expect(matchRegion(route("/local/gasang/gadeuk-gu"), [retiredSido, GU], TODAY)).toEqual({ kind: "stale", row: retiredSido });
  });
});

describe("옛 주소 도착 — 오늘 유효한 지역까지 후속을 따라가 한 번에", () => {
  const A = row("9904100000", "cheot-gu", { valid_to: YESTERDAY, successor_code: "9905100000" });
  const B = row("9905100000", "dul-gu", { valid_to: YESTERDAY, successor_code: "9906100000" });
  const C = row("9906100000", "set-gu");
  const known = (...rs: RegionRouteRow[]) => new Map(rs.map((r) => [r.code, r]));
  const none = new Set<string>();

  test("A→B→C 사슬은 C 한 번 (연쇄 0)", () => {
    expect(followSuccessors(A.code, known(GASANG, A, B, C), none, TODAY, "/local/gasang/cheot-gu")).toEqual({ kind: "target", path: "/local/gasang/set-gu" });
    expect(followSuccessors(B.code, known(GASANG, A, B, C), none, TODAY, "/local/gasang/dul-gu")).toEqual({ kind: "target", path: "/local/gasang/set-gu" });
  });

  test("옛 주소가 바로 유효한 지역을 가리키면 그 지역 (slug를 바꾼 지역의 옛 slug)", () => {
    expect(followSuccessors(C.code, known(GASANG, C), none, TODAY, "/local/gasang/yet-gu")).toEqual({ kind: "target", path: "/local/gasang/set-gu" });
    expect(followSuccessors(SEOUL.code, known(SEOUL), none, TODAY, "/local/old-seoul")).toEqual({ kind: "target", path: "/local/seoul" });
  });

  test("폐지 예정(폐지일 전)이라 후속이 미리 적힌 지역은 아직 그 지역에서 멈춘다", () => {
    const pending = row("9907100000", "gol-gu", { valid_to: TOMORROW, successor_code: C.code });
    expect(followSuccessors(pending.code, known(GASANG, pending, C), none, TODAY, "/local/gasang/x-gu")).toEqual({ kind: "target", path: "/local/gasang/gol-gu" });
  });

  test("순환(A→B→A)은 도착 없음 — 404", () => {
    const a = { ...A, successor_code: B.code };
    const b = { ...B, successor_code: A.code };
    expect(followSuccessors(a.code, known(GASANG, a, b), none, TODAY, "/local/gasang/cheot-gu")).toEqual({ kind: "none", reason: "cycle" });
  });

  test(`사슬이 ${MAX_SUCCESSOR_HOPS}번을 넘으면 도착 없음 — 끝이 유효해도`, () => {
    const chain: RegionRouteRow[] = [];
    for (let i = 0; i <= MAX_SUCCESSOR_HOPS + 1; i++) {
      const code = `99${String(10 + i).padStart(3, "0")}00000`;
      const next = `99${String(11 + i).padStart(3, "0")}00000`;
      chain.push(row(code, `c${i}-gu`, { valid_to: YESTERDAY, successor_code: next }));
    }
    const last = row(chain.at(-1)!.successor_code!, "end-gu");
    expect(followSuccessors(chain[0]!.code, known(GASANG, ...chain, last), none, TODAY, "/local/gasang/c0-gu")).toEqual({ kind: "none", reason: "too_long" });
    // 상한 안이면 도착한다
    expect(followSuccessors(chain[2]!.code, known(GASANG, ...chain, last), none, TODAY, "/local/gasang/c2-gu").kind).toBe("target");
  });

  test("후속 없는 폐지 · 끝 지역이 시작 전 · 부모 시·도가 폐지 → 도착 없음", () => {
    const gone = row("9908100000", "eop-gu", { valid_to: YESTERDAY });
    expect(followSuccessors(gone.code, known(GASANG, gone), none, TODAY, "/local/gasang/eop-gu")).toEqual({ kind: "none", reason: "no_successor" });
    const future = row("9909100000", "nae-gu", { valid_from: TOMORROW });
    expect(followSuccessors(future.code, known(GASANG, future), none, TODAY, "/local/gasang/old-gu")).toEqual({ kind: "none", reason: "no_successor" });
    expect(followSuccessors(C.code, known({ ...GASANG, valid_to: YESTERDAY }, C), none, TODAY, "/local/gasang/old-gu")).toEqual({ kind: "none", reason: "parent_invalid" });
  });

  test("모르는 코드는 그 지역과 시·도 행을 더 읽게 하고, 읽었는데 없으면 도착 없음", () => {
    expect(followSuccessors(C.code, known(), none, TODAY, "/local/gasang/x-gu")).toEqual({ kind: "need", codes: [C.code, GASANG.code] });
    expect(followSuccessors(C.code, known(C), none, TODAY, "/local/gasang/x-gu")).toEqual({ kind: "need", codes: [GASANG.code] });
    expect(followSuccessors(C.code, known(), new Set([C.code]), TODAY, "/local/gasang/x-gu")).toEqual({ kind: "none", reason: "missing" });
    expect(followSuccessors(C.code, known(C), new Set([GASANG.code]), TODAY, "/local/gasang/x-gu")).toEqual({ kind: "none", reason: "missing" });
    expect(followSuccessors("9900000000", known(), none, TODAY, "/local/x")).toEqual({ kind: "need", codes: ["9900000000"] });
  });

  test("제자리 301(도착 = 출발 주소)·코드 형식 밖 → 도착 없음", () => {
    expect(followSuccessors(C.code, known(GASANG, C), none, TODAY, "/local/gasang/set-gu")).toEqual({ kind: "none", reason: "self" });
    expect(followSuccessors("99061", known(), none, TODAY, "/local/gasang/x-gu")).toEqual({ kind: "none", reason: "bad_code" });
    expect(followSuccessors("9906100000,1", known(), none, TODAY, "/local/gasang/x-gu")).toEqual({ kind: "none", reason: "bad_code" });
  });
});

describe("확인 요청 경로", () => {
  test("기능 키·slug(중복 0)·옛 주소(인코딩한 값 하나)·코드(형식 밖 제외)", () => {
    expect(regionProbePaths.flags).toBe("/rest/v1/settings?select=value&key=eq.feature_flags&limit=1");
    expect(regionProbePaths.bySlug(route("/local/seoul"))).toBe("/rest/v1/regions?select=code,parent_code,level,name,slug,valid_from,valid_to,successor_code&slug=in.(seoul)");
    expect(regionProbePaths.bySlug(route("/local/gasang/gadeuk-gu"))).toMatch(/&slug=in\.\(gasang,gadeuk-gu\)$/);
    const redirect = regionProbePaths.redirect(route("/local/gasang/cheot-gu"));
    expect(redirect).toBe("/rest/v1/region_slug_redirects?select=region_code&old_path=eq.%2Flocal%2Fgasang%2Fcheot-gu&limit=1");
    expect(new URLSearchParams(redirect.split("?")[1]).get("old_path")).toBe("eq./local/gasang/cheot-gu");
    expect(regionProbePaths.byCode(["9906100000", "x),(", "9900000000"])).toMatch(/&code=in\.\(9906100000,9900000000\)$/);
  });

  test("기능 키 region_hubs — true일 때만 열림 (글자 'true'·없음·모양 틀림은 닫힘)", () => {
    expect(regionHubsOpen([{ value: { region_hubs: true } }])).toBe(true);
    expect(regionHubsOpen([{ value: { region_hubs: "true" } }])).toBe(false);
    expect(regionHubsOpen([{ value: { search: true } }])).toBe(false);
    expect(regionHubsOpen([{ value: [true] }])).toBe(false);
    expect(regionHubsOpen([])).toBe(false);
  });
});

describe("proxy 판정 — 꺼짐 404 · 지금 지역 화면 · 옛 주소 301 한 번 · 읽지 못함 503", () => {
  const A = row("9904100000", "cheot-gu", { valid_to: YESTERDAY, successor_code: "9906100000" });
  const B = row("9905100000", "dul-gu", { valid_to: YESTERDAY, successor_code: "9906100000" });
  const C = row("9906100000", "set-gu");
  const D = row("9907100000", "net-gu", { valid_to: YESTERDAY, successor_code: "9906100000" });
  const E = row("9908100000", "eop-gu", { valid_to: YESTERDAY });
  const ALL = [SEOUL, GASANG, GU, A, B, C, D, E];
  const FLAGS_ON = [{ value: { region_hubs: true } }];

  /** 가짜 공개 표 — 요청 경로를 해석해 행을 준다. fail = 읽지 못할 요청의 종류 */
  function reader(opts: { flags?: unknown[]; regions?: RegionRouteRow[]; redirects?: Record<string, string>; fail?: ("flags" | "slug" | "redirect" | "code")[] } = {}) {
    const calls: { path: string; key: string }[] = [];
    const regions = opts.regions ?? ALL;
    const read: RegionReader = async (p, key) => {
      calls.push({ path: p, key });
      const q = new URLSearchParams(p.split("?")[1]);
      const list = (v: string | null) => (v ?? "").replace(/^in\.\(|\)$/g, "").split(",");
      if (p.startsWith("/rest/v1/settings")) return opts.fail?.includes("flags") ? null : (opts.flags ?? FLAGS_ON);
      if (p.startsWith("/rest/v1/region_slug_redirects")) {
        if (opts.fail?.includes("redirect")) return null;
        const old = q.get("old_path")!.replace(/^eq\./, "");
        const to = opts.redirects?.[old];
        return to ? [{ region_code: to }] : [];
      }
      if (q.has("slug")) return opts.fail?.includes("slug") ? null : regions.filter((r) => list(q.get("slug")).includes(r.slug));
      if (q.has("code")) return opts.fail?.includes("code") ? null : regions.filter((r) => list(q.get("code")).includes(r.code));
      throw new Error(`모르는 요청 ${p}`);
    };
    return { read, calls };
  }

  test("기능 키가 꺼지면 화면으로(404) — 기능 키 한 번만 읽고 지역 행·옛 주소 표는 읽지 않는다(301 0, migration 39 없이도 그대로)", async () => {
    const r = reader({ flags: [{ value: { region_hubs: false } }], redirects: { "/local/gasang/cheot-gu": C.code } });
    expect(await regionGateDecision(route("/local/gasang/cheot-gu"), r.read, TODAY)).toEqual({ kind: "pass" });
    expect(r.calls.map((c) => c.path)).toEqual([regionProbePaths.flags]);
    // 꺼진 동안은 지역 행을 읽지 못해도(칸 없음 등) 503이 아니다
    expect(await regionGateDecision(route("/local/seoul"), reader({ flags: [{ value: {} }], fail: ["slug", "redirect", "code"] }).read, TODAY)).toEqual({ kind: "pass" });
  });

  test("지금 지역은 화면으로 — 옛 주소 표를 읽지 않는다", async () => {
    const r = reader();
    expect(await regionGateDecision(route("/local/seoul"), r.read, TODAY)).toEqual({ kind: "pass" });
    expect(await regionGateDecision(route("/local/gasang/gadeuk-gu"), r.read, TODAY)).toEqual({ kind: "pass" });
    expect(r.calls.every((c) => c.key === "anon")).toBe(true);
  });

  test("옛 주소 표에 있는 주소 → 도착 지역 주소로 301 (service 키로 한 번 읽음)", async () => {
    const r = reader({ redirects: { "/local/gasang/yet-gu": C.code } });
    expect(await regionGateDecision(route("/local/gasang/yet-gu"), r.read, TODAY)).toEqual({ kind: "redirect", path: "/local/gasang/set-gu" });
    expect(r.calls.filter((c) => c.key === "service").map((c) => c.path)).toEqual([regionProbePaths.redirect(route("/local/gasang/yet-gu"))]);
  });

  test("옛 주소 표의 도착이 폐지 지역(접히지 않은 사슬)이어도 최종 지역으로 한 번", async () => {
    const chainB = { ...B, successor_code: C.code };
    const r = reader({ regions: [GASANG, A, chainB, C], redirects: { "/local/gasang/cheot-gu": chainB.code } });
    expect(await regionGateDecision(route("/local/gasang/cheot-gu"), r.read, TODAY)).toEqual({ kind: "redirect", path: "/local/gasang/set-gu" });
  });

  test("옛 주소 표에 없어도 폐지 지역의 후속이 있으면 그 지역으로 301 (REG1-01)", async () => {
    expect(await regionGateDecision(route("/local/gasang/net-gu"), reader().read, TODAY)).toEqual({ kind: "redirect", path: "/local/gasang/set-gu" });
  });

  test("옛 주소 표가 폐지 지역의 후속보다 먼저다", async () => {
    const r = reader({ redirects: { "/local/gasang/net-gu": SEOUL.code } });
    expect(await regionGateDecision(route("/local/gasang/net-gu"), r.read, TODAY)).toEqual({ kind: "redirect", path: "/local/seoul" });
  });

  test("후속 없는 폐지 · 없는 slug · 다른 시·도 아래 slug → 화면으로(404)", async () => {
    for (const p of ["/local/gasang/eop-gu", "/local/nowhere", "/local/seoul/gadeuk-gu"]) expect(await regionGateDecision(route(p), reader().read, TODAY), p).toEqual({ kind: "pass" });
  });

  test("순환 · 도착 행 없음 → 화면으로(404), 읽기 횟수는 상한 안", async () => {
    const a = { ...A, successor_code: B.code };
    const b = { ...B, successor_code: A.code };
    const loop = reader({ regions: [GASANG, a, b] });
    expect(await regionGateDecision(route("/local/gasang/cheot-gu"), loop.read, TODAY)).toEqual({ kind: "pass" });
    const missing = reader({ redirects: { "/local/gasang/x-gu": "9999900000" } });
    expect(await regionGateDecision(route("/local/gasang/x-gu"), missing.read, TODAY)).toEqual({ kind: "pass" });
    expect(missing.calls.filter((c) => c.path.includes("code=in.")).length).toBeLessThanOrEqual(MAX_REGION_FETCHES);
  });

  test("어느 읽기든 실패하면 503 — 있는지 모르므로 404·301 0", async () => {
    expect(await regionGateDecision(route("/local/seoul"), reader({ fail: ["flags"] }).read, TODAY)).toEqual({ kind: "unavailable" });
    expect(await regionGateDecision(route("/local/seoul"), reader({ fail: ["slug"] }).read, TODAY)).toEqual({ kind: "unavailable" });
    expect(await regionGateDecision(route("/local/gasang/cheot-gu"), reader({ fail: ["redirect"] }).read, TODAY)).toEqual({ kind: "unavailable" });
    const noRows = reader({ regions: [GASANG, A], redirects: { "/local/gasang/cheot-gu": C.code }, fail: ["code"] });
    expect(await regionGateDecision(route("/local/gasang/cheot-gu"), noRows.read, TODAY)).toEqual({ kind: "unavailable" });
  });
});
