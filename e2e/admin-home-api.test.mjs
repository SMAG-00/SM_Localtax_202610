// 홈 배치 API E2E (W2-b 1단계 — HOME-03 · ADM-01 홈 큐레이션, docs/dev/W2-b_설계.md 6장)
// standalone 빌드를 띄우고 로컬 Supabase(Auth·DB)에 붙인다. 상태 코드와 감사 로그 행, DB 값, 그리고 '지금 홈에 보이는 모습'
// (공개 데이터 함수 getHomeAmendments — anon 키·RLS)을 함께 본다.
//  · 편집 책임자 201 · 기자·광고 담당·editor 없는 관리자 403 + 감사 로그(article.home.denied)
//  · 같은 날 스토리 6장까지 — 7장째 409, 끝난 다음 날 시작하는 7번째는 201
//  · 끝난 카드는 공개 홈 데이터에 0 (목록에는 '끝남'), 트래커 지정 0건이면 최근 단계가 바뀐 트래커로 자동 채움
// 만든 계정·기사·개정안·배치·감사 로그는 끝나면 지운다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "admin-home-e2e@example.test";
const SITE = "https://e2e.example.test";

let sb, server, staff, db;
const u = {};
const fx = {};

async function api(method, path, user, body) {
  const headers = {};
  if (user) headers.authorization = `Bearer ${user.token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${server.base}/api/admin${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, body: json };
}

const show = (r) => JSON.stringify(r.body).slice(0, 1500);
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const auditCount = async (userId, action, target) =>
  (await one("select count(*)::int n from public.audit_logs where actor = $1 and action = $2 and target = $3", [`user:${userId}`, action, target])).n;
const lastAudit = (userId, action, target) =>
  one("select before, after, reason from public.audit_logs where actor = $1 and action = $2 and target = $3 order by id desc limit 1", [`user:${userId}`, action, target]);
const curationCount = async () => (await one("select count(*)::int n from public.home_curations")).n;
/** 한국 날짜 YYYY-MM-DD (오늘 + days) */
const kstDay = (days = 0) => new Date(Date.now() + 9 * 3600_000 + days * 86_400_000).toISOString().slice(0, 10);
const TODAY = kstDay(0);

/** 시험용 공개 기사 — 작성자를 시험 기자로 두어 cleanup이 찾는다 */
async function article(label, over = {}) {
  const { rows } = await db.query(
    `insert into public.articles (slug, title, summary, section, content_type, label, status, author_id, format)
     values ($1, $2, '시험 요약', 'tax', $3, $4, $5, $6, $7) returning id`,
    [`e2e-home-${label}-${staff.run}`, `홈 배치 시험 ${label} ${staff.run}`, over.contentType ?? "explainer", over.label ?? "none", over.status ?? "published", u.reporter.personId, over.format ?? "general"],
  );
  const id = Number(rows[0].id);
  staff.trackArticle(id);
  return id;
}

/** 시험용 개정 트래커와 단계 기록 (원문 스냅샷 필수 — TX-07) */
async function amendment(label, { status = "public", occurredOn = TODAY } = {}) {
  const { rows } = await db.query("insert into public.amendments (slug, title, status) values ($1, $2, $3) returning id", [`e2e-home-am-${label}-${staff.run}`, `시험 개정안 ${label} ${staff.run}`, status]);
  const id = Number(rows[0].id);
  staff.trackRow("amendments", id);
  const snap = await one("insert into public.raw_snapshots (source, url, content_hash, payload) values ('e2e', 'https://www.mois.go.kr/e2e', 'h', '원문') returning id");
  await db.query(
    "insert into public.amendment_events (amendment_id, stage, occurred_on, source_url, snapshot_id, recorded_by) values ($1, 'pre_notice', $2, 'https://www.mois.go.kr/e2e', $3, 'user:e2e')",
    [id, occurredOn, snap.id],
  );
  return id;
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
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  await staff.removeLeftover(ADMIN_EMAIL);
  // 지난 실행이 중간에 멈춰 남긴 배치(만든 계정이 이미 지워진 것)는 상한 시험을 흐리므로 지운다
  await db.query(
    "delete from public.home_curations h where h.created_by like 'user:%' and not exists (select 1 from auth.users x where 'user:' || x.id::text = h.created_by)",
  );
  assert.equal(await curationCount(), 0, "로컬 DB에 홈 배치 행이 남아 있다 — 상한 시험 전에 비어 있어야 한다");

  u.editor = await staff.createUser({ label: "home-editor", roles: ["editor"], person: { name: "홈 시험 편집자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "home-reporter", roles: ["reporter"], person: { name: "홈 시험 기자", roles: ["reporter"] } });
  u.adOps = await staff.createUser({ label: "home-ad", roles: ["ad_ops"], person: { name: "홈 시험 광고 담당", roles: ["writer"] } });
  u.admin = await staff.createUser({ label: "home-admin", email: ADMIN_EMAIL });

  fx.stories = [];
  for (let i = 1; i <= 8; i++) fx.stories.push(await article(`story${i}`, { format: i % 2 ? "cardnews" : "general" }));
  fx.ad = await article("ad", { contentType: "sponsored", label: "ad" });
  fx.draft = await article("draft", { status: "draft" });
  fx.trackerOld = await amendment("old", { occurredOn: kstDay(-40) });
  fx.trackerNew = await amendment("new", { occurredOn: TODAY });
  fx.trackerHidden = await amendment("hidden", { status: "draft" });
});

after(async () => {
  try {
    await staff?.cleanup();
  } finally {
    server?.stop();
  }
});

async function addStory(articleId, startsOn = TODAY, endsOn = null, user = u.editor) {
  const r = await api("POST", "/home-curations", user, { kind: "story", targetId: articleId, startsOn, endsOn });
  if (r.status === 201) staff.trackRow("home_curations", r.body.curation.id);
  return r;
}

test("편집 책임자 — 스토리 카드 더하기 201·감사 로그 1줄, 기자·광고 담당·editor 없는 관리자는 403 + 거부 감사 로그·바뀜 0", async () => {
  const r = await addStory(fx.stories[0]);
  assert.equal(r.status, 201, show(r));
  assert.equal(r.body.curation.status, "active");
  assert.equal(r.body.curation.target.title, `홈 배치 시험 story1 ${staff.run}`);
  const id = r.body.curation.id;
  assert.equal(await auditCount(u.editor.id, "home_curation.create", `home_curations:${id}`), 1);
  const audit = await lastAudit(u.editor.id, "home_curation.create", `home_curations:${id}`);
  assert.equal(audit.after.article_id, fx.stories[0]);
  assert.equal(audit.after.created_by, `user:${u.editor.id}`);

  const before = await curationCount();
  for (const who of [u.reporter, u.adOps, u.admin]) {
    const denied = await addStory(fx.stories[1], TODAY, null, who);
    assert.equal(denied.status, 403, `${who.email}: ${show(denied)}`);
    assert.equal(await auditCount(who.id, "article.home.denied", "home_curations:new"), 1, "거부도 감사 로그에 남는다 (NAV-06)");
    assert.equal((await api("GET", "/home-curations", who)).status, 403);
  }
  assert.equal(await curationCount(), before, "거부된 요청은 행을 만들지 않는다");
  assert.equal((await api("POST", "/home-curations", null, { kind: "story", targetId: fx.stories[1], startsOn: TODAY })).status, 401);
});

test("같은 날 스토리 카드 6장까지 — 7장째 409(바뀜 0), 끝난 다음 날 시작하는 카드는 201", async () => {
  // 앞 시험의 1장 + 5장 = 오늘 6장 (모두 오늘 끝나는 기간)
  await db.query("update public.home_curations set ends_on = $1 where kind = 'story'", [TODAY]);
  for (const a of fx.stories.slice(1, 6)) {
    const r = await addStory(a, TODAY, TODAY);
    assert.equal(r.status, 201, show(r));
  }
  const list = await api("GET", "/home-curations", u.editor);
  assert.equal(list.status, 200, show(list));
  assert.equal(list.body.curations.filter((c) => c.kind === "story" && c.status === "active").length, 6);
  assert.deepEqual(list.body.limits, { tracker: 3, story: 6 });

  const before = await curationCount();
  const seventh = await addStory(fx.stories[6], TODAY, null);
  assert.equal(seventh.status, 409, show(seventh));
  assert.match(seventh.body.error, /같은 날 6장까지/);
  assert.equal(await curationCount(), before, "7장째는 저장되지 않는다");

  const tomorrow = await addStory(fx.stories[6], kstDay(1), null);
  assert.equal(tomorrow.status, 201, `오늘 카드들이 끝난 다음 날 시작 — ${show(tomorrow)}`);
  assert.equal(tomorrow.body.curation.status, "upcoming");
});

test("대상·기간 검사 — 광고·발행 전 기사·비공개 트래커·없는 번호 422, 기간 거꾸로·이미 끝난 기간 422, 같은 대상 겹침 409", async () => {
  const cases = [
    [{ kind: "story", targetId: fx.ad, startsOn: kstDay(5) }, 422, /광고/],
    [{ kind: "story", targetId: fx.draft, startsOn: kstDay(5) }, 422, /발행된 기사만/],
    [{ kind: "tracker", targetId: fx.trackerHidden, startsOn: TODAY }, 422, /공개된 개정 트래커만/],
    [{ kind: "story", targetId: 987654321, startsOn: kstDay(5) }, 422, /그런 기사가 없습니다/],
    [{ kind: "story", targetId: fx.stories[7], startsOn: kstDay(5), endsOn: kstDay(4) }, 422, /입력값/],
    [{ kind: "story", targetId: fx.stories[7], startsOn: kstDay(-5), endsOn: kstDay(-1) }, 422, /입력값/],
    [{ kind: "banner", targetId: fx.stories[7], startsOn: TODAY }, 422, /입력값/],
    [{ kind: "story", targetId: fx.stories[6], startsOn: kstDay(3), endsOn: kstDay(9) }, 409, /같은 대상/],
  ];
  const before = await curationCount();
  for (const [body, status, message] of cases) {
    const r = await api("POST", "/home-curations", u.editor, body);
    assert.equal(r.status, status, `${JSON.stringify(body)}: ${show(r)}`);
    assert.match(r.body.error, message);
  }
  assert.equal(await curationCount(), before);
});

test("지금 홈에 보이는 모습 — 끝난 카드는 공개 홈 데이터에 0(목록에는 '끝남'), 트래커 지정 0건이면 최근 단계가 바뀐 공개 트래커로 자동 채움", async () => {
  // 지난주에 끝난 카드 — API는 끝난 기간을 새로 만들지 않으므로 DB에 직접 넣는다 (트리거 규칙은 그대로 적용)
  const expired = await one(
    "insert into public.home_curations (kind, article_id, starts_on, ends_on, sort, created_by) values ('story', $1, $2, $3, 1, $4) returning id",
    [fx.stories[7], kstDay(-10), kstDay(-3), `user:${u.editor.id}`],
  );
  staff.trackRow("home_curations", expired.id);
  const r = await api("GET", "/home-curations", u.editor);
  assert.equal(r.status, 200, show(r));
  const row = r.body.curations.find((c) => c.id === Number(expired.id));
  assert.equal(row.status, "expired", "백오피스 목록에는 끝난 카드도 보인다");

  const preview = r.body.preview;
  assert.ok(preview, `공개 트래커가 있으니 섹션이 있다: ${show(r)}`);
  const storyIds = preview.stories.map((s) => s.id);
  assert.ok(!storyIds.includes(fx.stories[7]), "끝난 카드의 기사는 공개 홈 데이터에 0");
  assert.equal(preview.stories.length, 6, "오늘 노출 중인 지정 6장 — 7장째(내일 시작)·끝난 카드 0");
  assert.ok(!storyIds.includes(fx.stories[6]), "내일 시작하는 카드는 오늘 0");
  assert.ok(preview.stories.every((s) => s.designated), "지정이 6장이면 자동 채움 0");
  assert.deepEqual(
    preview.stories.map((s) => s.format),
    fx.stories.slice(0, 6).map((_, i) => (i % 2 === 0 ? "cardnews" : null)),
    "형식 배지 = 기사 형식 (일반 기사 null)",
  );

  assert.equal(preview.trackerSource, "fallback", "트래커 지정 0건");
  assert.equal(preview.trackers.length, 1);
  assert.equal(preview.trackers[0].id, fx.trackerNew, "현재 단계가 가장 최근에 바뀐 공개 트래커");
  assert.equal(preview.trackers[0].designated, false);
  assert.equal(preview.trackers[0].stage.label, "입법예고");
  assert.equal(preview.trackers[0].stage.confirmed, false, "공포 전 — 확정 아님");
  assert.equal(preview.trackers[0].href, null, "트래커 페이지(01B W3) 공개 전 — 링크 0");

  const tracker = await api("POST", "/home-curations", u.editor, { kind: "tracker", targetId: fx.trackerOld, startsOn: TODAY });
  assert.equal(tracker.status, 201, show(tracker));
  staff.trackRow("home_curations", tracker.body.curation.id);
  const after = (await api("GET", "/home-curations", u.editor)).body.preview;
  assert.equal(after.trackerSource, "designated");
  assert.deepEqual(after.trackers.map((t) => t.id), [fx.trackerOld], "지정하면 자동 채움 대신 지정한 트래커");
});

test("고치기·순서·빼기 — 기간 PATCH 200·감사 전후, 종류 바꾸기 422, 순서 200·감사, 빼기 200·감사, 다시 빼기 404", async () => {
  const list = (await api("GET", "/home-curations", u.editor)).body.curations;
  const live = list.filter((c) => c.kind === "story" && c.status !== "expired");
  const first = live[0];

  const patched = await api("PATCH", `/home-curations/${first.id}`, u.editor, { endsOn: kstDay(2) });
  assert.equal(patched.status, 200, show(patched));
  assert.deepEqual(patched.body.changed, ["ends_on"]);
  const audit = await lastAudit(u.editor.id, "home_curation.update", `home_curations:${first.id}`);
  assert.deepEqual(audit.before, { ends_on: TODAY });
  assert.deepEqual(audit.after, { ends_on: kstDay(2) });

  const kind = await api("PATCH", `/home-curations/${first.id}`, u.editor, { kind: "tracker" });
  assert.equal(kind.status, 422, show(kind));
  const backwards = await api("PATCH", `/home-curations/${first.id}`, u.editor, { startsOn: kstDay(2), endsOn: kstDay(1) });
  assert.equal(backwards.status, 422, show(backwards));
  const stretch = await api("PATCH", `/home-curations/${live.find((c) => c.status === "upcoming").id}`, u.editor, { startsOn: TODAY });
  assert.equal(stretch.status, 409, `내일 시작 카드를 오늘로 당기면 오늘 7장 — ${show(stretch)}`);
  assert.equal((await api("PATCH", `/home-curations/${first.id}`, u.reporter, { sort: 1 })).status, 403);

  const reversed = live.map((c) => c.id).reverse();
  const order = await api("POST", "/home-curations/order", u.editor, { kind: "story", ids: reversed });
  assert.equal(order.status, 200, show(order));
  assert.deepEqual(order.body.order, reversed);
  assert.equal(await auditCount(u.editor.id, "home_curation.reorder", "home_curations:order:story"), 1);
  const partial = await api("POST", "/home-curations/order", u.editor, { kind: "story", ids: reversed.slice(1) });
  assert.equal(partial.status, 422, "노출 중·예정 카드 전부를 보내야 한다");
  const preview = (await api("GET", "/home-curations", u.editor)).body.preview;
  assert.deepEqual(
    preview.stories.map((s) => s.id),
    reversed.flatMap((id) => {
      const c = live.find((x) => x.id === id);
      return c.status === "active" ? [c.targetId] : [];
    }),
    "공개 홈의 스토리 순서 = 편집자가 정한 순서",
  );

  const removed = await api("DELETE", `/home-curations/${first.id}`, u.editor);
  assert.equal(removed.status, 200, show(removed));
  assert.equal(await auditCount(u.editor.id, "home_curation.delete", `home_curations:${first.id}`), 1);
  assert.equal((await one("select count(*)::int n from public.home_curations where id = $1", [first.id])).n, 0);
  assert.equal((await api("DELETE", `/home-curations/${first.id}`, u.editor)).status, 404);
  assert.equal((await api("DELETE", `/home-curations/${live[1].id}`, u.adOps)).status, 403);
});

test("시험 동안 예상 못 한 서버 오류(500)가 없었다", () => {
  assert.doesNotMatch(server.log(), /\[api\] 처리 중 오류/);
});
