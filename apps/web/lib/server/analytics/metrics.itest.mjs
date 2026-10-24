// 지표 대시보드 통합 시험 (GROW-01 — docs/dev/W2-c_설계.md 8.3) — 로컬 Supabase에 정해 둔 측정 이벤트를 넣고, 대시보드 읽기(lib/server/analytics/metrics.ts)를
// service_role 클라이언트로 불러 DB 함수(analytics_metric_sessions) → 세는 규칙까지 이어서 본다. 기대값은 넣은 자료에서 손으로 센 값이다.
// 다른 시험 자료와 겹치지 않게 지난 시각(비어 있는 주)을 골라 쓰고, 넣은 행과 바꾼 전환일 설정은 끝나면 되돌린다. 로컬 DB에서만 돈다.
// 실행: pnpm --filter @ltr/web test:integration (scripts/ci/db-e2e.sh)
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DAY = 86_400_000;
let db;
let sb;
let load;
let savedCutover;
const sessions = [];
let D1; // 시험 주의 첫날 (한국 날짜)

function localSupabase() {
  const out = execFileSync("supabase", ["status", "-o", "json"], {
    cwd: path.resolve(HERE, "../../../../../packages/db"),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    shell: process.platform === "win32",
  });
  const j = JSON.parse(out.slice(out.indexOf("{")));
  for (const u of [j.API_URL, j.DB_URL]) {
    if (!["127.0.0.1", "localhost", "::1"].includes(new URL(u).hostname)) throw new Error("이 시험은 로컬 Supabase에서만 돈다");
  }
  return j;
}

const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** 한국 시각 → ISO */
const kst = (date, hms) => new Date(`${date}T${hms}+09:00`).toISOString();
const PROPS = {
  hub_viewed: {},
  article_viewed: { article_id: 1, format: "general", content_type: "explainer" },
  article_engaged: { article_id: 1, format: "general", content_type: "explainer" },
  home_entry_clicked: {},
  next_action_clicked: { action: "same_section", screen: "article" },
};

/** 세션 하나 — 이벤트 [이름, 한국 날짜, 시각, 분야] */
async function seedSession({ visitor = crypto.randomUUID(), firstVisit = false, bot = false, staff = false, events }) {
  const sid = crypto.randomUUID();
  sessions.push(sid);
  for (const [name, date, hms, section = "tax"] of events) {
    await db.query(
      `insert into public.analytics_events (name, occurred_at, session_id, visitor_id, first_visit, stage, entry, section, props, is_bot, is_staff)
       values ($1, $2, $3, $4, $5, 1, 'direct', $6, $7, $8, $9)`,
      [name, kst(date, hms), sid, visitor, firstVisit, name === "next_action_clicked" ? null : section, JSON.stringify(PROPS[name]), bot, staff],
    );
  }
  return visitor;
}

/** 지난 날 가운데 앞뒤 40일 안에 이벤트가 하나도 없는 주 */
async function emptyWeek() {
  for (let i = 0; i < 20; i++) {
    const offset = 120 + Math.floor(Math.random() * 160);
    const day = new Date(Date.now() + 9 * 3_600_000 - offset * DAY).toISOString().slice(0, 10);
    const { rows } = await db.query("select count(*)::int n from public.analytics_events where occurred_at >= $1 and occurred_at < $2", [kst(addDays(day, -2), "00:00:00"), kst(addDays(day, 40), "00:00:00")]);
    if (rows[0].n === 0) return day;
  }
  throw new Error("비어 있는 시험 주를 찾지 못했다");
}

beforeAll(async () => {
  const j = localSupabase();
  db = new pg.Client({ connectionString: j.DB_URL });
  await db.connect();
  sb = createClient(j.API_URL, j.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  ({ loadMetricsDashboard: load } = await import("@/lib/server/analytics/metrics"));
  savedCutover = (await db.query("select value from public.settings where key = 'domain_cutover'")).rows[0]?.value;
  D1 = await emptyWeek();
  const d = (n) => addDays(D1, n);
  // 1 새 브라우저 — 홈 4대 분야 카드 → 지방세 허브 → 기사 31초 열람 → 다음 행동 (첫 방문 깔때기 세 칸 · 문제해결 · 지방세 유효 방문)
  const v1 = await seedSession({
    firstVisit: true,
    events: [
      ["home_entry_clicked", d(0), "10:00:00"],
      ["hub_viewed", d(0), "10:00:05"],
      ["article_viewed", d(0), "10:01:00"],
      ["article_engaged", d(0), "10:01:31"],
      ["next_action_clicked", d(0), "10:02:00"],
    ],
  });
  // 2 지방세 허브 → 기사 29초(30초 열람 이벤트 0) — 그날 23:59:59 (한국 날짜 경계 안)
  const v2 = await seedSession({ events: [["hub_viewed", d(0), "23:59:00"], ["article_viewed", d(0), "23:59:59"]] });
  // 3 부동산금융 허브 + 부동산 기사 30초 — 다른 분야 기사는 유효 방문 0 (셋째 날 — 전환일 나누기 시험)
  const v3 = await seedSession({ events: [["hub_viewed", d(2), "12:00:00", "finance"], ["article_engaged", d(2), "12:01:00", "realestate"]] });
  // 4·5 봇·편집국 — 무엇을 해도 0
  await seedSession({ bot: true, firstVisit: true, events: [["hub_viewed", d(0), "14:00:00"], ["article_engaged", d(0), "14:01:00"]] });
  await seedSession({ staff: true, events: [["hub_viewed", d(0), "15:00:00"], ["article_engaged", d(0), "15:01:00"]] });
  // 6 방문자 ID 없는 세션 — 유효 방문 분모에는 들고(세션), 재방문 분모에서는 빠진다
  await seedSession({ visitor: null, events: [["hub_viewed", d(1), "09:00:00", "local"]] });
  // 7 기간 끝 정각(끝날 다음 날 0시)에 시작 — 기간 밖
  await seedSession({ events: [["hub_viewed", d(7), "00:00:00"]] });
  // 재방문 — 1번 방문자 30일째(포함) · 2번 방문자 31일째(제외) · 3번 방문자 여드레 뒤(포함 — 기간 끝 뒤)
  await seedSession({ visitor: v1, events: [["article_viewed", d(30), "23:00:00"]] });
  await seedSession({ visitor: v2, events: [["hub_viewed", d(31), "00:00:00"]] });
  await seedSession({ visitor: v3, events: [["hub_viewed", d(10), "08:00:00", "finance"]] });
}, 120_000);

afterAll(async () => {
  if (sessions.length) await db.query("delete from public.analytics_events where session_id = any($1::uuid[])", [sessions]);
  if (savedCutover !== undefined) await db.query("update public.settings set value = $1::jsonb where key = 'domain_cutover'", [JSON.stringify(savedCutover)]);
  await db?.end();
});

const NOW = () => new Date();
const week = () => ({ period: "custom", from: D1, to: addDays(D1, 6) });

describe("대시보드 읽기 — 넣은 자료의 손 계산과 같다", () => {
  test("전환일 없음 — 한 구간(시험 기간), 분야별 유효 방문·재방문율·깔때기·빼는 세션", async () => {
    await db.query("update public.settings set value = $1::jsonb where key = 'domain_cutover'", [JSON.stringify({ version: "it-1", date: null })]);
    const dash = await load(sb, week(), NOW());
    expect(dash.periodError).toBeNull();
    expect(dash.cutover).toBeNull();
    expect(dash.result.kind).toBe("ok");
    const [m, ...rest] = dash.result.segments;
    expect(rest).toEqual([]);
    expect(m.segment).toMatchObject({ kind: "trial", from: D1, to: addDays(D1, 6) });
    expect(m.exclusions).toEqual({ sessions: 6, bot: 1, staff: 1 });
    expect(m.validVisits.sections).toEqual({
      tax: { numerator: 1, denominator: 2 },
      realestate: { numerator: 0, denominator: 0 },
      finance: { numerator: 0, denominator: 1 },
      local: { numerator: 0, denominator: 1 },
    });
    expect(m.validVisits.total).toEqual({ numerator: 1, denominator: 4 });
    expect(m.revisits.sections.tax).toEqual({ visitors: 2, revisited: 1, pending: 0 });
    expect(m.revisits.sections.finance).toEqual({ visitors: 1, revisited: 1, pending: 0 });
    expect(m.revisits.sections.local).toEqual({ visitors: 0, revisited: 0, pending: 0 });
    expect(m.revisits.total).toEqual({ visitors: 3, revisited: 2, pending: 0 });
    expect(m.revisits.withoutVisitor).toBe(1);
    expect(m.funnel).toEqual({ firstVisits: 1, entered: 1, engagedAction: 1, solved: 1 });
  });

  test("전환일이 기간 가운데면 시험 기간·운영을 따로 센다 (전환일 그날 0시부터 운영)", async () => {
    await db.query("update public.settings set value = $1::jsonb where key = 'domain_cutover'", [JSON.stringify({ version: "it-2", date: addDays(D1, 2) })]);
    const dash = await load(sb, week(), NOW());
    expect(dash.cutover).toBe(addDays(D1, 2));
    const [trial, live] = dash.result.segments;
    expect([trial.segment.kind, trial.segment.to, live.segment.kind, live.segment.from]).toEqual(["trial", addDays(D1, 1), "live", addDays(D1, 2)]);
    expect(trial.exclusions).toEqual({ sessions: 5, bot: 1, staff: 1 });
    expect(trial.validVisits.total).toEqual({ numerator: 1, denominator: 3 });
    expect(live.exclusions).toEqual({ sessions: 1, bot: 0, staff: 0 });
    expect(live.validVisits.sections.finance).toEqual({ numerator: 0, denominator: 1 });
    expect(live.revisits.sections.finance).toEqual({ visitors: 1, revisited: 1, pending: 0 });
    expect(trial.revisits.sections.finance.visitors).toBe(0);
  });

  test("틀린 전환일 설정은 전환일 없음으로 보고 알린다 · 틀린 기간 주소는 최근 30일과 이유", async () => {
    await db.query("update public.settings set value = $1::jsonb where key = 'domain_cutover'", [JSON.stringify({ version: "it-3", date: "다음 달" })]);
    const dash = await load(sb, { period: "custom", from: addDays(D1, 6), to: D1 }, NOW());
    expect(dash.cutover).toBeNull();
    expect(dash.cutoverProblem).toMatch(/^전환일 설정이 틀렸습니다/);
    expect(dash.periodError).toBe("시작일이 끝날보다 늦습니다");
    expect(dash.period).toMatchObject({ kind: "recent", days: 30 });
  });
});
