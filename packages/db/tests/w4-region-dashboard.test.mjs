// W4 25단계 DB — 지역 성과 대시보드·편집비 (docs/dev/W4_설계.md 1장 25단계 · 12장 #28, 마이그레이션 20261024000058 · REG1-15)
//  · region_editorial_costs — RLS 기본 거부(anon·authenticated 0), service_role 읽기·쓰기, 달은 1일만·금액 음수 거부·지역 없는 코드 거부·지역×달 하나
//  · region_news_facts / region_dashboard_metrics — 자체 취재 수·근거 확인 수·공개 중 아닌 기사·이관 기사·기간 밖 기사 제외
//  · 이동률 — 같은 지역 세금·부동산 이동이 있는 세션만, 다른 지역 이동은 안 센다 · 봇·편집국 세션은 세션째 제외
//  · region_returned — 한국 날짜 기준 30일째 포함 · 31일째 제외 · 같은 세션 두 번째 열람 제외 · 방문자 ID 없는 세션 제외 · 아직 30일이 안 지난 방문자는 pending
// 모든 시험은 거래 안에서 돌고 되돌린다 (남는 행 0). 자료는 2001년 한국 날짜로 넣어 다른 시험 자료와 섞이지 않게 한다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
});
after(async () => client?.end());

async function tx(fn) {
  await client.query("begin");
  try {
    return await fn();
  } finally {
    await client.query("rollback");
  }
}
async function attempt(sql, params = [], role = null) {
  await client.query("savepoint t");
  try {
    if (role) await client.query(`set local role ${role}`);
    const res = await client.query(sql, params);
    if (role) await client.query("reset role");
    await client.query("release savepoint t");
    return { ok: true, rows: res.rows, rowCount: res.rowCount };
  } catch (err) {
    await client.query("rollback to savepoint t");
    await client.query("reset role");
    await client.query("release savepoint t");
    return { ok: false, code: err.code };
  }
}

const kst = (date, hms) => new Date(`${date}T${hms}+09:00`).toISOString();
const FROM = kst("2001-03-01", "00:00:00");
const TO = kst("2001-04-01", "00:00:00");
const UNTIL = kst("2001-04-12", "00:00:00");
const regionCodes = async () => (await client.query("select code from public.regions where level = 'sido' order by code limit 2")).rows.map((r) => r.code);

async function metrics(today = "2001-04-12") {
  const { rows } = await client.query("select public.region_dashboard_metrics($1, $2, $3, $4::date) as m", [FROM, TO, UNTIL, today]);
  return Object.fromEntries(rows[0].m.regions.map((r) => [r.region_code, r]));
}
async function seed({ name = "region_viewed", date, hms = "12:00:00", rc, visitor = null, session, bot = false, staff = false, target }) {
  const props = { region_code: rc, ...(name === "region_viewed" ? { level: "sido" } : { target: target ?? "situation" }) };
  await client.query(
    `insert into public.analytics_events (name, occurred_at, session_id, visitor_id, first_visit, stage, entry, section, props, is_bot, is_staff)
     values ($1, $2, $3, $4, false, 1, 'direct', 'local', $5, $6, $7)`,
    [name, kst(date, hms), session ?? crypto.randomUUID(), visitor, JSON.stringify(props), bot, staff],
  );
}

test("편집비 표 — RLS 기본 거부(anon·authenticated 0), service_role 읽기·쓰기, 달 1일만·음수 금액·없는 지역 거부, 지역×달 하나", () =>
  tx(async () => {
    const [A] = await regionCodes();
    const rls = (await client.query("select relrowsecurity r from pg_class where oid = 'public.region_editorial_costs'::regclass")).rows[0].r;
    assert.equal(rls, true);
    const ins = "insert into public.region_editorial_costs (region_code, month, amount_krw, entered_by) values ($1, $2, $3, 'user:test')";
    assert.equal((await attempt(ins, [A, "2001-03-01", 1000], "service_role")).ok, true);
    assert.equal((await attempt("select amount_krw from public.region_editorial_costs", [], "service_role")).rows[0].amount_krw, "1000");
    assert.equal((await attempt("update public.region_editorial_costs set amount_krw = 2000 where region_code = $1", [A], "service_role")).rowCount, 1);
    for (const role of ["anon", "authenticated"]) {
      assert.equal((await attempt("select 1 from public.region_editorial_costs", [], role)).ok, false, `${role} 읽기`);
      assert.equal((await attempt(ins, [A, "2001-04-01", 1], role)).ok, false, `${role} 쓰기`);
    }
    assert.equal((await attempt(ins, [A, "2001-03-15", 1])).code, "23514", "1일이 아닌 달");
    assert.equal((await attempt(ins, [A, "2001-05-01", -1])).code, "23514", "음수 금액");
    assert.equal((await attempt(ins, ["0000000000", "2001-05-01", 1])).code, "23503", "없는 지역");
    assert.equal((await attempt(ins, [A, "2001-03-01", 5])).code, "23505", "같은 지역·달");
  }));

test("지표 함수 — 자체 취재 수·근거 확인 수, 공개 중 아닌 기사·이관 기사·기간 밖 기사·지역 태그 없는 기사 제외", () =>
  tx(async () => {
    const [A, B] = await regionCodes();
    await client.query("set local session_replication_role = replica"); // 발행 게이트 트리거 없이 사실 행만 만든다
    const art = async (o) =>
      (
        await client.query(
          `insert into public.articles (slug, title, section, content_type, status, origin, region_codes, first_published_at)
           values ($1, '지역 시험', 'local', $2, $3, $4, $5, $6) returning id`,
          [`rd-${crypto.randomUUID()}`, o.type ?? "reported_news", o.status ?? "published", o.origin ?? "new", o.regions ?? [A], o.at ?? kst("2001-03-10", "09:00:00")],
        )
      ).rows[0].id;
    const withEvidence = await art({});
    await art({}); // 근거 없음
    await art({ type: "explainer" }); // 자체 취재 아님
    await art({ status: "held" });
    await art({ origin: "legacy" });
    await art({ at: kst("2001-04-01", "00:00:00") }); // 기간 끝(제외)
    await art({ regions: [] });
    await art({ regions: [A, B] }); // 두 지역 모두 한 건씩
    await client.query(
      "insert into public.article_evidence (article_id, evidence_type, location, rights_status, verification_status) values ($1, 'dataset', '보관함/1', 'confirmed', 'verified'), ($1, 'interview', '보관함/2', 'confirmed', 'pending')",
      [withEvidence],
    );
    await client.query("set local session_replication_role = origin");
    const m = await metrics();
    assert.deepEqual([m[A].published, m[A].own, m[A].own_with_evidence], [4, 3, 1]);
    assert.deepEqual([m[B].published, m[B].own, m[B].own_with_evidence], [1, 1, 0]);
    assert.deepEqual([m[A].view_sessions, m[A].moved_sessions, m[A].visitors, m[A].returned], [0, 0, 0, 0]);
  }));

test("문제해결 이동률 — 같은 지역 세금·부동산 이동 세션만 분자, 다른 지역 이동·봇·편집국 세션 제외", () =>
  tx(async () => {
    const [A, B] = await regionCodes();
    const s = () => crypto.randomUUID();
    const d = "2001-03-05";
    const plain = s(), tax = s(), real = s(), other = s(), bot = s(), staff = s(), mixed = s();
    for (const id of [plain, tax, real, other]) await seed({ date: d, rc: A, session: id });
    await seed({ name: "region_to_tax_clicked", date: d, hms: "12:01:00", rc: A, session: tax, target: "situation" });
    await seed({ name: "region_to_realestate_clicked", date: d, hms: "12:01:00", rc: A, session: real, target: "supply" });
    await seed({ name: "region_to_tax_clicked", date: d, hms: "12:01:00", rc: B, session: other, target: "situation" }); // 다른 지역 이동
    await seed({ date: d, rc: A, session: bot, bot: true });
    await seed({ name: "region_to_tax_clicked", date: d, hms: "12:01:00", rc: A, session: bot, bot: true });
    await seed({ date: d, rc: A, session: staff, staff: true });
    await seed({ name: "region_to_tax_clicked", date: d, hms: "12:01:00", rc: A, session: staff, staff: true });
    // 한 세션 안에 한 이벤트라도 봇 표시면 세션째 뺀다
    await seed({ date: d, rc: A, session: mixed });
    await seed({ name: "region_to_tax_clicked", date: d, hms: "12:01:00", rc: A, session: mixed, bot: true });
    const m = await metrics();
    assert.equal(m[A].view_sessions, 4);
    assert.equal(m[A].moved_sessions, 2);
    assert.equal(m[B]?.view_sessions ?? 0, 0);
    assert.equal(m[B]?.moved_sessions ?? 0, 0);
  }));

test("region_returned — 30일째 포함·31일째 제외(한국 날짜), 같은 세션·방문자 ID 없음·봇 제외, 30일이 안 끝났으면 pending", () =>
  tx(async () => {
    const [A] = await regionCodes();
    const v30 = crypto.randomUUID(), v31 = crypto.randomUUID(), vSame = crypto.randomUUID(), vBot = crypto.randomUUID(), vOpen = crypto.randomUUID();
    const base = "2001-03-10";
    // 기준: 3월 10일 한국 날짜 → 30일째 = 4월 9일 (끝까지 포함), 31일째 = 4월 10일 0시 (제외)
    await seed({ date: base, rc: A, visitor: v30 });
    await seed({ date: "2001-04-09", hms: "23:59:59", rc: A, visitor: v30 });
    await seed({ date: base, rc: A, visitor: v31 });
    await seed({ date: "2001-04-10", hms: "00:00:00", rc: A, visitor: v31 });
    const same = crypto.randomUUID();
    await seed({ date: base, rc: A, visitor: vSame, session: same });
    await seed({ date: "2001-03-11", rc: A, visitor: vSame, session: same });
    await seed({ date: base, rc: A, visitor: vBot });
    await seed({ date: "2001-03-12", rc: A, visitor: vBot, bot: true });
    await seed({ date: "2001-03-30", rc: A, visitor: vOpen }); // 30일째 = 4월 29일 → 아직 안 끝남
    await seed({ date: base, rc: A }); // 방문자 ID 없음 — 재방문 분모에서 빠진다
    await seed({ date: "2001-04-02", rc: A, visitor: crypto.randomUUID() }); // 기간 끝(4월 1일) 뒤 처음 본 방문자는 이 기간 방문자가 아니다
    const m = (await metrics("2001-04-12"))[A];
    assert.equal(m.visitors, 5, "v30·v31·vSame·vBot·vOpen");
    assert.equal(m.returned, 1, "30일째 23:59:59만 재방문");
    assert.equal(m.pending, 1, "vOpen — 4월 29일까지 열려 있음");
    const later = (await metrics("2001-05-01"))[A];
    assert.equal(later.pending, 0, "30일이 모두 지나면 pending 0");
    assert.equal(later.returned, 1);
  }));
