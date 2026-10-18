// 수집 판정 시험 (POST /api/events — 설계 5장 순서). 바깥 일은 시험용 대역(설정·저장·로그인 확인)으로 바꾸고 판정 결과·저장 행·쿠키를 본다.
import { describe, expect, test } from "vitest";
import { ingest, type EventRow, type IngestDeps, type IngestRequest } from "./ingest";
import { TokenBuckets } from "./rate-limit";
import { MAX_EVENT_BYTES } from "./request";
import { parseCollectSettings, type CollectSettings } from "./settings";
import { designSeeds } from "./test-design";
import { serializeSession } from "./visit";

const SEEDS = designSeeds();
function seedSettings(over: Partial<{ analytics: Record<string, unknown> }> = {}): CollectSettings {
  const r = parseCollectSettings([
    { key: "analytics", value: { ...(structuredClone(SEEDS.get("analytics")) as object), ...over.analytics } },
    { key: "bot_user_agents", value: structuredClone(SEEDS.get("bot_user_agents")) },
    { key: "analytics_referrers", value: structuredClone(SEEDS.get("analytics_referrers")) },
  ]);
  if (!r.ok) throw new Error(r.problems.join(", "));
  return r.settings;
}

const HUMAN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const IP = "203.0.113.77";
const VID = "3f1c2b9a-6d4e-4f8a-9b2c-1e0d5a7c8b6f";
const SID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const T0 = Date.UTC(2026, 9, 18, 1, 0, 0);
const ARTICLE = { name: "article_viewed", section: "tax", props: { article_id: 12, format: "general", content_type: "explainer" } };

interface World {
  rows: EventRow[];
  staffCalls: number;
  deps: IngestDeps;
}

function world({ now, ...over }: Partial<Omit<IngestDeps, "now">> & { now?: number } = {}): World {
  const w: World = { rows: [], staffCalls: 0, deps: undefined as unknown as IngestDeps };
  let n = 0;
  w.deps = {
    now: () => now ?? T0,
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    settings: async () => seedSettings(),
    limiter: new TokenBuckets(),
    ipKey: (ip) => `ip:${ip.length}`,
    isStaff: async () => {
      w.staffCalls++;
      return false;
    },
    store: async (row) => {
      w.rows.push(row);
      return true;
    },
    ...over,
  };
  return w;
}

function request(body: unknown, headers: Record<string, string> = {}, opts: { raw?: string } = {}): IngestRequest {
  const text = opts.raw ?? JSON.stringify(body);
  const h = new Headers({ "content-type": "application/json", "user-agent": HUMAN_UA, "x-forwarded-for": IP, origin: "http://127.0.0.1:3001", "sec-fetch-site": "same-origin", ...headers });
  return {
    headers: h,
    readBody: async (max) => (new TextEncoder().encode(text).byteLength > max ? { ok: false, tooLarge: true } : { ok: true, text }),
    hosts: ["127.0.0.1:3001", "e2e.example.test"],
    secure: false,
  };
}

describe("받아서 저장 (202)", () => {
  test("새 브라우저의 기사 열람 — 행은 PRD 칸만, 방문자 ID·세션 새로, first_visit=true, 리퍼러는 진입 경로로만, UA·IP 0", async () => {
    const w = world();
    const r = await ingest(request({ ...ARTICLE, referrer: "www.google.com" }), w.deps);
    expect(r.status).toBe(202);
    expect(r.body).toBeNull(); // 받음은 본문 없음 — 브라우저가 읽을 것이 남지 않는다
    expect(w.rows).toEqual([
      {
        name: "article_viewed",
        occurred_at: new Date(T0).toISOString(),
        session_id: "00000000-0000-4000-8000-000000000002",
        visitor_id: "00000000-0000-4000-8000-000000000001",
        first_visit: true,
        stage: 1,
        mode: "general",
        tier: "guest",
        entry: "search",
        section: "tax",
        props: { article_id: 12, format: "general", content_type: "explainer" },
        is_bot: false,
        is_staff: false,
      },
    ]);
    const text = JSON.stringify(w.rows);
    for (const leak of [HUMAN_UA, "Chrome", IP, "google"]) expect(text).not.toContain(leak);
    expect(r.cookies).toEqual([
      "ltr_vid=00000000-0000-4000-8000-000000000001; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly",
      `ltr_sid=00000000-0000-4000-8000-000000000002.${T0}.1.search; Path=/; Max-Age=1800; SameSite=Lax; HttpOnly`,
    ]);
    expect(w.staffCalls).toBe(0);
  });

  test("이어지는 세션 — 쿠키의 방문자·세션·첫 방문·진입 경로를 쓰고 방문자 쿠키는 다시 쓰지 않는다", async () => {
    const w = world({ now: T0 + 29 * 60_000 });
    const cookie = `ltr_vid=${VID}; ltr_sid=${serializeSession({ id: SID, lastActivityMs: T0, firstVisit: true, entry: "naver" })}`;
    const r = await ingest(request({ name: "hub_viewed", section: "local", props: { topic: "local_tax" } }, { cookie }), w.deps);
    expect(r.status).toBe(202);
    expect(w.rows[0]).toMatchObject({ visitor_id: VID, session_id: SID, first_visit: true, entry: "naver", section: "local", props: { topic: "local_tax" } });
    expect(r.cookies).toHaveLength(1);
    expect(r.cookies[0]).toMatch(/^ltr_sid=/);
  });

  test("31분 뒤 → 새 세션, first_visit=false", async () => {
    const w = world({ now: T0 + 31 * 60_000 });
    const cookie = `ltr_vid=${VID}; ltr_sid=${serializeSession({ id: SID, lastActivityMs: T0, firstVisit: true, entry: "naver" })}`;
    await ingest(request(ARTICLE, { cookie }), w.deps);
    expect(w.rows[0]).toMatchObject({ visitor_id: VID, first_visit: false, entry: "direct" });
    expect(w.rows[0]!.session_id).not.toBe(SID);
  });

  test("사이트 안 출발점 진입 경로(tax_lens)는 그 이벤트에만 — 세션 진입 경로는 그대로", async () => {
    const w = world();
    const r = await ingest(request({ ...ARTICLE, entry: "tax_lens", referrer: "chatgpt.com" }), w.deps);
    expect(w.rows[0]!.entry).toBe("tax_lens");
    expect(r.cookies[1]).toContain(".1.ai_answer_engine;");
  });

  test("봇 User-Agent → is_bot=true로 저장(버리지 않는다), 빈 User-Agent도 봇", async () => {
    const w = world();
    await ingest(request(ARTICLE, { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }), w.deps);
    await ingest(request(ARTICLE, { "user-agent": "" }), w.deps);
    expect(w.rows.map((r) => r.is_bot)).toEqual([true, true]);
    expect(JSON.stringify(w.rows)).not.toContain("Googlebot");
  });

  test("로그인 쿠키가 있으면 편집국 판정을 부르고 그 값으로 is_staff — 없으면 부르지 않는다", async () => {
    const staff = world({ isStaff: async () => true });
    await ingest(request(ARTICLE, { cookie: "sb-abc-auth-token=xyz" }), staff.deps);
    expect(staff.rows[0]!.is_staff).toBe(true);
    const plain = world();
    await ingest(request(ARTICLE, { cookie: "other=1" }), plain.deps);
    expect(plain.staffCalls).toBe(0);
    expect(plain.rows[0]!.is_staff).toBe(false);
  });

  test("단계·세션 길이·방문자 쿠키 수명은 설정에서 (코드 상수 0)", async () => {
    const w = world({ settings: async () => seedSettings({ analytics: { stage: 2, session_idle_minutes: 10, visitor_id_days: 30 } }) });
    const r = await ingest(request(ARTICLE), w.deps);
    expect(w.rows[0]!.stage).toBe(2);
    expect(r.cookies[0]).toContain(`Max-Age=${30 * 86_400};`);
    expect(r.cookies[1]).toContain("Max-Age=600;");
  });

  test("https 요청이면 쿠키에 Secure", async () => {
    const w = world();
    const r = await ingest({ ...request(ARTICLE), secure: true }, w.deps);
    for (const c of r.cookies) expect(c).toMatch(/; Secure$/);
  });
});

describe("측정 거부·GPC·DNT (204 — 저장 0, 방문자 ID 0)", () => {
  test("거부 쿠키 → 204, 저장 0, 본문을 읽지 않고, 남은 방문자·세션 쿠키를 지운다", async () => {
    const w = world();
    let read = false;
    const req: IngestRequest = {
      ...request(ARTICLE, { cookie: `ltr_optout=1; ltr_vid=${VID}; ltr_sid=x` }),
      readBody: async () => {
        read = true;
        return { ok: true, text: "{}" };
      },
    };
    const r = await ingest(req, w.deps);
    expect(r.status).toBe(204);
    expect(w.rows).toEqual([]);
    expect(read).toBe(false);
    expect(r.cookies).toEqual(["ltr_vid=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly", "ltr_sid=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly"]);
  });

  test("Sec-GPC: 1 → 204, 저장 0, 방문자 쿠키를 만들지 않는다 (지울 쿠키가 없으면 쿠키 0)", async () => {
    const w = world();
    const r = await ingest(request(ARTICLE, { "sec-gpc": "1" }), w.deps);
    expect(r).toMatchObject({ status: 204, cookies: [] });
    expect(w.rows).toEqual([]);
  });

  test("DNT: 1 — 설정이 꺼져 있으면 저장(기본값), 켜면 204", async () => {
    const off = world();
    expect((await ingest(request(ARTICLE, { dnt: "1" }), off.deps)).status).toBe(202);
    const on = world({ settings: async () => seedSettings({ analytics: { respect_dnt: true } }) });
    expect((await ingest(request(ARTICLE, { dnt: "1" }), on.deps)).status).toBe(204);
    expect(on.rows).toEqual([]);
  });

  test("거부가 형식 검사보다 먼저 — 거부한 사람의 틀린 본문도 204 (본문을 보지 않는다)", async () => {
    const w = world();
    expect((await ingest(request(null, { cookie: "ltr_optout=1" }, { raw: "not json" }), w.deps)).status).toBe(204);
  });
});

describe("잘못된 입력은 4xx이고 저장 0 (500 0)", () => {
  test.each([
    ["다른 사이트 Origin", request(ARTICLE, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }), 403],
    ["text/plain", request(ARTICLE, { "content-type": "text/plain" }), 415],
    ["형식 없음", request(ARTICLE, { "content-type": "" }), 415],
    ["JSON 아님", request(null, {}, { raw: "{name:" }), 400],
    ["없는 이벤트", request({ name: "page_view" }), 400],
    ["모르는 속성(검색어)", request({ ...ARTICLE, props: { ...ARTICLE.props, query: "취득세" } }), 400],
    ["크기 초과", request(null, {}, { raw: JSON.stringify({ ...ARTICLE, pad: "x".repeat(MAX_EVENT_BYTES) }) }), 413],
  ] as const)("%s → %i", async (_label, req, status) => {
    const w = world();
    const r = await ingest(req, w.deps);
    expect(r.status).toBe(status);
    expect(w.rows).toEqual([]);
    expect(r.cookies).toEqual([]);
  });

  test("400 응답은 칸마다 문장 (받은 값을 되풀이하지 않는다)", async () => {
    const r = await ingest(request({ ...ARTICLE, props: { ...ARTICLE.props, query: "취득세 계산" } }), world().deps);
    expect(r.body).toEqual({ error: "이벤트 형식이 맞지 않습니다", errors: ["props.query: 이 이벤트가 받지 않는 칸입니다"] });
    expect(JSON.stringify(r.body)).not.toContain("취득세");
  });
});

describe("속도 제한 (429)", () => {
  test("같은 방문자 1분 상한(설정 120)을 넘으면 429와 retry-after — 저장은 상한까지만", async () => {
    const w = world();
    const cookie = `ltr_vid=${VID}`;
    const statuses: number[] = [];
    for (let i = 0; i < 125; i++) statuses.push((await ingest(request(ARTICLE, { cookie }), w.deps)).status);
    expect(statuses.filter((s) => s === 202)).toHaveLength(120);
    const limited = await ingest(request(ARTICLE, { cookie }), w.deps);
    expect(limited).toMatchObject({ status: 429, headers: { "retry-after": "1" } });
    expect(w.rows).toHaveLength(120);
  });

  test("같은 IP 1분 상한 — 쿠키 없는 요청이 쏟아져도 IP로 막힌다, 다른 IP는 통과", async () => {
    const w = world({ settings: async () => seedSettings({ analytics: { rate_limits: { visitor_per_minute: 10, ip_per_minute: 20 } } }), ipKey: (ip) => `ip:${ip}` });
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) statuses.push((await ingest(request(ARTICLE), w.deps)).status);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
    expect((await ingest(request(ARTICLE, { "x-forwarded-for": "198.51.100.9" }), w.deps)).status).toBe(202);
  });
});

describe("서버 문제 (503 — 저장 0)", () => {
  test("설정을 읽지 못함 · 로그인 확인 실패 · 저장 실패", async () => {
    expect((await ingest(request(ARTICLE), world({ settings: async () => null }).deps)).status).toBe(503);
    const auth = world({
      isStaff: async () => {
        throw new Error("auth down");
      },
    });
    expect((await ingest(request(ARTICLE, { cookie: "sb-abc-auth-token=xyz" }), auth.deps)).status).toBe(503);
    expect(auth.rows).toEqual([]);
    const store = world({ store: async () => false });
    const r = await ingest(request(ARTICLE), store.deps);
    expect(r.status).toBe(503);
    expect(r.cookies).toEqual([]);
  });
});
