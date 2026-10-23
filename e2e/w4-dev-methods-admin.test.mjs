// 개발방법 비교 관리 API E2E (W4 18단계 — docs/dev/W4_설계.md 1장 18단계 · 2.4 · 2.5 · 2.11 · 4장 `/api/admin/dev-methods` · 6장 · 7장 4 · 12장 #151~, PRD-01B PR-09 · PR-10 · PR-11).
// standalone 빌드를 로컬 Supabase에 붙인다. 방법 7행은 마이그레이션 씨앗(이름·slug·종류·순서만)이고, 시험이 넣는 글·숫자 요건 값은 모두 '시험용' 가짜다(실제 요건 값·법령 조건 0).
//  a) 권한 — 기자·광고 담당 GET·쓰기 403 + 거부 감사(dev_method.manage.denied) · 편집 책임자·관리자(reviewer 아님)의 서명 403 + 거부 감사(review.tax_review.denied) ·
//     감수위원의 초안 403 · 편집 책임자·감수위원 GET 200(7개 고정 순서·씨앗 빈 값·공개 준비 0·키 꺼짐)
//  b) 칸마다 422 — '시험용 방식이 유리합니다'(2.11)·자리 채움('확인 중')·점수·순위 칸 이름·모르는 칸·박스 한도·사실 행 기준일·근거 원문 · 숫자 요건 표현은 저장 + 경고 + 감사 dev_method.edit
//  c) 서명 흐름 — 초안 → 서명(감사 dev_method.review) → 고치면 재감수 필요 · 옛 초안 시각으로 서명 409 · 같은 내용 unchanged
//  d) 사실 행 — 첫 판 201(원문 글자 → 스냅샷 sha256) + 감사 dev_method_fact.edit · 첫 판 두 번 409 · 새 판 사유 422 · 옛 판을 고치는 새 판 409 · 옛 판 서명 409 · 새 판 서명 · 옛 판 그대로 · 같은 내용 unchanged
//  e) 기능 키 dev_methods — 준비 전 켜기 422 + 방법별 사유 + 거부 감사(dev_method.publish.denied) · 7개 모두 초안·서명 → 켜기 200 · anon 공개 뷰 7개 고정 순서 · 칸 하나 고치면 그 방법만 0
// 시험이 만든 비교 항목·사실 행·스냅샷·검수 항목은 끝나면 지우고 방법 7행은 씨앗 상태(내용·서명 빈 값)로, 운영 설정(기능 키)은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w4-dev-methods-e2e@example.test";
const SITE = "https://e2e.example.test";
const SLUGS = ["redevelopment", "reconstruction", "small-scale", "public", "trust", "renewal", "rapid-planning"];
const ITEMS = ["legal_basis", "actor", "target", "procedure", "numeric_requirements", "tax_issues"];
const LAW_URL = "https://gov.example.test/w4dm/law";

let sb, server, staff, db, base;
const u = {};
const counts0 = {};

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const show = (r) => JSON.stringify(r.body).slice(0, 900);
async function api(method, p, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const post = (user, body) => api("POST", "/dev-methods", user, body);
const board = async (user = u.editor) => {
  const r = await api("GET", "/dev-methods", user);
  assert.equal(r.status, 200, show(r));
  return r.body;
};
const methodOf = async (slug) => (await board()).methods.find((m) => m.slug === slug);
const auditCount = (action, target, actorId) =>
  one("select count(*)::int n from public.audit_logs where action = $1 and target like $2 and actor = $3 and at >= $4", [action, target, `user:${actorId}`, staff.startedAt]).then((r) => r.n);
const fields = (r) => [...new Set((r.body.errors ?? []).map((e) => e.split(":")[0]))];
const METHOD = (slug, over = {}) => ({ op: "method", slug, legal_basis_name: "시험용 근거 법령", summary: `시험용 ${slug} 한 줄 설명`, steps: ["시험용 첫 단계", "시험용 둘째 단계"], ...over });
const FACT = (over = {}) => ({
  op: "fact",
  slug: "trust",
  fact_key: "siheom_req",
  label: "시험용 요건",
  value: "시험용 99",
  unit: "시험용 단위",
  law_ref: "시험용 조문",
  reference_date: "2026-01-01",
  source_url: LAW_URL,
  snapshot_payload: `시험용 근거 원문 ${staff.run}`,
  ...over,
});
/** anon 키로 공개 뷰 읽기 (PostgREST — 공개 화면이 쓰는 길) */
async function anonView(view, query = "") {
  const res = await fetch(`${sb.url}/rest/v1/${view}?${query}`, { headers: { apikey: sb.anonKey, authorization: `Bearer ${sb.anonKey}` } });
  assert.equal(res.status, 200, `${view} ${res.status}`);
  return res.json();
}

/** 방법 7행을 씨앗 상태로 · 비교 항목·사실 행·그 스냅샷·검수 항목 지우기 (시험 전 0행이었다 — before가 확인) */
async function resetDevMethods(q) {
  const snaps = (await q("select snapshot_id from public.dev_method_facts")).rows.map((r) => Number(r.snapshot_id));
  await q("begin");
  try {
    await q("set local session_replication_role = replica");
    await q("delete from public.source_review_queue where target_type = 'dev_method_fact'");
    await q("delete from public.dev_method_facts");
    await q("delete from public.dev_method_compare");
    await q(
      "update public.dev_methods set legal_basis_name = null, summary = null, steps = null, lens = null, drafted_by = null, drafted_at = null, reviewed_by = null, reviewed_at = null, review_status = 'draft'",
    );
    if (snaps.length) await q("delete from public.raw_snapshots where id = any($1::bigint[])", [snaps]);
    await q("commit");
  } catch (err) {
    await q("rollback");
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
  await staff.removeLeftover(ADMIN_EMAIL);
  for (const t of ["dev_method_compare", "dev_method_facts"]) {
    counts0[t] = (await one(`select count(*)::int n from public.${t}`)).n;
    assert.equal(counts0[t], 0, `시험 전 ${t} 0행 — 내용은 편집국이 적는다 (12장 #15)`);
  }
  for (const t of ["raw_snapshots", "source_review_queue"]) counts0[t] = (await one(`select count(*)::int n from public.${t}`)).n;
  const seeds = (await db.query("select slug, review_status, summary from public.dev_methods order by sort")).rows;
  assert.deepEqual(seeds.map((r) => [r.slug, r.review_status, r.summary]), SLUGS.map((s) => [s, "draft", null]), "씨앗 7행 = 이름·slug·종류·순서만");
  await staff.snapshotOperations();
  assert.equal(staff.settingsSnapshot.find((r) => r.key === "feature_flags").value.dev_methods, false, "시험 전 dev_methods 꺼짐 (2.4 씨앗)");

  u.admin = await staff.createUser({ label: "w4dm-admin", email: ADMIN_EMAIL });
  u.editor = await staff.createUser({ label: "w4dm-editor", roles: ["editor"], person: { name: "시험용 방법 편집자", roles: ["editor"] } });
  u.reviewer = await staff.createUser({ label: "w4dm-reviewer", roles: ["reviewer"], person: { name: "시험용 방법 감수위원", roles: ["reviewer"] } });
  u.reporter = await staff.createUser({ label: "w4dm-reporter", roles: ["reporter"], person: { name: "시험용 방법 기자", roles: ["reporter"] } });
  u.adOps = await staff.createUser({ label: "w4dm-adops", roles: ["ad_ops"] });
});

after(async () => {
  try {
    if (db) await resetDevMethods((sql, params) => db.query(sql, params));
    await staff?.cleanup(); // 계정·감사 로그 지우기 + 운영 설정(기능 키) 되돌리기
  } finally {
    server?.stop();
    if (sb && Object.keys(counts0).length) {
      const c = new pg.Client({ connectionString: sb.dbUrl });
      await c.connect();
      try {
        for (const t of Object.keys(counts0)) assert.equal((await c.query(`select count(*)::int n from public.${t}`)).rows[0].n, counts0[t], `정리 뒤 ${t} 행 수 = 시험 전`);
        const left = (await c.query("select count(*)::int n from public.dev_methods where summary is not null or reviewed_by is not null or review_status <> 'draft'")).rows[0].n;
        assert.equal(left, 0, "방법 7행 씨앗 상태");
      } finally {
        await c.end();
      }
    }
  }
});

test("a) 권한 — 기자·광고 담당 403 + 거부 감사 · 편집 책임자·관리자 서명 403 + 거부 감사 · 감수위원 초안 403 · GET 7개 고정 순서·빈 씨앗", async () => {
  for (const who of [u.reporter, u.adOps]) {
    const g = await api("GET", "/dev-methods", who);
    assert.equal(g.status, 403, show(g));
    const w = await post(who, METHOD("redevelopment"));
    assert.equal(w.status, 403, show(w));
    assert.equal(await auditCount("dev_method.manage.denied", "dev_methods:%", who.id), 2, "GET·쓰기 거부 감사");
  }
  const reviewerDraft = await post(u.reviewer, METHOD("redevelopment"));
  assert.equal(reviewerDraft.status, 403, "감수위원은 서명만");
  assert.equal(await auditCount("dev_method.manage.denied", "dev_methods:method:redevelopment", u.reviewer.id), 1);
  for (const who of [u.editor, u.admin]) {
    const s = await post(who, { op: "review", target: "method", slug: "redevelopment", drafted_at: new Date().toISOString() });
    assert.equal(s.status, 403, show(s));
    assert.equal(await auditCount("review.tax_review.denied", "dev_methods:review:redevelopment", who.id), 1, "서명 거부 감사");
  }
  for (const who of [u.editor, u.reviewer, u.admin]) {
    const b = await board(who);
    assert.deepEqual(b.methods.map((m) => m.slug), SLUGS, "고정 편집 순서");
    assert.equal(b.published, false);
  }
  const b = await board();
  assert.deepEqual(b.methods.map((m) => m.name), ["재개발", "재건축", "소규모정비", "공공 방식", "신탁방식", "재정비", "신속통합기획"]);
  assert.deepEqual(b.methods.map((m) => m.kind_label).filter((k) => k === "계획 지원 절차").length, 1);
  for (const m of b.methods) {
    assert.deepEqual([m.summary, m.steps, m.lens, m.readiness.ready, m.compare.filter((c) => c.row).length, m.facts.length], [null, null, null, false, 0, 0], `${m.slug} 빈 씨앗`);
  }
  assert.equal(JSON.stringify(b).match(/"(score|rank|rating|recommend)[a-z_]*"/g), null, "점수·순위·추천 칸 0 (PR-11)");
});

test("b) 칸마다 422 — 추천·유리 단정·자리 채움·점수 칸·모르는 칸·박스 한도·사실 행 기준일·근거 원문 · 숫자 요건 표현은 저장 + 경고 + 감사", async () => {
  const bad = await post(u.editor, METHOD("reconstruction", { summary: "시험용 방식이 유리합니다", steps: ["시험용 단계", "확인 중"], score: 3, extra: 1 }));
  assert.equal(bad.status, 422, show(bad));
  assert.deepEqual(fields(bad), ["score", "extra", "summary", "steps[1]"]);
  assert.match(bad.body.errors.find((e) => e.startsWith("summary:")), /금지 표현 ‘(방식이 유리|유리합니다)’ — 어느 방식이 좋은지 추천하거나 판정하지 않습니다 \(PR-11/);
  const lens = await post(u.editor, METHOD("reconstruction", { lens: { topics: ["시험용"], points: ["1", "2", "3", "4"], links: [{ kind: "calculator", label: "시험용", url: "/calc" }], base_date: "2026-01-01" } }));
  assert.equal(lens.status, 422);
  assert.ok(fields(lens).every((f) => f.startsWith("lens.")), show(lens));
  const item = await post(u.editor, { op: "compare", slug: "reconstruction", item: "rank", body: "준비 중" });
  assert.deepEqual([item.status, fields(item)], [422, ["item", "body"]]);
  const fact = await post(u.editor, FACT({ reference_date: "", snapshot_payload: undefined, best_value: 1 }));
  assert.deepEqual([fact.status, fields(fact)], [422, ["best_value", "reference_date", "snapshot_payload"]]);
  assert.equal(await auditCount("dev_method.edit", "dev_methods:reconstruction", u.editor.id), 0, "거부된 쓰기는 감사 0");
  assert.equal((await one("select summary from public.dev_methods where slug = 'reconstruction'")).summary, null, "저장 0");

  const warn = await post(u.editor, METHOD("reconstruction", { summary: "시험용 99% 이상 3분의 2" }));
  assert.equal(warn.status, 200, show(warn));
  assert.match(warn.body.warnings.join(" "), /숫자 요건 표현이 있습니다 — 저장은 됩니다/);
  assert.equal(await auditCount("dev_method.edit", "dev_methods:reconstruction", u.editor.id), 1);
});

test("c) 서명 흐름 — 초안 → 서명 + 감사 → 고치면 재감수 필요 · 옛 초안 시각 409 · 같은 내용 unchanged", async () => {
  const saved = await post(u.editor, METHOD("small-scale"));
  assert.equal(saved.status, 200, show(saved));
  const draftedAt = saved.body.method.drafted_at;
  const same = await post(u.editor, METHOD("small-scale"));
  assert.equal(same.body.unchanged, true, "같은 내용 — 쓰기 0");
  const signed = await post(u.reviewer, { op: "review", target: "method", slug: "small-scale", drafted_at: draftedAt });
  assert.equal(signed.status, 200, show(signed));
  assert.equal(signed.body.method.review_status, "reviewed");
  assert.equal(await auditCount("dev_method.review", "dev_methods:small-scale", u.reviewer.id), 1);
  const edited = await post(u.editor, METHOD("small-scale", { summary: "시험용 고친 설명" }));
  assert.deepEqual([edited.body.method.review_status, edited.body.method.reviewed_by], ["rereview_needed", null], "고치면 서명 지움");
  const stale = await post(u.reviewer, { op: "review", target: "method", slug: "small-scale", drafted_at: draftedAt });
  assert.equal(stale.status, 409, "읽은 초안이 아니면 서명 0");
  const m = await methodOf("small-scale");
  assert.equal((await post(u.reviewer, { op: "review", target: "method", slug: "small-scale", drafted_at: m.drafted_at })).status, 200);
  // 비교 항목 — 없는 칸 서명 422 · 만들기 201 · 서명 · 고치면 지움
  assert.equal((await post(u.reviewer, { op: "review", target: "compare", slug: "small-scale", item: "actor", drafted_at: m.drafted_at })).status, 422);
  const c1 = await post(u.editor, { op: "compare", slug: "small-scale", item: "actor", body: "시험용 사업 주체" });
  assert.equal(c1.status, 201, show(c1));
  const cs = await post(u.reviewer, { op: "review", target: "compare", slug: "small-scale", item: "actor", drafted_at: c1.body.compare.drafted_at });
  assert.equal(cs.body.compare.review_status, "reviewed");
  const c2 = await post(u.editor, { op: "compare", slug: "small-scale", item: "actor", body: "시험용 고친 사업 주체" });
  assert.deepEqual([c2.status, c2.body.compare.review_status], [200, "rereview_needed"]);
  assert.equal(await auditCount("dev_method.edit", "dev_method_compare:small-scale:actor", u.editor.id), 2);
});

test("d) 사실 행 — 첫 판 + 스냅샷 + 감사 · 첫 판 두 번 409 · 새 판 사유 422 · 옛 판 고치기·서명 409 · 새 판 서명 · 옛 판 그대로 · 같은 내용 unchanged", async () => {
  const v1 = await post(u.editor, FACT());
  assert.equal(v1.status, 201, show(v1));
  assert.equal(v1.body.fact.version, 1);
  const snap = await one("select content_hash, url from public.raw_snapshots where id = $1", [v1.body.fact.snapshot_id]);
  assert.match(snap.content_hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(snap.url, LAW_URL);
  assert.equal(await auditCount("dev_method_fact.edit", `dev_method_facts:${v1.body.fact.id}`, u.editor.id), 1);
  assert.equal((await post(u.editor, FACT({ value: "시험용 98" }))).status, 409, "첫 판 두 번 0 — 덮어쓰기 0");
  const noReason = await post(u.editor, FACT({ supersedes_id: v1.body.fact.id, value: "시험용 98" }));
  assert.deepEqual([noReason.status, fields(noReason)], [422, ["reason"]]);
  const same = await post(u.editor, FACT({ supersedes_id: v1.body.fact.id, reason: "시험용 같은 값", snapshot_payload: undefined, snapshot_id: v1.body.fact.snapshot_id }));
  assert.equal(same.body.unchanged, true, "같은 내용 — 새 판 0");
  const v2 = await post(u.editor, FACT({ supersedes_id: v1.body.fact.id, value: "시험용 98", reference_date: "2026-06-01", reason: "시험용 고친 사유", snapshot_payload: undefined, snapshot_id: v1.body.fact.snapshot_id }));
  assert.equal(v2.status, 201, show(v2));
  assert.equal(v2.body.fact.version, 2);
  const branch = await post(u.editor, FACT({ supersedes_id: v1.body.fact.id, value: "시험용 97", reason: "시험용 갈래" }));
  assert.equal(branch.status, 409, "옛 판을 고치는 새 판 0");
  assert.equal((await post(u.reviewer, { op: "review", target: "fact", slug: "trust", fact_id: v1.body.fact.id })).status, 409, "옛 판 서명 0");
  const signed = await post(u.reviewer, { op: "review", target: "fact", slug: "trust", fact_id: v2.body.fact.id });
  assert.equal(signed.status, 200, show(signed));
  assert.ok(signed.body.fact.reviewed_at);
  assert.equal(await auditCount("dev_method.review", `dev_method_facts:${v2.body.fact.id}`, u.reviewer.id), 1);
  const old = await one("select value, version, reviewed_by from public.dev_method_facts where id = $1", [v1.body.fact.id]);
  assert.deepEqual([old.value, old.version, old.reviewed_by], ["시험용 99", 1, null], "옛 판 그대로");
  const group = (await methodOf("trust")).facts.find((f) => f.fact_key === "siheom_req");
  assert.deepEqual([group.latest.id, group.versions.map((x) => x.version)], [v2.body.fact.id, [1, 2]]);
});

test("e) 기능 키 dev_methods — 준비 전 켜기 422 + 사유 + 거부 감사 · 7개 초안·서명 → 켜기 200 · anon 공개 뷰 7개 고정 순서 · 칸 하나 고치면 그 방법만 0", async () => {
  const cur = (await one("select value from public.settings where key = 'feature_flags'")).value;
  const early = await api("PATCH", "/settings/feature_flags", u.admin, { value: { ...cur, dev_methods: true } });
  assert.equal(early.status, 422, show(early));
  assert.ok(early.body.errors.some((e) => e.startsWith("feature_flags.dev_methods: redevelopment — ")), show(early));
  assert.ok(early.body.errors.some((e) => /rapid-planning — 방법 내용 세무 감수 서명 없음 · 비교 항목 서명 전·빈 칸: 근거 법령·사업 주체·대상·주요 절차·숫자 요건·지방세 쟁점/.test(e)), show(early));
  assert.equal(await auditCount("dev_method.publish.denied", "settings:feature_flags", u.admin.id), 1, "서명 없는 개발방법 공개 시도 거부 감사 (2.5)");
  assert.equal((await one("select value from public.settings where key = 'feature_flags'")).value.dev_methods, false);

  for (const slug of SLUGS) {
    const m = await post(u.editor, METHOD(slug));
    assert.equal(m.status, 200, `${slug} ${show(m)}`);
    for (const item of ITEMS) {
      const c = await post(u.editor, { op: "compare", slug, item, body: `시험용 ${slug} ${item} 글` });
      assert.ok([200, 201].includes(c.status), show(c));
      if (c.body.compare.review_status !== "reviewed") {
        const s = await post(u.reviewer, { op: "review", target: "compare", slug, item, drafted_at: c.body.compare.drafted_at });
        assert.equal(s.status, 200, show(s));
      }
    }
    const fresh = await methodOf(slug);
    if (fresh.review_status !== "reviewed") assert.equal((await post(u.reviewer, { op: "review", target: "method", slug, drafted_at: fresh.drafted_at })).status, 200);
  }
  assert.ok((await board()).methods.every((m) => m.readiness.ready), "7개 모두 공개 준비");
  assert.deepEqual(await anonView("public_dev_methods", "select=slug"), [], "키 꺼짐 → 공개 뷰 0");
  const now = (await one("select value from public.settings where key = 'feature_flags'")).value;
  const on = await api("PATCH", "/settings/feature_flags", u.admin, { value: { ...now, dev_methods: true } });
  assert.equal(on.status, 200, show(on));
  assert.deepEqual((await anonView("public_dev_methods", "select=slug,kind&order=sort")).map((r) => r.slug), SLUGS, "7개 고정 편집 순서");
  const cells = await anonView("public_dev_method_compare", "select=slug,item,body&order=sort,item_position");
  assert.equal(cells.length, 42);
  assert.deepEqual(cells.slice(0, 6).map((c) => c.item), ITEMS);
  // 사실 행 — 서명된 최신 판(trust · 시험용 98)만, 감수자 공개 이름 · 기준일
  const facts = await anonView("public_dev_method_facts", "select=slug,fact_key,value,reference_date,reviewer_name,version");
  assert.deepEqual(facts, [{ slug: "trust", fact_key: "siheom_req", value: "시험용 98", reference_date: "2026-06-01", reviewer_name: "시험용 방법 감수위원", version: 2 }]);
  // 칸 하나 고침 → 그 방법만 0 (키는 켜진 채)
  assert.equal((await post(u.editor, { op: "compare", slug: "renewal", item: "procedure", body: "시험용 고친 절차" })).status, 200);
  assert.deepEqual((await anonView("public_dev_methods", "select=slug&order=sort")).map((r) => r.slug), SLUGS.filter((s) => s !== "renewal"));
  assert.equal((await board()).methods.find((m) => m.slug === "renewal").readiness.ready, false);
});
