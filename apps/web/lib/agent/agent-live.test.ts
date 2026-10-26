import { describe, expect, it } from "vitest";
import { ALLOWED_LIVE_HOSTS, createLiveFetcher, filterOfficialSearch, guardedFetch, hostAllowed, LiveHostError, type SnapshotStore } from "./live";
import { buildToolDefs, parseToolInput } from "./tools";

const POLICY = { maxCalls: 3, timeoutMs: 50, excerptTokens: 20, officialSearchMax: 2 };
const store = (id: number | null = 7) => {
  const puts: Array<{ url: string; hash: string; origin: string }> = [];
  const s: SnapshotStore = {
    async put(x) {
      puts.push({ url: x.url, hash: x.hash, origin: x.origin });
      return id;
    },
  };
  return { s, puts };
};
const okFetch = (body = "시험용 원문 ".repeat(50)) => {
  const calls: string[] = [];
  const f = (async (u: RequestInfo | URL) => {
    calls.push(String(u));
    return new Response(body, { status: 200 });
  }) as typeof fetch;
  return { f, calls };
};

describe("허용 호스트 (ASK-16 · 허용 목록 밖 도메인 호출 0)", () => {
  it("https + 목록 안 호스트만", () => {
    for (const h of ALLOWED_LIVE_HOSTS) expect(hostAllowed(`https://${h}/x`)).toBe(true);
    expect(hostAllowed("http://www.law.go.kr/x")).toBe(false);
    expect(hostAllowed("https://evil.example.test/x")).toBe(false);
    expect(hostAllowed("https://www.law.go.kr.evil.test/x")).toBe(false);
    expect(hostAllowed("not a url")).toBe(false);
  });
  it("guardedFetch는 목록 밖 주소에서 네트워크 호출 없이 던진다", () => {
    const { f, calls } = okFetch();
    expect(() => guardedFetch(f)("https://evil.example.test/a")).toThrow(LiveHostError);
    expect(calls).toHaveLength(0);
  });
});

describe("실시간 조회 견본 계약", () => {
  it("성공: 응답 원본을 저장한 뒤 snap: 원천으로 돌려주고, 저장 주소에 OC가 없으며, 발췌가 상한 이하", async () => {
    const { f, calls } = okFetch();
    const st = store(7);
    const lf = createLiveFetcher({ fetchImpl: f, oc: "시험OC", store: st.s, policy: POLICY, now: () => new Date("2026-10-27T00:00:00Z") });
    const r = await lf.fetchOfficial({ targetType: "law", query: "시험용 질의", asOf: "2026-10-27" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc).toMatchObject({ sourceId: "snap:7", isLive: true, snapshotId: 7, snapshotOk: true, sourceType: "live_snapshot", fetchedAt: "2026-10-27T00:00:00.000Z" });
    expect(Math.ceil(Array.from(r.doc.content).length / 2)).toBeLessThanOrEqual(POLICY.excerptTokens);
    expect(st.puts).toHaveLength(1);
    expect(st.puts[0]!.url).not.toContain("OC=");
    expect(st.puts[0]!.origin).toBe("live_fetch");
    expect(st.puts[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(calls).toHaveLength(1);
  });
  it("질문당 횟수 상한 - 4번째는 호출 없이 limit", async () => {
    const { f, calls } = okFetch();
    const lf = createLiveFetcher({ fetchImpl: f, oc: "x", store: store().s, policy: POLICY });
    const out = [];
    for (let i = 0; i < 4; i++) out.push(await lf.fetchOfficial({ targetType: "case", query: `q${i}` }));
    expect(out.map((r) => r.ok)).toEqual([true, true, true, false]);
    expect(!out[3]!.ok && out[3]!.reason).toBe("limit");
    expect(calls).toHaveLength(3);
  });
  it("허용 밖 호스트로 조립된 주소는 호출 0", async () => {
    const { f, calls } = okFetch();
    const lf = createLiveFetcher({ fetchImpl: f, oc: "x", store: store().s, policy: POLICY, buildUrl: () => "https://evil.example.test/a" });
    const r = await lf.fetchOfficial({ targetType: "law", query: "q" });
    expect(!r.ok && r.reason).toBe("host");
    expect(calls).toHaveLength(0);
  });
  it("저장 실패면 인용할 문서가 없다 (스냅샷 없는 실시간 인용 0)", async () => {
    const lf = createLiveFetcher({ fetchImpl: okFetch().f, oc: "x", store: store(null).s, policy: POLICY });
    const r = await lf.fetchOfficial({ targetType: "law", query: "q" });
    expect(!r.ok && r.reason).toBe("snapshot");
  });
  it("시간 초과·HTTP 오류·빈 응답", async () => {
    const slow = ((_u: unknown, init?: RequestInit) => new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("abort"))))) as unknown as typeof fetch;
    expect((await createLiveFetcher({ fetchImpl: slow, oc: "x", store: store().s, policy: POLICY }).fetchOfficial({ targetType: "law", query: "q" }))).toMatchObject({ ok: false, reason: "timeout" });
    const bad = (async () => new Response("x", { status: 500 })) as typeof fetch;
    expect((await createLiveFetcher({ fetchImpl: bad, oc: "x", store: store().s, policy: POLICY }).fetchOfficial({ targetType: "law", query: "q" }))).toMatchObject({ reason: "http" });
    const empty = (async () => new Response("  ", { status: 200 })) as typeof fetch;
    expect((await createLiveFetcher({ fetchImpl: empty, oc: "x", store: store().s, policy: POLICY }).fetchOfficial({ targetType: "law", query: "q" }))).toMatchObject({ reason: "empty" });
  });
});

describe("공식 도메인 검색 (ASK-17)", () => {
  it("허용 목록 밖 결과는 버리고 안의 결과만 스냅샷에 저장해 문서로 만든다", async () => {
    const st = store(9);
    const docs = await filterOfficialSearch(
      [
        { url: "https://www.mois.go.kr/a", title: "시험용 공지", text: "시험용 본문" },
        { url: "https://blog.example.test/a", title: "블로그", text: "시험용 본문" },
      ],
      st.s,
    );
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ sourceId: "snap:9", isLive: true, snapshotId: 9 });
    expect(st.puts).toHaveLength(1);
    expect(st.puts[0]!.origin).toBe("web_search");
  });
  it("설정이 꺼지면 요청에 도구 정의가 없다", () => {
    const off = buildToolDefs({ liveAvailable: true, officialSearchEnabled: false }).map((t) => t.name);
    expect(off).not.toContain("web_search_official");
    expect(off).toContain("fetch_official_source");
    expect(buildToolDefs({ liveAvailable: true, officialSearchEnabled: true }).map((t) => t.name)).toContain("web_search_official");
    expect(buildToolDefs({ liveAvailable: false, officialSearchEnabled: false }).map((t) => t.name)).not.toContain("fetch_official_source");
  });
  it("모든 도구는 엄격 스키마, 계산·양도세 도구 0", () => {
    const defs = buildToolDefs({ liveAvailable: true, officialSearchEnabled: true });
    expect(defs.every((t) => t.strict === true)).toBe(true);
    expect(defs.map((t) => t.name).some((n) => /calc|run_|transfer|inherit|gift/.test(n))).toBe(false);
  });
  it("도구 입력 검사", () => {
    expect(parseToolInput("search_corpus", { query: "시험" })).toEqual({ name: "search_corpus", query: "시험" });
    expect(parseToolInput("search_corpus", { query: "" })).toBeNull();
    expect(parseToolInput("fetch_official_source", { target_type: "x", query: "q" })).toBeNull();
    expect(parseToolInput("unknown", {})).toBeNull();
    expect(parseToolInput("suggest_actions", { tax_items: ["a"] })).toEqual({ name: "suggest_actions", taxItems: ["a"] });
  });
});
