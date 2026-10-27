// W13-d DB - 알림·맞춤 브리핑 (마이그레이션 206·207·208, PRD-05 NOTI-01·WS-06)
//  · 수신 동의 없으면 0건 / 켠 시각 이전 기사 0 / 같은 기사 한 번(재실행·교차 종류) / 시·도 하위 포함 / 폐지 코드 후속 승계
//  · 비공개·유료·광고 기사 0 / 발송 창(일간 시각 경계·하루 1통·주간 요일·주간 브리핑 구독자는 웹만) / 실패 3회 상한
//  · 본인만 읽기 / 알림 표에 주소·좌표 칸 0 / 브리핑: 공개 항목만·같은 주차 1건·권한 없으면 0
// 글은 모두 시험용 가짜다. 모든 시험은 거래 안에서 돌고 되돌린다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돈다");
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
    return { ok: false, code: err.code, message: err.message };
  }
}
let seq = 0;
const uniq = (p) => `${p}-${process.pid}-${++seq}`;
async function insert(table, cols) {
  const k = Object.keys(cols);
  const sql = `insert into public.${table} (${k.join(", ")}) values (${k.map((_, i) => `$${i + 1}`).join(", ")}) returning *`;
  return (await client.query(sql, k.map((x) => cols[x]))).rows[0];
}
const para = (text) => JSON.stringify({ blocks: [{ type: "paragraph", text }], claims: [] });
const hoursAgo = (h) => new Date(Date.now() - h * 3600000);
const q = async (sql, params = []) => (await client.query(sql, params)).rows;

async function member({ region = null, kinds = ["region"], frequency = "daily", consent = true, briefing = "off", enabledHoursAgo = 48 } = {}) {
  const id = (await q("insert into auth.users (id) values (gen_random_uuid()) returning id"))[0].id;
  await q("insert into public.profiles (id, interest_region_codes) values ($1, $2)", [id, region ? [region] : []]);
  if (consent) await insert("consents", { user_id: id, kind: "receive", channel: "web_my", confirmed_at: new Date() });
  await q("insert into public.notification_prefs (user_id, kinds, frequency, briefing, enabled_at) values ($1, $2, $3, $4, $5)", [id, kinds, frequency, briefing, hoursAgo(enabledHoursAgo)]);
  return id;
}
async function fixture() {
  const reporter = await insert("people", { slug: uniq("p"), name: "알림 시험 기자", roles: ["reporter"], visibility: "public" });
  const article = (over) => insert("articles", { slug: uniq("a"), title: "시험용 알림 기사", section: "local", content_type: "explainer", status: "published", author_id: reporter.id, body: para("본문"), first_published_at: hoursAgo(1), ...over });
  const sido = (await q("select code from public.regions where level = 'sido' and (valid_to is null or valid_to >= current_date) order by code limit 1"))[0].code;
  const gu = await insert("regions", { code: `${sido.slice(0, 2)}9${String(++seq).padStart(2, "0")}00000`, parent_code: sido, level: "sigungu", slug: uniq("gu"), name: "알림시험구" });
  return { article, sido, gu };
}
const collect = async () => (await q("select public.noti_collect(now()) as r"))[0].r;
const rows = (uid) => q("select * from public.notifications where user_id = $1 order by id", [uid]);

test("지역 알림 - 같은 지역 기사만, 시·도를 고르면 하위 시·군·구 기사도, 다른 지역·비공개·유료·광고는 0", () =>
  tx(async () => {
    const f = await fixture();
    const u = await member({ region: f.sido });
    const inGu = await f.article({ region_codes: [f.gu.code] });
    await f.article({ region_codes: [] });
    await f.article({ region_codes: [f.gu.code], status: "draft" });
    await f.article({ region_codes: [f.gu.code], is_paid: true });
    await collect();
    const r = await rows(u);
    assert.deepEqual(r.map((x) => x.content_id), [`article:${inGu.id}`]);
    assert.equal(r[0].kind, "region");
    assert.equal(r[0].link, `/news/${inGu.slug}`);
  }));

test("같은 기사는 한 번만 - 수집을 다시 돌려도, 저장 검색 종류가 겹쳐도 1건", () =>
  tx(async () => {
    const f = await fixture();
    const u = await member({ region: f.gu.code, kinds: ["region", "saved_search"] });
    const a = await f.article({ region_codes: [f.gu.code], title: "시험용 겹침키워드" });
    await q("insert into public.entitlements (user_id, key, source, source_ref, valid_from, valid_until) values ($1, 'workspace', 'manual', $2, now() - interval '1 day', now() + interval '1 day')", [u, uniq("w13d")]);
    await q("insert into public.saved_searches (user_id, name, conditions, notify, created_at) values ($1, '시험', '{\"q\":\"겹침키워드\"}'::jsonb, true, now() - interval '3 days')", [u]);
    const first = await collect();
    const second = await collect();
    assert.equal((await rows(u)).filter((x) => x.content_id === `article:${a.id}`).length, 1);
    assert.equal(second.region + second.saved_search, 0);
    assert.ok(first.region + first.saved_search >= 1);
  }));

test("수신 동의가 없거나 철회됐거나 알림 종류가 비면 0건, 켠 시각 이전 기사 0", () =>
  tx(async () => {
    const f = await fixture();
    const noConsent = await member({ region: f.gu.code, consent: false });
    const revoked = await member({ region: f.gu.code });
    await q("update public.consents set revoked_at = now() where user_id = $1", [revoked]);
    const off = await member({ region: f.gu.code, kinds: [] });
    const late = await member({ region: f.gu.code, enabledHoursAgo: 0 });
    await q("update public.notification_prefs set enabled_at = now() where user_id = $1", [late]);
    await f.article({ region_codes: [f.gu.code], first_published_at: hoursAgo(2) });
    await collect();
    for (const u of [noConsent, revoked, off, late]) assert.equal((await rows(u)).length, 0);
  }));

test("폐지된 지역 코드는 후속 코드로 이어진다", () =>
  tx(async () => {
    const f = await fixture();
    const old = await insert("regions", { code: `${f.sido.slice(0, 2)}9${String(++seq).padStart(2, "0")}10000`, parent_code: f.sido, level: "sigungu", slug: uniq("old"), name: "폐지시험구" });
    const u = await member({ region: old.code });
    // 회원이 고른 뒤에 폐지된 코드 - 폐지 코드는 새로 고를 수 없으므로 선택 뒤에 폐지 처리한다
    await q("update public.regions set valid_to = '2020-01-01', successor_code = $1 where code = $2", [f.gu.code, old.code]);
    const a = await f.article({ region_codes: [f.gu.code] });
    await collect();
    assert.deepEqual((await rows(u)).map((x) => x.content_id), [`article:${a.id}`]);
  }));

test("알림 표에는 주소·좌표·본문 칸이 없다", async () => {
  const cols = (await q("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'notifications'")).map((r) => r.column_name);
  for (const bad of ["address", "lat", "lng", "latitude", "longitude", "body", "email", "coordinates"]) assert.ok(!cols.includes(bad), bad);
});

test("본인만 읽는다 - 다른 회원·anon은 0건, authenticated 쓰기 권한 없음", () =>
  tx(async () => {
    const f = await fixture();
    const a = await member({ region: f.gu.code });
    const b = await member({ region: f.gu.code });
    await f.article({ region_codes: [f.gu.code] });
    await collect();
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: a, role: "authenticated" })]);
    assert.equal((await attempt("select * from public.notifications", [], "authenticated")).rowCount, 1);
    assert.equal((await attempt("select * from public.notification_prefs", [], "authenticated")).rowCount, 1);
    assert.equal((await attempt("update public.notifications set read_at = now()", [], "authenticated")).ok, false);
    assert.equal((await attempt("select * from public.notifications", [], "anon")).ok, false);
    assert.ok(b);
  }));

test("발송 창 - 일간은 한국 08:00 정각부터, 하루 1통, 같은 날 다음 실행엔 0", () =>
  tx(async () => {
    const f = await fixture();
    const u = await member({ region: f.gu.code, frequency: "daily" });
    await f.article({ region_codes: [f.gu.code] });
    await collect();
    const due = async (iso) => (await q("select * from public.noti_due($1::timestamptz)", [iso])).length;
    assert.equal(await due("2026-10-26T22:59:00Z"), 0, "한국 07:59");
    assert.equal(await due("2026-10-26T23:00:00Z"), 1, "한국 08:00");
    const ids = (await rows(u)).map((x) => x.id);
    await q("select public.noti_mark($1::bigint[], 'mail', true, '2026-10-26T23:15:00Z')", [ids]);
    const b = await f.article({ region_codes: [f.gu.code] });
    await q("update public.notifications set created_at = created_at");
    await collect();
    assert.equal(await due("2026-10-27T01:00:00Z"), 0, "같은 한국 날짜에는 두 번째 묶음 없음");
    assert.equal(await due("2026-10-27T23:00:00Z"), (await rows(u)).filter((x) => !x.sent_at).length, "다음 날 다시 보낸다");
    assert.ok(b);
  }));

test("주간 빈도는 지정 요일(월)에만, 확인된 주간 브리핑 구독자는 메일 대신 웹만(mail=false)", () =>
  tx(async () => {
    const f = await fixture();
    const u = await member({ region: f.gu.code, frequency: "weekly" });
    const v = await member({ region: f.gu.code, frequency: "weekly" });
    const brief = await attempt("insert into public.consents (user_id, kind, channel, confirmed_at) values ($1, 'brief', 'web_my', now())", [v]);
    assert.equal(brief.ok, true, brief.message);
    await f.article({ region_codes: [f.gu.code] });
    await collect();
    const due = (iso) => q("select user_id, mail from public.noti_due($1::timestamptz)", [iso]);
    assert.equal((await due("2026-10-27T23:15:00Z")).length, 0, "한국 화요일");
    const mon = await due("2026-10-25T23:15:00Z");
    assert.equal(mon.find((r) => r.user_id === u).mail, true);
    const mv = mon.find((r) => r.user_id === v);
    assert.equal(mv.mail, false);
  }));

test("실패는 3회까지 다시 시도하고 그 뒤에는 대상에서 빠진다", () =>
  tx(async () => {
    const f = await fixture();
    const u = await member({ region: f.gu.code, frequency: "instant" });
    await f.article({ region_codes: [f.gu.code] });
    await collect();
    const id = (await rows(u))[0].id;
    for (let i = 0; i < 3; i++) {
      assert.equal((await q("select * from public.noti_due(now())")).filter((r) => r.user_id === u).length, 1, `시도 ${i}`);
      await q("select public.noti_mark($1::bigint[], 'mail', false, now())", [[id]]);
    }
    assert.equal((await q("select * from public.noti_due(now())")).filter((r) => r.user_id === u).length, 0);
  }));

test("설정 저장 - 수신 동의 없으면 거부, 처음 켤 때만 켠 시각을 정하고, 거부(unsubscribe)는 종류를 비운다", () =>
  tx(async () => {
    const id = (await q("insert into auth.users (id) values (gen_random_uuid()) returning id"))[0].id;
    assert.equal((await q("select public.noti_prefs_set($1, '{region}', 'daily', 'off') as r", [id]))[0].r.code, "no_consent");
    await insert("consents", { user_id: id, kind: "receive", channel: "web_my", confirmed_at: new Date() });
    assert.equal((await q("select public.noti_prefs_set($1, '{region}', 'daily', 'off') as r", [id]))[0].r.ok, true);
    const t1 = (await q("select enabled_at from public.notification_prefs where user_id = $1", [id]))[0].enabled_at;
    await q("select public.noti_prefs_set($1, '{region,law}', 'weekly', 'off')", [id]);
    assert.equal((await q("select enabled_at from public.notification_prefs where user_id = $1", [id]))[0].enabled_at.getTime(), t1.getTime());
    assert.equal((await q("select public.noti_prefs_set($1, '{bogus}', 'daily', 'off') as r", [id]))[0].r.code, "invalid");
    assert.equal((await q("select public.noti_unsubscribe($1) as r", [id]))[0].r, true);
    assert.deepEqual((await q("select kinds from public.notification_prefs where user_id = $1", [id]))[0].kinds, []);
    assert.equal((await q("select public.noti_unsubscribe($1) as r", [id]))[0].r, false);
  }));

test("권한 - 알림·브리핑 함수는 anon·authenticated가 실행할 수 없다", () =>
  tx(async () => {
    for (const sql of ["select public.noti_collect(now())", "select * from public.noti_due(now())", "select public.noti_unsubscribe(gen_random_uuid())"]) {
      assert.equal((await attempt(sql, [], "anon")).ok, false);
      assert.equal((await attempt(sql, [], "authenticated")).ok, false);
    }
  }));

test("브리핑 - 공개 기사만 담긴다(비공개·유료·모르는 종류·모양 오류 거부), 같은 주차는 1건, 권한·설정이 없으면 0", () =>
  tx(async () => {
    const f = await fixture();
    const u = await member({ kinds: [], briefing: "web" });
    await q("insert into public.entitlements (user_id, key, source, source_ref, valid_from, valid_until) values ($1, 'workspace', 'manual', $2, now() - interval '1 day', now() + interval '1 day')", [u, uniq("w13d")]);
    const pub = await f.article({});
    const draft = await f.article({ status: "draft" });
    const paid = await f.article({ is_paid: true });
    const item = (type, id, over = {}) => ({ type, id, reason: "interest", basis_on: "2026-10-26", ...over });
    const create = (items, period = "2026-W44", uid = u) => q("select public.briefing_create($1, $2, $3::jsonb, now()) as r", [uid, period, JSON.stringify(items)]);
    for (const bad of [draft, paid]) {
      const r = await attempt("select public.briefing_create($1, '2026-W44', $2::jsonb, now())", [u, JSON.stringify([item("article", bad.id)])]);
      assert.equal(r.ok, false, "비공개·유료 기사 거부");
    }
    assert.equal((await attempt("select public.briefing_create($1, '2026-W44', $2::jsonb, now())", [u, JSON.stringify([item("publication", 1)])])).ok, false, "출판물 종류 거부");
    assert.equal((await attempt("select public.briefing_create($1, '2026-W44', $2::jsonb, now())", [u, JSON.stringify([item("article", pub.id, { extra: 1 })])])).ok, false, "칸 추가 거부");
    assert.equal((await attempt("select public.briefing_create($1, '2026-W44', $2::jsonb, now())", [u, JSON.stringify([item("article", 99999999)])])).ok, false, "없는 번호 거부");
    assert.equal((await create([]))[0].r.code, "empty");
    const first = (await create([item("article", pub.id)]))[0].r;
    assert.equal(first.created, true);
    assert.equal((await create([item("article", pub.id)]))[0].r.created, false, "같은 주차 두 번째는 만들지 않음");
    assert.equal((await create([item("article", pub.id)], "2026-W45"))[0].r.created, true);
    const noEnt = await member({ kinds: [], briefing: "web" });
    assert.equal((await create([item("article", pub.id)], "2026-W44", noEnt))[0].r.code, "no_entitlement");
    const off = await member({ kinds: [], briefing: "off" });
    assert.equal((await create([item("article", pub.id)], "2026-W44", off))[0].r.code, "off");
  }));

test("브리핑 채널 - 메일 설정이라도 수신 동의가 없으면 웹, 열람 표시는 본인 것만", () =>
  tx(async () => {
    const f = await fixture();
    const withC = await member({ kinds: [], briefing: "mail" });
    const noC = await member({ kinds: [], briefing: "mail", consent: false });
    for (const u of [withC, noC]) await q("insert into public.entitlements (user_id, key, source, source_ref, valid_from, valid_until) values ($1, 'workspace', 'manual', $2, now() - interval '1 day', now() + interval '1 day')", [u, uniq("w13d")]);
    const pub = await f.article({});
    const items = JSON.stringify([{ type: "article", id: pub.id, reason: "region", basis_on: "2026-10-26" }]);
    const a = (await q("select public.briefing_create($1, '2026-W44', $2::jsonb, now()) as r", [withC, items]))[0].r;
    const b = (await q("select public.briefing_create($1, '2026-W44', $2::jsonb, now()) as r", [noC, items]))[0].r;
    assert.equal((await q("select channel from public.briefings where id = $1", [a.id]))[0].channel, "mail");
    assert.equal((await q("select channel from public.briefings where id = $1", [b.id]))[0].channel, "web");
    assert.equal((await q("select public.briefing_open($1, $2, now()) as r", [noC, a.id]))[0].r, null, "남의 브리핑은 열람 표시 불가");
    assert.equal((await q("select public.briefing_open($1, $2, now()) as r", [withC, a.id]))[0].r, "mail");
    assert.equal((await q("select public.briefing_mark_sent($1, now()) as r", [a.id]))[0].r, true);
    assert.equal((await q("select public.briefing_mark_sent($1, now()) as r", [a.id]))[0].r, false, "두 번 보냄 표시 불가");
  }));
