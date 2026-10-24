import { describe, expect, it } from "vitest";
import { legacyGateDecision, legacyProbePaths, legacyRedirectsOpen, legacyRoute, type LegacyReader } from "./legacy-redirect";

// scripts/__tests__/migration.test.mjs '옛 주소 정규형'과 같은 표 — 두 규칙이 어긋나지 않게 한다
describe("legacyRoute — 옛 주소 정규형", () => {
  it.each([
    ["/news/articleView.html", "?idxno=0123&sc_section_code=S1N1", "/news/articleView.html?idxno=123"],
    ["/news/articleList.html", "?sc_section_code=s1n4&view_type=sm&page=3", "/news/articleList.html?sc_section_code=S1N4"],
    ["/news/articleList.html", "?view_type=sm", "/news/articleList.html"],
    ["/news/articleView.html/", "?idxno=9", "/news/articleView.html?idxno=9"],
  ])("%s%s → %s", (path, search, want) => {
    expect(legacyRoute(path, search)).toEqual({ oldPath: want });
  });
  it.each([
    ["/news/articleView.html", "?idxno=abc"],
    ["/news/articleView.html", ""],
    ["/news/articleList.html", "?sc_section_code=zzz"],
    ["/news/some-slug", "?idxno=1"],
    ["/tax", ""],
  ])("%s%s 는 옛 주소가 아니다", (path, search) => {
    expect(legacyRoute(path, search)).toBeNull();
  });
});

const route = { oldPath: "/news/articleView.html?idxno=7" };
const reader = (flags: unknown[] | null, redirects: unknown[] | null, calls: string[] = []): LegacyReader => async (path, key) => {
  calls.push(`${key}:${path.split("?")[0]}`);
  return path.includes("/settings") ? flags : redirects;
};
const on = [{ value: { legacy_redirects: true } }];

describe("legacyRedirectsOpen", () => {
  it("true일 때만 열림", () => {
    expect(legacyRedirectsOpen(on)).toBe(true);
    expect(legacyRedirectsOpen([{ value: { legacy_redirects: "true" } }])).toBe(false);
    expect(legacyRedirectsOpen([{ value: {} }])).toBe(false);
    expect(legacyRedirectsOpen([])).toBe(false);
  });
});

describe("legacyGateDecision", () => {
  it("기능 키가 꺼져 있으면 옛 주소 표를 읽지 않고 화면에 맡긴다 (원격에 표가 없어도 지금 동작 그대로)", async () => {
    const calls: string[] = [];
    expect(await legacyGateDecision(route, reader([{ value: { region_hubs: true } }], null, calls))).toEqual({ kind: "pass" });
    expect(calls).toEqual(["anon:/rest/v1/settings"]);
  });
  it("켜져 있고 301 행이 있으면 새 주소로 한 번 이동한다", async () => {
    expect(await legacyGateDecision(route, reader(on, [{ new_path: "/news/legacy-7", status: 301 }]))).toEqual({ kind: "redirect", path: "/news/legacy-7", status: 301 });
    expect(await legacyGateDecision(route, reader(on, [{ new_path: "/tax", status: 308 }]))).toEqual({ kind: "redirect", path: "/tax", status: 308 });
  });
  it("410은 사라진 글, 404 행·표에 없음은 화면에 맡긴다", async () => {
    expect(await legacyGateDecision(route, reader(on, [{ new_path: null, status: 410 }]))).toEqual({ kind: "gone" });
    expect(await legacyGateDecision(route, reader(on, [{ new_path: null, status: 404 }]))).toEqual({ kind: "pass" });
    expect(await legacyGateDecision(route, reader(on, []))).toEqual({ kind: "pass" });
  });
  it("바깥 주소·프로토콜 상대 주소로 가는 행은 따르지 않는다", async () => {
    expect(await legacyGateDecision(route, reader(on, [{ new_path: "//evil.example.test/x", status: 301 }]))).toEqual({ kind: "pass" });
    expect(await legacyGateDecision(route, reader(on, [{ new_path: "https://evil.example.test", status: 301 }]))).toEqual({ kind: "pass" });
  });
  it("어느 읽기든 실패하면 unavailable", async () => {
    expect(await legacyGateDecision(route, reader(null, null))).toEqual({ kind: "unavailable" });
    expect(await legacyGateDecision(route, reader(on, null))).toEqual({ kind: "unavailable" });
  });
  it("확인 요청 경로는 옛 주소를 인코딩한 값 하나만 넣는다", () => {
    expect(legacyProbePaths.redirect(route)).toBe("/rest/v1/redirects?select=new_path,status&old_path=eq.%2Fnews%2FarticleView.html%3Fidxno%3D7&limit=1");
  });
});
