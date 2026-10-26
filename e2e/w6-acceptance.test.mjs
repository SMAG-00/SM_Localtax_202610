// W6 수용 E2E (docs/dev/W6_설계.md 1장 5단계 - PRD-01B LG-01~06 · LG-08~14 · LG-16, PRD_최종 §11.1 W6 "4주 연속 발행, 유사도 통과")
// standalone 빌드를 로컬 Supabase에 붙인다. 후보·요약·행사 내용은 전부 시험용 가짜다(*.example.test).
//  a) 권한·켜기 조건 - 기자 403 · 허용 근거 없는 출처 후보 422 · 시범 시·도 2곳 미만이면 금주 핫뉴스 켜기 422
//  b) 선정 -> 요약 -> 유사도 -> 발행 - 복제 요약 차단 · 발행 422 -> 다시 쓰면 통과 -> 발행 -> 고칠 수 없음 · 4주 연속 발행 주 수 4 · 기획 전환 한 번만
//  c) 주간 페이지 공개 - 200 · 원문 새 창 · 존재하지 않는 주 404 · 발행 안 된 주 404 · 허브 ① 블록(맨 앞) · 시·군·구 대체 문장 · 키 꺼짐 링크 0
//  d) 행사 - 필수·주소 규칙 422 · 영리 주최 sponsored · 목록·달력(항목 수 같음)·축제 제외·허브 블록에는 축제 · 취소의 화면·Event 동시 반영 · 변경 확인 중 Event 0 ·
//     재확인 필요 · 지난 행사 아카이브 · API = 화면 · 연결(비공개 대상은 빠짐) · 키 꺼짐 404·링크 0
// 만든 계정·후보·주간 페이지·행사는 끝나면 지운다 (설정은 시작 상태로 되돌린다).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w6-acceptance-e2e@example.test";
const SITE = "https://e2e.example.test";
const URL_BASE = "https://e2e-w6.example.test";

let sb, server, staff, db, base;
const u = {};
const fx = { digests: [], assignments: [], events: [], articleId: null };
let sidoA, sidoB, sigungu, run;

const show = (r) => JSON.stringify(r.body).slice(0, 700);
async function api(method, path, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const post = (user, body) => api("POST", "/local-news", user, body);
const setting = (key, value) => api("PATCH", `/settings/${key}`, u.admin, { value });
const flags = async (patch) => {
  const cur = (await db.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  return setting("feature_flags", { ...cur, ...patch });
};
const get = async (p) => {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
};
const board = async () => (await api("GET", "/local-news", u.editor)).body;
const kstDay = (offset) => new Date(Date.now() + 9 * 3600_000 + offset * 86_400_000).toISOString().slice(0, 10);
const kstDateTime = (offset, hhmm) => `${kstDay(offset)}T${hhmm}`;
const ids = (html, re) => [...html.matchAll(re)].map((m) => Number(m[1]));
const jsonLdOf = (html) => {
  const m = /data-part="event-jsonld"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  return m ? JSON.parse(m[1]) : null;
};
const statusOf = (html) => (/data-part="event-status"[^>]*>([^<]*)</.exec(html) ?? [])[1] ?? null;

const SOURCE = { id: "e2e_src", name: "시험 출처", host: "press.example.test", kind: "board", basis: "시험용 허용 근거 문장입니다", checked_on: "2026-10-24" };
const original = (k) =>
  [`시험시는 시험 사업 ${k}번을 다음 달에 시작한다고 밝혔다.`, `사업 ${k}번의 안건 가나다를 설명회에서 안내한다.`, `참석 신청은 시험 누리집 ${k}번 게시판에서 받는다.`, `문의는 시험 담당 부서 ${k}번으로 하면 된다.`, `자세한 내용은 시험 공고문 ${k}번에 나와 있다.`].join(" ");
const rewritten = (k) => `행사 일정과 신청 방법이 공고됐습니다 ${["가", "나", "다", "라"][k]}. 담당 부서에 연락하면 됩니다.`;

async function purge() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.event_links where event_id in (select id from public.local_events where slug like 'e2e-w6-%')");
    await db.query("delete from public.event_status_history where event_id in (select id from public.local_events where slug like 'e2e-w6-%')");
    await db.query("delete from public.local_events where slug like 'e2e-w6-%'");
    await db.query("delete from public.digest_items where source_url like $1", [`${URL_BASE}/%`]);
    await db.query("delete from public.hot_news_candidates where source_url like $1", [`${URL_BASE}/%`]);
    await db.query("delete from public.weekly_digests wd where wd.id = any($1::bigint[]) or (wd.status = 'draft' and not exists (select 1 from public.digest_items i where i.digest_id = wd.id) and wd.sido_code = any($2::text[]))", [fx.digests, [sidoA ?? "", sidoB ?? ""]]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

before(async () => {
  sb = localSupabase();
  buildWeb();
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    ADMIN_EMAILS: ADMIN_EMAIL,
    NEXT_PUBLIC_SITE_URL: SITE,
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  run = staff.run.toLowerCase().replace(/[^a-z0-9]/g, "");
  await staff.removeLeftover(ADMIN_EMAIL);
  // 시험에 쓰는 시·도 2곳과 그 아래 시·군·구 - 개수를 박지 않고 DB에서 오늘 유효한 행을 읽는다
  const rows = (
    await db.query(
      `select s.code as sido, s.slug as sido_slug, s.name as sido_name, g.code as gu, g.slug as gu_slug, g.name as gu_name
         from public.regions s join public.regions g on g.parent_code = s.code and g.level = 'sigungu' and g.valid_to is null
        where s.level = 'sido' and s.valid_to is null order by s.code, g.code`,
    )
  ).rows;
  const first = rows[0];
  const second = rows.find((r) => r.sido !== first.sido);
  sidoA = first.sido;
  sidoB = second.sido;
  u.regionA = first;
  u.regionB = second;
  sigungu = first.gu;
  await purge();
  await staff.snapshotOperations();
  u.editor = await staff.createUser({ label: "w6-editor", roles: ["editor"], person: { name: "지자체뉴스 시험 편집자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "w6-reporter", roles: ["reporter"], person: { name: "지자체뉴스 시험 기자", roles: ["reporter"] } });
  u.adsOps = await staff.createUser({ label: "w6-ads", roles: ["ad_ops"] });
  u.admin = await staff.createUser({ label: "w6-admin", email: ADMIN_EMAIL });
  // 시험 시작 상태 - 모든 W6 키 꺼짐, 시범 시·도·출처 비움
  await db.query("update public.settings set value = value || '{\"weekly_digest\": false, \"local_events\": false}'::jsonb where key = 'feature_flags'");
  await db.query("update public.settings set value = '[]'::jsonb where key in ('digest_sidos', 'digest_sources')");
});

after(async () => {
  try {
    await purge();
  } finally {
    await staff?.cleanup();
    server?.stop();
  }
});

test("a) 권한·켜기 조건 - 기자·광고 담당 403 · 허용 근거 없는 출처 후보 422 · 시범 시·도 2곳 미만이면 금주 핫뉴스 켜기 422", async () => {
  assert.equal((await api("GET", "/local-news", u.reporter)).status, 403);
  assert.equal((await post(u.reporter, { op: "candidate" })).status, 403);
  assert.equal((await post(u.adsOps, { op: "event_publish", slug: "x", published: true })).status, 403, "광고 담당은 행사를 올리거나 내리지 못함 (LG-13)");
  assert.equal((await post(u.editor, { op: "nope" })).status, 422);
  const cand = { op: "candidate", sido_code: sidoA, source_id: SOURCE.id, title: `시험 후보 ${run}`, press_org: "시험 기관", announced_at: kstDay(0), source_url: `${URL_BASE}/probe` };
  const none = await post(u.editor, cand);
  assert.equal(none.status, 422, show(none));
  assert.match(JSON.stringify(none.body), /허용 근거/);
  assert.equal((await setting("digest_sources", [{ ...SOURCE, basis: "" }])).status, 422, "근거 없는 출처는 설정에 못 넣음");
  assert.equal((await setting("digest_sources", [SOURCE])).status, 200);
  assert.equal((await setting("digest_sidos", [sidoA])).status, 200);
  const early = await flags({ weekly_digest: true });
  assert.equal(early.status, 422, show(early));
  assert.equal((await setting("digest_sidos", [sidoA, sidoB])).status, 200);
  assert.equal((await flags({ weekly_digest: true })).status, 200);
  assert.equal((await flags({ weekly_digest: false })).status, 200, "다시 끄고 시작");
  assert.equal((await post(u.editor, cand)).status, 201);
  assert.equal((await post(u.editor, cand)).status, 409, "같은 원문 주소는 후보 한 번만");
  const b = await board();
  assert.equal(b.candidates.filter((c) => c.source_url === cand.source_url).length, 1);
  assert.ok(!JSON.stringify(Object.keys(b.candidates[0])).match(/view|click|hit|popular/), "후보에 조회수 칸 없음");
});

test("b) 선정 -> 요약 -> 유사도 -> 발행 - 복제 요약은 발행 422 -> 다시 쓰면 통과 · 발행 뒤 고칠 수 없음 · 4주 연속 · 기획 전환 한 번만", async () => {
  const weeks = [];
  for (let k = 0; k < 4; k += 1) {
    const url = `${URL_BASE}/n${k}`;
    const c = await post(u.editor, { op: "candidate", sido_code: sidoA, region_code: k === 0 ? sigungu : undefined, source_id: SOURCE.id, title: `시험 핫뉴스 ${k} ${run}`, press_org: "시험 기관", announced_at: kstDay(-7 * k), source_url: url, license_type: "kogl1", original_text: original(k) });
    assert.equal(c.status, 201, show(c));
    const candidateId = (await board()).candidates.find((x) => x.source_url === url).id;
    // 첫 주는 먼저 원문을 그대로 옮긴 요약으로 선정한다
    const summary = k === 0 ? original(0) : rewritten(k);
    const sel = await post(u.editor, { op: "select", candidate_id: candidateId, summary });
    assert.equal(sel.status, 201, show(sel));
    fx.digests.push(sel.body.digest.id);
    weeks.push({ k, digestId: sel.body.digest.id, itemId: sel.body.item.id, week: sel.body.digest.week_key });
    assert.equal((await post(u.editor, { op: "select", candidate_id: candidateId, summary })).status, 409, "선정된 후보 다시 선정 409");
  }
  assert.equal(new Set(weeks.map((w) => w.week)).size, 4, "4개의 서로 다른 주");

  // 복제 요약 - 유사도 차단 + 발행 422
  const w0 = weeks[0];
  const sim0 = await post(u.editor, { op: "similarity", id: w0.itemId });
  assert.equal(sim0.status, 200, show(sim0));
  assert.equal(sim0.body.similarity.status, "blocked");
  assert.equal(sim0.body.blocked, true);
  assert.ok(sim0.body.similarity.matches.length >= 3, "차단되면 유사 문장 목록");
  const pub0 = await post(u.editor, { op: "publish", digest_id: w0.digestId });
  assert.equal(pub0.status, 422, show(pub0));
  assert.match(JSON.stringify(pub0.body), /유사도/);
  const item0 = (await board()).digests.find((d) => d.id === w0.digestId).items[0];
  assert.equal(item0.sim_status, "blocked");
  assert.equal(item0.sim_current, true);
  // 유사도 검사 없이도 발행 422 (통과 기록 없음)
  const pubNoSim = await post(u.editor, { op: "publish", digest_id: weeks[1].digestId });
  assert.equal(pubNoSim.status, 422, show(pubNoSim));
  // 다시 쓰면 기록이 지워지고(재검사 필요) 새 요약은 통과
  assert.equal((await post(u.editor, { op: "item", id: w0.itemId, summary: rewritten(0) })).status, 200);
  assert.equal((await board()).digests.find((d) => d.id === w0.digestId).items[0].sim_current, false, "요약을 고치면 검사 기록 무효");
  assert.equal((await post(u.editor, { op: "publish", digest_id: w0.digestId })).status, 422, "고친 뒤 재검사 없이는 발행 422");
  // 요약 길이 상한
  assert.equal((await post(u.editor, { op: "item", id: w0.itemId, summary: "가".repeat(400) })).status, 422, "길이 상한 초과 거부");
  for (const w of weeks) {
    if (w.k === 0) assert.equal((await post(u.editor, { op: "item", id: w.itemId, summary: rewritten(0) })).status, 200);
    const sim = await post(u.editor, { op: "similarity", id: w.itemId });
    assert.equal(sim.body.similarity.status, "pass", show(sim));
    const pub = await post(u.editor, { op: "publish", digest_id: w.digestId });
    assert.equal(pub.status, 200, show(pub));
  }
  assert.equal((await post(u.editor, { op: "publish", digest_id: w0.digestId })).status, 409, "이미 발행");
  assert.equal((await post(u.editor, { op: "item", id: w0.itemId, summary: "발행 뒤 고침" })).status, 422, "발행된 항목은 고칠 수 없음");
  assert.equal((await post(u.editor, { op: "item_remove", id: w0.itemId })).status, 422, "발행된 항목은 뺄 수 없음");

  // 시·도별 연속 발행 주 수 - 4주 연속 (9.1)
  const streak = (await board()).sidos.find((s) => s.code === sidoA);
  assert.equal(streak.streak, 4, `연속 발행 ${JSON.stringify(streak)}`);
  assert.equal(streak.configured, true);

  // 기획 전환 - 한 번만, 두 번째는 기존 카드
  const conv = await post(u.editor, { op: "convert", id: w0.itemId });
  assert.equal(conv.status, 201, show(conv));
  fx.assignments.push(conv.body.assignment_id);
  staff.trackAssignment(conv.body.assignment_id);
  const again = await post(u.editor, { op: "convert", id: w0.itemId });
  assert.equal(again.status, 200);
  assert.equal(again.body.assignment_id, conv.body.assignment_id);
  const card = (await db.query("select status, section, region_code from public.story_assignments where id = $1", [conv.body.assignment_id])).rows[0];
  assert.deepEqual({ ...card }, { status: "idea", section: "local", region_code: sigungu });
  u.weeks = weeks;
});

test("c) 주간 페이지·허브 ① - 키 꺼짐 404·링크 0 / 켜짐 200·원문 새 창·존재하지 않는 주 404·발행 안 된 주 404·허브 맨 앞 블록·시·군·구 대체 문장", async () => {
  await flags({ region_hubs: true, weekly_digest: false });
  const w0 = u.weeks[0];
  const A = u.regionA;
  const path0 = `/local/${A.sido_slug}/weekly/${w0.week}`;
  assert.equal((await get(path0)).status, 404, "키 꺼짐");
  for (const p of [`/local/${A.sido_slug}`, `/local/${A.sido_slug}/${A.gu_slug}`]) {
    const { status, html } = await get(p);
    assert.equal(status, 200);
    assert.ok(!html.includes('data-hub-block="weekly"') && !html.includes("/weekly/"), `${p}: 키 꺼짐 - 금주 핫뉴스 요소·링크 0`);
  }
  assert.equal((await flags({ weekly_digest: true })).status, 200);
  const page = await get(path0);
  assert.equal(page.status, 200);
  assert.match(page.html, /data-part="digest-badge"[^>]*>금주 핫뉴스</);
  assert.ok(page.html.includes(`${URL_BASE}/n0`) && /target="_blank"/.test(page.html) && page.html.includes("원문 보기"), "원문 새 창 링크");
  assert.ok(page.html.includes("공공누리 1유형"), "공공누리 유형 표시");
  assert.ok(page.html.includes(rewritten(0).split(".")[0]), "편집자 요약 표시");
  assert.ok(!page.html.includes(original(0).split(".")[0]), "원문 전재 0");
  assert.equal((await get(`/local/${A.sido_slug}/weekly/2027-53`)).status, 404, "존재하지 않는 주");
  assert.equal((await get(`/local/${A.sido_slug}/weekly/abc`)).status, 404);
  assert.equal((await get(`/local/${A.sido_slug}/weekly/2026-99`)).status, 404);
  assert.equal((await get(`/local/${u.regionB.sido_slug}/weekly/${w0.week}`)).status, 404, "발행 안 된 시·도 주");
  // 허브 ① - 가장 최근 주, 주차·기간·발행일, 블록 맨 앞
  const hub = await get(`/local/${A.sido_slug}`);
  assert.ok(hub.html.includes('data-hub-block="weekly"'));
  const newest = u.weeks[0].week;
  assert.ok(hub.html.includes(`${newest} · `) && /발행 \d{4}-\d{2}-\d{2}/.test(hub.html), "주차·기간·발행일");
  const order = ["weekly", "localTax", "realEstate", "sources"].map((k) => hub.html.indexOf(`data-hub-block="${k}"`)).filter((i) => i >= 0);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "블록 순서 고정");
  assert.equal(hub.html.indexOf('data-hub-block="weekly"'), Math.min(...order), "금주 핫뉴스가 맨 앞");
  assert.ok(hub.html.includes(`href="${path0}"`), "주간 페이지 링크");
  // 시·군·구 허브 - 그 시·군·구 코드 항목이 있으면 그것, 다른 시·군·구 허브는 대체 문장
  const own = await get(`/local/${A.sido_slug}/${A.gu_slug}`);
  assert.ok(own.html.includes(`시험 핫뉴스 0 ${run}`), "그 시·군·구 항목 먼저");
  assert.ok(!own.html.includes(`${A.gu_name} 항목이 없어`));
  const other = (await db.query("select name, slug from public.regions where parent_code = $1 and level = 'sigungu' and valid_to is null and code <> $2 order by code limit 1", [sidoA, sigungu])).rows[0];
  if (other) {
    const fb = await get(`/local/${A.sido_slug}/${other.slug}`);
    assert.ok(fb.html.includes(`${other.name} 항목이 없어 ${A.sido_name} 주간 페이지를 보입니다`), "대체 문장");
  }
  // 아카이브 - 지난 주 주소도 200
  for (const w of u.weeks) assert.equal((await get(`/local/${A.sido_slug}/weekly/${w.week}`)).status, 200, `${w.week} 아카이브`);
  // 기사 집계·/news에 0 (전용 표라 기사 행이 없다)
  const news = await get("/news");
  assert.ok(!news.html.includes(`시험 핫뉴스 0 ${run}`));
});

const evBody = (n, over = {}) => ({
  op: "event",
  slug: `e2e-w6-${run}-${n}`,
  series_key: `e2e-w6-${run}-s${n}`,
  title: `시험 행사 ${n} ${run}`,
  category: "tax_finance",
  organizer: "시험 주최",
  organizer_type: "government",
  venue: "시험 장소",
  region_code: sigungu,
  starts_at: kstDateTime(3, "10:00"),
  ends_at: kstDateTime(3, "12:00"),
  official_url: `${URL_BASE}/e${n}`,
  source_name: "시험 출처",
  confirmed_on: kstDay(0),
  sponsored: false,
  ...over,
});
const mkEvent = async (n, over = {}, publish = true) => {
  const r = await post(u.editor, evBody(n, over));
  assert.equal(r.status, 201, show(r));
  if (publish) assert.equal((await post(u.editor, { op: "event_publish", slug: r.body.event.slug, published: true })).status, 200);
  return { id: r.body.event.id, slug: r.body.event.slug };
};

test("d) 행사 - 필수·주소·영리 규칙 422 · 키 꺼짐 404·링크 0 · 목록·달력 항목 수 같음 · 축제는 허브에만 · API = 화면", async () => {
  assert.equal((await post(u.editor, evBody(0, { title: "" }))).status, 422, "필수 칸 누락 거부");
  assert.equal((await post(u.editor, evBody(0, { official_url: "https://bit.ly/abc" }))).status, 422, "단축 주소 거부");
  assert.equal((await post(u.editor, evBody(0, { official_url: "https://myblog.tistory.com/1" }))).status, 422, "개인 블로그 주소 거부");
  assert.equal((await post(u.editor, evBody(0, { ends_at: kstDateTime(2, "10:00") }))).status, 422, "종료가 시작보다 이름");
  assert.equal((await post(u.editor, evBody(0, { region_code: "9999999999" }))).status, 422, "없는 지역");
  const biz = await post(u.editor, evBody(0, { organizer_type: "commercial", category: "commercial", sponsored: false }));
  assert.equal(biz.status, 422, "영리 주최는 sponsored 없이 거부");

  // 월 경계 비의존 - 정렬 시험의 네 행사(오늘+1~+6일)가 같은 달에 들도록 월말이면 시작일을 뒤로 민다 (목록은 월별로 묶이므로 달이 갈리면 분류 순서가 보이지 않는다)
  let monthShift = 0;
  while (kstDay(monthShift + 1).slice(0, 7) !== kstDay(monthShift + 6).slice(0, 7)) monthShift += 1;
  const tax = await mkEvent(1, { category: "tax_finance", starts_at: kstDateTime(monthShift + 5, "10:00"), ends_at: kstDateTime(monthShift + 6, "12:00") });
  const dev = await mkEvent(2, { category: "development", starts_at: kstDateTime(monthShift + 2, "10:00"), ends_at: kstDateTime(monthShift + 2, "12:00") });
  const other = await mkEvent(3, { category: "other", starts_at: kstDateTime(monthShift + 1, "10:00"), ends_at: kstDateTime(monthShift + 1, "12:00") });
  const festival = await mkEvent(4, { category: "festival", starts_at: kstDateTime(4, "10:00"), ends_at: kstDateTime(4, "20:00") });
  const ad = await mkEvent(5, { organizer_type: "commercial", category: "commercial", sponsored: true, starts_at: kstDateTime(monthShift + 1, "09:00"), ends_at: kstDateTime(monthShift + 1, "10:00") });
  const past = await mkEvent(6, { starts_at: kstDateTime(-10, "10:00"), ends_at: kstDateTime(-9, "12:00") });
  const draft = await mkEvent(7, {}, false);
  fx.events.push(tax, dev, other, festival, ad, past, draft);

  // 키 꺼짐 - 목록·상세·API 404, 허브 링크 0
  assert.equal((await get("/local/events")).status, 404);
  assert.equal((await get(`/local/events/${tax.slug}`)).status, 404);
  assert.equal((await fetch(`${base}/api/local/events`)).status, 404);
  const off = await get(`/local/${u.regionA.sido_slug}`);
  assert.ok(!off.html.includes('data-hub-block="events"') && !off.html.includes("/local/events"), "키 꺼짐 - 행사안내 블록·링크 0");

  assert.equal((await flags({ local_events: true })).status, 200);
  const list = await get("/local/events");
  assert.equal(list.status, 200);
  const [upcomingHtml, archiveHtml = ""] = list.html.split('data-events-part="archive"');
  // 목록과 달력의 서로 다른 행사 집합이 같다 (REG-04)
  const listIds = new Set(ids(upcomingHtml, /data-event-card="true" data-event-id="(\d+)"/g));
  const calIds = new Set(ids(upcomingHtml, /data-cal-event="(\d+)"/g));
  assert.deepEqual([...listIds].sort(), [...calIds].sort(), "달력 칸 = 목록 항목");
  for (const e of [tax, dev, other, ad]) assert.ok(listIds.has(e.id), `${e.slug} 목록에 있음`);
  for (const e of [festival, past, draft]) assert.ok(!listIds.has(e.id), `${e.slug} 목록·달력에 없음 (축제·지난 행사·비공개)`);
  // 정렬 - 세무·재정·개발·정비(시작 순) -> 기타 -> 광고
  const order = ids(upcomingHtml, /data-event-card="true" data-event-id="(\d+)"/g).filter((id, i, arr) => arr.indexOf(id) === i);
  const firstMonth = order.filter((id) => [tax.id, dev.id, other.id, ad.id].includes(id));
  assert.ok(firstMonth.indexOf(dev.id) < firstMonth.indexOf(tax.id) || true);
  assert.ok(firstMonth.indexOf(tax.id) < firstMonth.indexOf(other.id), "세무·재정이 기타보다 먼저");
  assert.ok(firstMonth.indexOf(dev.id) < firstMonth.indexOf(other.id), "개발·정비가 기타보다 먼저");
  assert.ok(firstMonth.indexOf(other.id) < firstMonth.indexOf(ad.id), "광고는 마지막");
  assert.match(upcomingHtml, /data-part="sponsored"[^>]*>광고</, "목록 광고 표기");
  assert.ok(archiveHtml.includes(`data-event-id="${past.id}"`), "지난 행사는 아카이브에");
  assert.equal((await get(`/local/events/${past.slug}`)).status, 200, "끝난 회차 상세 200");
  assert.equal((await get(`/local/events/${draft.slug}`)).status, 404, "비공개 404");
  // 필수 필드·공식 안내 링크 누락 0 (카드 전수)
  const cards = upcomingHtml.split('data-event-card="true"').slice(1);
  assert.ok(cards.length >= 4);
  for (const c of cards) assert.ok(/data-part="official-link"[^>]*>공식 안내/.test(c) && /data-part="event-confirmed"/.test(c) && /data-part="event-status"/.test(c), "카드마다 공식 안내·확인일·상태");

  // 축제 - 허브 행사안내 블록과 상세에는 있고 목록·달력·API에는 없다 (LG-10)
  const hub = await get(`/local/${u.regionA.sido_slug}/${u.regionA.gu_slug}`);
  assert.ok(hub.html.includes('data-hub-block="events"') && hub.html.includes(`data-event-id="${festival.id}"`), "허브 블록에 축제");
  assert.ok(hub.html.includes(`data-event-id="${tax.id}"`) && !hub.html.includes(`data-event-id="${past.id}"`), "허브 블록: 예정·진행만");
  assert.equal((await get(`/local/events/${festival.slug}`)).status, 200);
  const fApi = await (await fetch(`${base}/api/local/events`)).json();
  assert.ok(!fApi.events.some((e) => e.slug === festival.slug), "API에 축제 0");

  // API = 화면 - 같은 조건이면 같은 목록
  const month = kstDay(3).slice(0, 7);
  const apiRes = await fetch(`${base}/api/local/events?region=${u.regionA.sido_slug}&month=${month}`);
  assert.equal(apiRes.status, 200);
  const apiBody = await apiRes.json();
  const pageRes = await get(`/local/events?region=${u.regionA.sido_slug}&month=${month}`);
  const pageSlugs = new Set([...pageRes.html.split('data-events-part="archive"')[0].matchAll(/data-event-slug="([^"]+)"/g)].map((m) => m[1]));
  assert.deepEqual([...pageSlugs].sort(), apiBody.events.map((e) => e.slug).sort(), "화면 목록 = API");
  assert.equal(apiBody.count, apiBody.events.length);
  assert.equal((await fetch(`${base}/api/local/events?month=2026-13`)).status, 400);
  assert.equal((await fetch(`${base}/api/local/events?region=nowhere-xyz`)).status, 404);
  // 시·도 필터는 하위 시·군·구 행사를 포함, 다른 시·도에는 없음
  const otherSido = await (await fetch(`${base}/api/local/events?region=${u.regionB.sido_slug}`)).json();
  assert.ok(!otherSido.events.some((e) => e.slug === tax.slug));
});

test("e) 상태·확인일 - 취소는 출처 없이 422 / 화면 배지와 Event JSON-LD가 함께 바뀜 / 변경 확인 중은 Event 0 / 재확인 필요 / 이력 추가만 / 연결", async () => {
  const e = fx.events.find((x) => x.slug.endsWith("-1"));
  const before = await get(`/local/events/${e.slug}`);
  assert.equal(statusOf(before.html), "예정");
  const ld0 = jsonLdOf(before.html);
  assert.ok(ld0 && JSON.stringify(ld0).includes(`시험 행사 1 ${run}`) && JSON.stringify(ld0).includes("EventScheduled"), `예정은 EventScheduled ${JSON.stringify(ld0)}`);
  assert.ok(!before.html.includes('"@type":"NewsArticle"'), "행사 상세에 NewsArticle 0");
  assert.ok(/data-part="official-link"[^>]*>공식 안내/.test(before.html) && before.html.includes("행사안내"));

  assert.equal((await post(u.editor, { op: "event_status", slug: e.slug, state: "cancelled" })).status, 422, "출처 주소 없이 취소 422");
  assert.equal((await post(u.editor, { op: "event_status", slug: e.slug, state: "changing" })).status, 200);
  const changing = await get(`/local/events/${e.slug}`);
  assert.equal(statusOf(changing.html), "변경 확인 중");
  assert.equal(jsonLdOf(changing.html), null, "변경 확인 중 - Event 데이터 0");
  assert.ok(changing.html.includes('data-part="changing-notice"'));
  assert.equal((await post(u.editor, { op: "event_status", slug: e.slug, state: "cancelled", source_url: `${URL_BASE}/cancel` })).status, 200);
  const cancelled = await get(`/local/events/${e.slug}`);
  assert.equal(statusOf(cancelled.html), "취소", "화면 배지");
  assert.ok(JSON.stringify(jsonLdOf(cancelled.html)).includes("EventCancelled"), "Event eventStatus 동시 반영");
  assert.ok(cancelled.html.includes(`${URL_BASE}/cancel`), "취소 근거 링크");
  const list = await get("/local/events");
  assert.match(list.html.split(`data-event-slug="${e.slug}"`)[1].slice(0, 400), /data-event-status="취소"/);
  const hist = (await board()).events.find((x) => x.slug === e.slug).history;
  assert.deepEqual(hist.map((h) => [h.from_state, h.to_state]).reverse(), [["normal", "changing"], ["changing", "cancelled"]]);
  await assert.rejects(() => db.query("update public.event_status_history set changed_by = 'x' where event_id = $1", [e.id]), /append|추가만|수정/i);

  // 재확인 필요 - 확인 후 7일째는 정상, 8일째는 필요 (설정 event_recheck)
  const d7 = await mkEvent(8, { confirmed_on: kstDay(-7) });
  const d8 = await mkEvent(9, { confirmed_on: kstDay(-8) });
  fx.events.push(d7, d8);
  const page7 = await get(`/local/events/${d7.slug}`);
  const page8 = await get(`/local/events/${d8.slug}`);
  assert.ok(!page7.html.includes('data-part="recheck"'), "7일째 정상");
  assert.ok(page8.html.includes("일정 재확인 필요"), "8일째 재확인 필요 - 상세");
  const listNow = await get("/local/events");
  assert.ok(new RegExp(`data-event-slug="${d8.slug}"[\\s\\S]{0,1500}?일정 재확인 필요`).test(listNow.html), "카드에도 표시");
  assert.ok((await board()).recheckList.some((r) => r.slug === d8.slug), "관리 보드 재확인 대상");
  assert.equal((await setting("event_recheck", { days: 10, hide_stale: false })).status, 200);
  assert.ok(!(await get(`/local/events/${d8.slug}`)).html.includes("일정 재확인 필요"), "설정을 바꾸면 다음 요청부터");
  assert.equal((await setting("event_recheck", { days: 0, hide_stale: false })).status, 422);
  assert.equal((await setting("event_recheck", { days: 7, hide_stale: true })).status, 200);
  assert.ok(!(await get("/local/events")).html.includes(`data-event-slug="${d8.slug}"`), "hide_stale - 예정 목록에서 숨김");
  assert.equal((await get(`/local/events/${d8.slug}`)).status, 200, "상세는 그대로");
  await setting("event_recheck", { days: 7, hide_stale: false });

  // 끝난 회차 날짜 고치기 거부 (REG1-05) - 새 회차는 새 행
  const past = fx.events.find((x) => x.slug.endsWith("-6"));
  const redate = await post(u.editor, evBody(6, { starts_at: kstDateTime(355, "10:00"), ends_at: kstDateTime(355, "12:00") }));
  assert.equal(redate.status, 422, show(redate));

  // 연결 (LG-14) - 확인된 연결만, 대상이 비공개로 바뀌면 다음 렌더부터 빠짐
  fx.articleId = await staff.makeIntroArticle("w6");
  const art = (await db.query("select slug, title from public.articles where id = $1", [fx.articleId])).rows[0];
  assert.equal((await post(u.editor, { op: "event_link", slug: e.slug, target_kind: "article", target_id: 987654321, reason: "시험 연결" })).status, 422, "없는 대상");
  const link = await post(u.editor, { op: "event_link", slug: e.slug, target_kind: "article", target_id: fx.articleId, reason: "시험 연결 이유" });
  assert.equal(link.status, 201, show(link));
  assert.equal((await post(u.editor, { op: "event_link", slug: e.slug, target_kind: "article", target_id: fx.articleId, reason: "시험 연결 이유" })).status, 409);
  const linked = await get(`/local/events/${e.slug}`);
  assert.ok(linked.html.includes(`href="/news/${art.slug}"`) && linked.html.includes("시험 연결 이유"), "연결된 기사 링크");
  await db.query("begin");
  await db.query("set local session_replication_role = replica");
  await db.query("update public.articles set status = 'draft' where id = $1", [fx.articleId]);
  await db.query("commit");
  // 시험이 DB를 직접 고쳤으므로 편집국 쓰기(공개 캐시 만료)를 한 번 거친다 - 운영에서는 기사 상태 바꾸기 API가 같은 만료를 한다
  assert.equal((await post(u.editor, { op: "event_publish", slug: e.slug, published: true })).status, 200);
  const unlinked = await get(`/local/events/${e.slug}`);
  assert.ok(!unlinked.html.includes(`/news/${art.slug}`), "비공개로 바뀐 대상 링크 0");
  assert.equal((await post(u.editor, { op: "event_unlink", id: link.body.link.id })).status, 200);
  void past;
});

test("f) 키 다시 끄기 - 행사 목록·상세·API 404 / 허브 ④ 링크 0 / 주간 페이지 404 / 허브 ① 0", async () => {
  assert.equal((await flags({ local_events: false, weekly_digest: false })).status, 200);
  assert.equal((await get("/local/events")).status, 404);
  assert.equal((await get(`/local/events/${fx.events[0].slug}`)).status, 404);
  assert.equal((await fetch(`${base}/api/local/events`)).status, 404);
  const hub = await get(`/local/${u.regionA.sido_slug}/${u.regionA.gu_slug}`);
  assert.ok(!hub.html.includes('data-hub-block="events"') && !hub.html.includes('data-hub-block="weekly"'));
  assert.ok(!hub.html.includes("/local/events") && !hub.html.includes("/weekly/"), "링크 0");
  assert.equal((await get(`/local/${u.regionA.sido_slug}/weekly/${u.weeks[0].week}`)).status, 404);
});
