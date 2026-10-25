// 바깥 연결 E2E (W3 1·2단계 — TX-01·FAM-08, docs/dev/W3_설계.md 1장 1·2단계 증거)
// standalone 빌드를 로컬 Supabase에 붙인다. 바깥 사이트는 부르지 않고 이 프로세스의 가짜 서버(127.0.0.1)만 쓴다. 주소·문구는 전부 시험용.
//  a) 권한·입력 — 기자 403 · http(s) 아닌 주소 422 · 주소를 모두 비우면 /calc에 카드 0·'준비 중' 0 · 기능 키 꺼짐이면 404
//  b) /calc — SM 카드 정확히 5장, 이동 주소 = 저장 주소 글자 단위 일치(쿼리·조각 0), 새 창 + noreferrer, iframe 0, 이용 조건 문구 그대로
//  c) 점검 배치 — 2xx ok · 404·500·시간 초과 broken · 같은 실행 키 두 번 = 기록 한 벌(가짜 서버 요청도 한 번) · 요청에 쿠키·Referer·인증 0
//  d) broken 카드는 이동 링크 대신 안내 + 대체 안내 · 복구되면 ok · 수동 점검 기록(점검자·방법) · 7일 전 경고 0 / 8일 전 1
// 만든 계정·실행 기록은 끝나면 지우고 연결 표는 시험 전 값으로 되돌린다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "tax-links-e2e@example.test";
const SITE = "https://e2e.example.test";
const SECRET = "tax-links-e2e-cron-secret";

let sb, server, staff, db, base, fake, fakeBase;
const u = {};
const hits = [];
const flip = { ok: false };
let snapshot = [];
const runIds = [];

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const show = (r) => JSON.stringify(r.body).slice(0, 600);
async function api(method, path, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const page = async (path) => {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, html: await res.text() };
};
async function setFeatures(on) {
  const current = (await one("select value from public.settings where key = 'feature_flags'")).value;
  const r = await api("PATCH", "/settings/feature_flags", u.admin, { value: Object.fromEntries(Object.keys(current).map((k) => [k, on.includes(k)])) });
  assert.equal(r.status, 200, show(r));
}
const linkId = async (kind, key) => Number((await one("select id from public.official_links where kind = $1 and key = $2", [kind, key])).id);
const setLink = (id, body) => api("POST", "/official-links", u.editor, { op: "update", id, ...body });
async function runJob() {
  const res = await fetch(`${base}/api/jobs/link-check`, { method: "POST", headers: { authorization: `Bearer ${SECRET}`, "x-job-trigger": "scheduler" } });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  runIds.push(body.runId);
  return (await one("select detail from public.agent_runs where id = $1", [body.runId])).detail;
}
const cardsOf = (html) => [...html.matchAll(/data-link-card="([^"]+)"/g)].map((m) => m[1]);
const hrefOf = (html, key) => new RegExp(`data-link-card="${key}"[\\s\\S]*?<a href="([^"]+)"[^>]*data-part="go"`).exec(html)?.[1] ?? null;

before(async () => {
  sb = localSupabase();
  fake = http.createServer((req, res) => {
    hits.push({ path: req.url, headers: req.headers });
    if (req.url.startsWith("/ok")) res.writeHead(200).end("ok");
    else if (req.url.startsWith("/missing")) res.writeHead(404).end("no");
    else if (req.url.startsWith("/boom")) res.writeHead(500).end("err");
    else if (req.url.startsWith("/flip")) res.writeHead(flip.ok ? 200 : 404).end("x");
    // /hang — 응답하지 않는다(시간 초과)
  });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  fakeBase = `http://127.0.0.1:${fake.address().port}`;
  buildWeb();
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    ADMIN_EMAILS: ADMIN_EMAIL,
    NEXT_PUBLIC_SITE_URL: SITE,
    CRON_SECRET: SECRET,
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  snapshot = (await db.query("select * from public.official_links order by id")).rows;
  // 앞 시험이 같은 주(실행 키)에 남긴 점검 기록이 있으면 첫 실행이 건너뛰어진다 - 이 시험이 다루는 연결의 기록은 처음에 비운다
  await db.query("delete from public.official_link_checks where link_id = any($1::bigint[])", [snapshot.map((x) => x.id)]);
  u.editor = await staff.createUser({ label: "links-editor", roles: ["editor"], person: { name: "연결 시험 편집자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "links-reporter", roles: ["reporter"], person: { name: "연결 시험 기자", roles: ["reporter"] } });
  u.admin = await staff.createUser({ label: "links-admin", email: ADMIN_EMAIL });
});

after(async () => {
  try {
    await db.query("delete from public.official_link_checks where link_id = any($1::bigint[])", [snapshot.map((s) => s.id)]);
    for (const s of snapshot) {
      await db.query(
        "update public.official_links set label=$2, url=$3, terms_note=$4, status=$5, checked_at=$6, check_method=$7, checked_by=$8, last_ok_at=$9, active=$10 where id=$1",
        [s.id, s.label, s.url, s.terms_note, s.status, s.checked_at, s.check_method, s.checked_by, s.last_ok_at, s.active],
      );
    }
    if (runIds.length) await db.query("delete from public.agent_runs where id = any($1::bigint[])", [runIds]);
    await staff?.cleanup();
  } finally {
    server?.stop();
    fake?.closeAllConnections?.();
    fake?.close();
  }
});

test("a) 권한·입력 — 기자 403 · 주소 형식 422 · 기능 키 꺼짐 404 · 주소가 모두 비면 카드 0과 '준비 중' 0", async () => {
  const id = await linkId("sm_calculator", "acquisition");
  assert.equal((await api("POST", "/official-links", u.reporter, { op: "update", id, label: "x" })).status, 403);
  assert.equal((await api("GET", "/official-links", u.reporter)).status, 403);
  for (const bad of ["ftp://a.test/x", "javascript:alert(1)", "//a.test", "a.test/x"]) {
    const r = await setLink(id, { url: bad });
    assert.equal(r.status, 422, `${bad}: ${show(r)}`);
  }
  assert.equal((await setLink(id, {})).status, 422, "바꿀 칸이 없으면 거부");
  const list = await api("GET", "/official-links", u.editor);
  assert.equal(list.status, 200);
  const byKind = (kinds) => list.body.links.filter((l) => kinds.includes(l.kind)).length;
  assert.equal(byKind(["sm_calculator", "external_calculator", "fallback"]), 8, "SM 5 + 외부 1 + 대체 2");
  assert.equal(byKind(["nts_guide", "law_center", "edu_site"]), 3, "W10-b 마이그레이션 84가 더한 국세청 안내·법령정보센터·교육원 3줄");
  assert.equal(list.body.links.length, 11, "그 밖의 종류 0");
  assert.ok(list.body.links.every((l) => l.url === null && l.status === "unchecked"), "시드는 주소 비움·점검 전");

  await setFeatures([]);
  assert.equal((await page("/calc")).status, 404, "calc 키 꺼짐");
  await setFeatures(["calc"]);
  const empty = await page("/calc");
  assert.equal(empty.status, 200);
  assert.deepEqual(cardsOf(empty.html), [], "주소가 모두 비면 카드 0");
  assert.ok(!empty.html.includes("준비 중"), "'준비 중' 카드 0");
});

test("b) /calc — SM 카드 정확히 5장·이동 주소 = 저장 주소·새 창 noreferrer·iframe 0·이용 조건 문구", async () => {
  const keys = ["acquisition", "property_tax", "transfer", "registration", "comprehensive"];
  const urls = {};
  for (const [i, key] of keys.entries()) {
    urls[key] = `${fakeBase}/${["ok", "ok", "missing", "boom", "hang"][i]}/${key}`;
    const r = await setLink(await linkId("sm_calculator", key), { url: urls[key], termsNote: `시험용 이용 조건 ${key}` });
    assert.equal(r.status, 200, show(r));
    assert.equal(r.body.link.status, "unchecked");
  }
  const ext = await setLink(await linkId("external_calculator", "inheritance_gift"), { url: `${fakeBase}/ok/ext` });
  assert.equal(ext.status, 200, show(ext));
  const wetax = await setLink(await linkId("fallback", "wetax"), { url: `${fakeBase}/ok/wetax` });
  assert.equal(wetax.status, 200, show(wetax));

  const { status, html } = await page("/calc");
  assert.equal(status, 200);
  // W10-b 허브: 세목 카드는 한 목록(tool-cards)이고, 게이트가 닫힌 동안은 SM 카드만 들어 있다 - 뒤에 오는 안내·바깥 계산기 영역 앞에서 끊는다
  const smBlock = /data-part="tool-cards"[\s\S]*?<\/ul>\s*(?=<ul data-part="in-site-tools"|<details|<section|<\/div>)/.exec(html)?.[0] ?? "";
  assert.deepEqual(cardsOf(smBlock), keys, "SM 카드 정확히 5장·순서");
  for (const key of keys) {
    assert.equal(hrefOf(html, key), urls[key], `${key} 이동 주소가 저장 주소와 글자 단위 일치`);
    assert.ok(html.includes(`시험용 이용 조건 ${key}`));
  }
  assert.ok(html.includes("SM 부동산 세금 플랫폼(별도 사이트) · 새 창"));
  assert.ok(html.includes(`data-link-card="inheritance_gift"`));
  assert.ok(!/<iframe/i.test(html), "iframe 0");
  assert.ok(!/fetch\(|XMLHttpRequest/.test(html.replace(/<script[\s\S]*?<\/script>/g, "") ), "화면 본문에 fetch 호출 0");
  const anchors = [...html.matchAll(/<a [^>]*data-part="go"[^>]*>/g)].map((m) => m[0]);
  assert.equal(anchors.length, 6);
  assert.ok(anchors.every((a) => /target="_blank"/.test(a) && /rel="noopener noreferrer"/.test(a)));
  assert.ok(anchors.every((a) => !/href="[^"]*[?#]/.test(a)), "쿼리·조각 0");
  assert.equal(hits.length, 0, "화면을 그리는 동안 바깥 서버 요청 0");
});

test("c) 점검 배치 — 2xx ok · 404·500·시간 초과 broken · 같은 실행 키 두 번 = 기록 한 벌·요청도 한 번 · 요청에 쿠키·Referer·인증 0", async () => {
  // 연속 2회 실패에 broken (FAM-04) - 지난 주 점검에서도 실패했다고 보고 실패 횟수를 1로 둔다
  await db.query("update public.official_links set fail_count = 1 where url is not null");
  const first = await runJob();
  assert.equal(first.targets, 7, `주소가 있는 활성 연결 7건 - ${JSON.stringify(first)}`);
  assert.equal(first.ok, 4, `acquisition·property_tax·외부·위택스 - ${JSON.stringify(first)}`);
  assert.equal(first.broken, 3, `404·500·시간 초과 - ${JSON.stringify(first)}`);
  assert.equal(first.skipped, 0, `첫 실행은 건너뜀 0 - ${JSON.stringify(first)}`);
  const st = Object.fromEntries((await db.query("select key, status, check_method, last_ok_at from public.official_links where url is not null")).rows.map((r) => [r.key, r]));
  assert.equal(st.acquisition.status, "ok");
  assert.equal(st.property_tax.status, "ok");
  assert.equal(st.transfer.status, "broken");
  assert.equal(st.registration.status, "broken");
  assert.equal(st.comprehensive.status, "broken", "응답 없음 = 시간 초과");
  assert.equal(st.acquisition.check_method, "auto");
  assert.ok(st.acquisition.last_ok_at && st.transfer.last_ok_at === null);
  assert.equal(hits.length, 7);
  for (const h of hits) {
    for (const name of ["cookie", "referer", "authorization", "x-forwarded-for"]) assert.equal(h.headers[name], undefined, `${h.path} 요청에 ${name} 0`);
    assert.equal(h.headers["user-agent"], "LTR-LinkCheck/1.0");
  }
  const rows = (await db.query("select count(*)::int as n, count(distinct link_id)::int as d from public.official_link_checks where method = 'auto' and run_key = $1", [first.runKey])).rows[0];
  assert.deepEqual(rows, { n: 7, d: 7 });

  const second = await runJob();
  assert.equal(second.runKey, first.runKey);
  assert.equal(second.skipped, 7);
  assert.equal(second.ok + second.broken, 0);
  assert.equal(hits.length, 7, "같은 실행 키 두 번째에는 바깥 요청 0");
  assert.equal((await one("select count(*)::int as n from public.official_link_checks where run_key = $1", [first.runKey])).n, 7, "점검 기록 한 벌");
});

test("d) broken 카드는 안내 + 대체 안내 · 복구되면 ok · 수동 점검 기록 · 7일 전 경고 0 / 8일 전 1", async () => {
  const { html } = await page("/calc");
  const block = (key) => new RegExp(`data-link-card="${key}"[\\s\\S]*?</li>\\s*(?=<li data-link-card|</ul>)`).exec(html)?.[0] ?? "";
  const broken = block("transfer");
  assert.match(broken, /data-link-status="broken"/);
  assert.ok(broken.includes("지금은 연결을 확인할 수 없습니다"));
  assert.ok(broken.includes(`${fakeBase}/ok/wetax`), "대체 안내 링크");
  assert.ok(!broken.includes('data-part="go"'), "끊긴 카드는 이동 링크 0");
  assert.ok(block("acquisition").includes('data-part="go"'));
  assert.match(block("acquisition"), /링크 확인일 \d{4}-\d{2}-\d{2}/);

  // 복구 — 주소를 상대가 고친 것으로 바꾸고(flip), 다음 주 점검(이 주 기록 지움)을 흉내
  const flipId = await linkId("sm_calculator", "transfer");
  assert.equal((await setLink(flipId, { url: `${fakeBase}/flip/transfer` })).status, 200);
  assert.equal((await one("select status from public.official_links where id = $1", [flipId])).status, "unchecked", "주소를 바꾸면 점검 전으로");
  flip.ok = false;
  await db.query("delete from public.official_link_checks where link_id = $1", [flipId]);
  assert.equal((await runJob()).broken, 1, "새 주소도 404 — broken");
  flip.ok = true;
  await db.query("delete from public.official_link_checks where link_id = $1", [flipId]);
  const recovered = await runJob();
  assert.equal(recovered.ok, 1);
  assert.equal((await one("select status from public.official_links where id = $1", [flipId])).status, "ok");
  assert.ok((await page("/calc")).html.includes(`href="${fakeBase}/flip/transfer"`));

  // 수동 점검
  assert.equal((await api("POST", "/official-links", u.reporter, { op: "manual_check", id: flipId, result: "ok" })).status, 403);
  assert.equal((await api("POST", "/official-links", u.editor, { op: "manual_check", id: flipId, result: "unchecked" })).status, 422);
  const noUrl = await linkId("fallback", "nts");
  assert.equal((await api("POST", "/official-links", u.editor, { op: "manual_check", id: noUrl, result: "ok" })).status, 409, "주소 없는 연결은 점검 불가");
  const manual = await api("POST", "/official-links", u.editor, { op: "manual_check", id: flipId, result: "broken" });
  assert.equal(manual.status, 200, show(manual));
  const m = await one("select status, check_method, checked_by from public.official_links where id = $1", [flipId]);
  assert.deepEqual({ status: m.status, method: m.check_method, by: m.checked_by }, { status: "broken", method: "manual", by: `user:${u.editor.id}` });
  const mrow = await one("select method, by, result from public.official_link_checks where link_id = $1 and method = 'manual'", [flipId]);
  assert.deepEqual({ ...mrow }, { method: "manual", by: `user:${u.editor.id}`, result: "broken" });

  // 7일 전 = 경고 0, 8일 전 = 경고 1 (이번 주 기록을 지워 두 건만 다시 점검하게)
  const a = await linkId("sm_calculator", "acquisition");
  const b = await linkId("sm_calculator", "property_tax");
  const ago = (d) => new Date(Date.now() - d * 86400_000).toISOString();
  await db.query("update public.official_links set checked_at = $2 where id = $1", [a, ago(7)]);
  await db.query("update public.official_links set checked_at = $2 where id = $1", [b, ago(8)]);
  await db.query("update public.official_links set checked_at = now() where id <> all($1::bigint[]) and url is not null", [[a, b]]);
  await db.query("delete from public.official_link_checks where link_id = any($1::bigint[])", [[a, b]]);
  const stale = await runJob();
  assert.equal(stale.staleBeforeRun, 1, "7일 전 점검은 경고 0, 8일 전 점검은 경고 1");
  assert.equal(stale.ok, 2, "그 두 건만 다시 점검");
});

test("e) 연속 실패 규칙 — 첫 실패는 이전 상태 유지(실패 횟수 1·pending), 다음 주에도 실패하면 broken(횟수 2), 성공하면 횟수 0", async () => {
  const id = await linkId("sm_calculator", "registration"); // 앞 시험에서 /boom(500) 주소가 저장돼 있다
  await db.query("update public.official_links set status = 'ok', fail_count = 0, last_ok_at = now() where id = $1", [id]);
  await db.query("delete from public.official_link_checks where link_id = $1", [id]);
  const state = async () => (await one("select status, fail_count from public.official_links where id = $1", [id]));

  const first = await runJob();
  assert.equal(first.pending, 1, `첫 실패는 pending - ${JSON.stringify(first)}`);
  assert.equal(first.broken, 0, "첫 실패는 broken이 아니다");
  assert.deepEqual({ ...(await state()) }, { status: "ok", fail_count: 1 }, "첫 실패는 이전 상태 유지 + 횟수 1");

  const sameWeek = await runJob();
  assert.equal(sameWeek.skipped, 7, "같은 주 재실행은 건너뜀");
  assert.deepEqual({ ...(await state()) }, { status: "ok", fail_count: 1 }, "같은 주 재실행은 횟수를 올리지 않는다");

  await db.query("delete from public.official_link_checks where link_id = $1", [id]); // 다음 주 점검을 흉내
  const second = await runJob();
  assert.equal(second.broken, 1, `연속 두 번째 실패는 broken - ${JSON.stringify(second)}`);
  assert.deepEqual({ ...(await state()) }, { status: "broken", fail_count: 2 });

  // 주소가 고쳐지면(성공) 횟수 0·ok로 복구
  assert.equal((await setLink(id, { url: `${fakeBase}/ok/registration` })).status, 200);
  await db.query("delete from public.official_link_checks where link_id = $1", [id]);
  const healed = await runJob();
  assert.equal(healed.ok, 1);
  assert.deepEqual({ ...(await state()) }, { status: "ok", fail_count: 0 });
});
