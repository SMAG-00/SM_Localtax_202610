// 특례법 확인 기록 E2E (W4 20단계 — docs/dev/W4_설계.md 1장 20단계 · 6장 · 12장 #14, PRD-01B PR-13)
// standalone 빌드를 로컬 Supabase에 붙인다. 특례법 이름·요건·법령 문구는 쓰지 않는다 — 시험용 가짜 글과 가짜 주소만.
//  a) 권한 — 편집 책임자·감수위원의 확인 기록 403 + 거부 감사 · 관리자만 201 + 감사 · 공포 원문 주소·공포일 없는 확인 422
//  b) 확인 전 — 표시 켜기 409(공포 확인 없음) · 공개 화면(목록·방법 상세)에 특례법 요소 0
//  c) 공포 확인 + 표시 켜기(서명 지움 → 재서명) 뒤에도 행 확인 전에는 공개 화면에 특례법 요소 0
//  d) 행 확인 뒤 — 공개 화면에 특례법 근거(방법 이름·항목·공포 원문 링크) · anon은 확인 기록 표를 못 읽는다
//  e) 글을 고치면 다시 숨김 → 재서명만으로는 숨김 → 다시 확인하면 보임 → 행 철회·공포 철회로 숨김
// 시험이 만든 글·확인 기록은 끝나면 지우고(append-only 표는 replica 모드로) 방법 7행은 씨앗 상태로, 운영 설정(기능 키)은 시험 전으로 되돌린다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w4-special-law-e2e@example.test";
const SITE = "https://e2e.example.test";
const SLUGS = ["redevelopment", "reconstruction", "small-scale", "public", "trust", "renewal", "rapid-planning"];
const ITEMS = ["legal_basis", "actor", "target", "procedure", "numeric_requirements", "tax_issues"];
const LAW_URL = "https://gov.example.test/w4sl/promulgation";
const MARK = 'data-part="special-law"';

let sb, server, staff, db, base;
const u = {};
let startCount = 0;

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const show = (r) => JSON.stringify(r.body).slice(0, 700);
async function call(method, p, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const dm = (user, body) => call("POST", "/dev-methods", user, body);
const sl = (user, body) => call("POST", "/special-law", user, body);
const auditCount = (action, actorId) =>
  one("select count(*)::int n from public.audit_logs where action = $1 and actor = $2 and at >= $3", [action, `user:${actorId}`, staff.startedAt]).then((r) => r.n);
async function anonView(view, query = "") {
  const res = await fetch(`${sb.url}/rest/v1/${view}?${query}`, { headers: { apikey: sb.anonKey, authorization: `Bearer ${sb.anonKey}` } });
  return { status: res.status, rows: await res.json().catch(() => null) };
}
const page = async (p) => {
  const res = await fetch(`${base}${p}`);
  assert.equal(res.status, 200, p);
  return res.text();
};
const compareRow = async (slug, item) => (await call("GET", "/dev-methods", u.editor)).body.methods.find((m) => m.slug === slug).compare.find((c) => c.item === item).row;
const signCompare = async (slug, item) => {
  const row = await compareRow(slug, item);
  const s = await dm(u.reviewer, { op: "review", target: "compare", slug, item, drafted_at: row.drafted_at });
  assert.equal(s.status, 200, show(s));
};

async function reset(q) {
  await q("begin");
  try {
    await q("set local session_replication_role = replica");
    await q("delete from public.special_law_confirmations");
    await q("delete from public.dev_method_compare");
    await q("update public.dev_methods set legal_basis_name = null, summary = null, steps = null, lens = null, drafted_by = null, drafted_at = null, reviewed_by = null, reviewed_at = null, review_status = 'draft'");
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
  for (const t of ["dev_method_compare", "dev_method_facts", "special_law_confirmations"]) assert.equal((await one(`select count(*)::int n from public.${t}`)).n, 0, `시험 전 ${t} 0행`);
  startCount = 0;
  await staff.snapshotOperations();
  u.admin = await staff.createUser({ label: "w4sl-admin", email: ADMIN_EMAIL });
  u.editor = await staff.createUser({ label: "w4sl-editor", roles: ["editor"], person: { name: "시험용 특례법 편집자", roles: ["editor"] } });
  u.reviewer = await staff.createUser({ label: "w4sl-reviewer", roles: ["reviewer"], person: { name: "시험용 특례법 감수위원", roles: ["reviewer"] } });
});

after(async () => {
  try {
    if (db) await reset((sql, params) => db.query(sql, params));
    await staff?.cleanup();
  } finally {
    server?.stop();
    if (sb) {
      const c = new pg.Client({ connectionString: sb.dbUrl });
      await c.connect();
      try {
        assert.equal((await c.query("select count(*)::int n from public.special_law_confirmations")).rows[0].n, startCount, "정리 뒤 확인 기록 0행");
      } finally {
        await c.end();
      }
    }
  }
});

test("a) 권한 — 편집 책임자·감수위원의 확인 기록 403 + 거부 감사 · 주소·공포일 없는 확인 422 · 관리자만 통과", async () => {
  for (const [user, label] of [[u.editor, "editor"], [u.reviewer, "reviewer"]]) {
    const r = await sl(user, { op: "law", status: "enacted", promulgation_url: LAW_URL, promulgated_on: "2026-01-02", reason: "시험용 사유" });
    assert.equal(r.status, 403, `${label} ${show(r)}`);
    assert.equal(await auditCount("special_law.confirm.denied", user.id), 1, `${label} 거부 감사`);
  }
  const noUrl = await sl(u.admin, { op: "law", status: "enacted", promulgated_on: "2026-01-02", reason: "시험용 사유" });
  assert.equal(noUrl.status, 422, show(noUrl));
  assert.ok(noUrl.body.errors.some((e) => e.startsWith("promulgation_url:")), show(noUrl));
  const noDate = await sl(u.admin, { op: "law", status: "enacted", promulgation_url: LAW_URL, reason: "시험용 사유" });
  assert.equal(noDate.status, 422, show(noDate));
  assert.equal((await sl(u.admin, { op: "law", status: "withdrawn", reason: "시험용 사유" })).status, 409, "확인 전 철회 거부");
  assert.equal((await one("select count(*)::int n from public.special_law_confirmations")).n, 0);
});

test("b) 확인 전 — 표시 켜기 409 · 7개 방법 공개 준비 뒤에도 공개 화면에 특례법 요소 0", async () => {
  for (const slug of SLUGS) {
    const m = await dm(u.editor, { op: "method", slug, legal_basis_name: "시험용 근거 법령", summary: `시험용 ${slug} 한 줄 설명`, steps: ["시험용 첫 단계", "시험용 둘째 단계"] });
    assert.equal(m.status, 200, `${slug} ${show(m)}`);
    for (const item of ITEMS) {
      const c = await dm(u.editor, { op: "compare", slug, item, body: `시험용 ${slug} ${item} 글` });
      assert.ok([200, 201].includes(c.status), show(c));
      await signCompare(slug, item);
    }
    const fresh = (await call("GET", "/dev-methods", u.editor)).body.methods.find((x) => x.slug === slug);
    assert.equal((await dm(u.reviewer, { op: "review", target: "method", slug, drafted_at: fresh.drafted_at })).status, 200);
  }
  const cur = (await one("select value from public.settings where key = 'feature_flags'")).value;
  const on = await call("PATCH", "/settings/feature_flags", u.admin, { value: { ...cur, dev_methods: true } });
  assert.equal(on.status, 200, show(on));
  const early = await sl(u.editor, { op: "mark_compare", slug: "trust", item: "target", on: true });
  assert.equal(early.status, 409, show(early));
  assert.match(early.body.error ?? early.body.message ?? JSON.stringify(early.body), /공포 확인/);
  assert.equal((await anonView("public_special_law")).rows.length, 0);
  for (const p of ["/realestate/development-methods", "/realestate/development-methods/trust"]) assert.ok(!(await page(p)).includes(MARK), `${p} 확인 전 특례법 요소 0`);
});

test("c) 공포 확인 + 표시 켜기(서명 지움) 뒤에도 행 확인 전에는 숨김", async () => {
  const law = await sl(u.admin, { op: "law", status: "enacted", promulgation_url: LAW_URL, promulgated_on: "2026-01-02", reason: "시험용 사유" });
  assert.equal(law.status, 201, show(law));
  assert.equal(await auditCount("special_law.confirm", u.admin.id), 1);
  const mark = await sl(u.editor, { op: "mark_compare", slug: "trust", item: "target", on: true });
  assert.equal(mark.status, 200, show(mark));
  assert.equal(mark.body.compare.review_status, "rereview_needed", "표시를 바꾸면 서명이 지워진다");
  await signCompare("trust", "target");
  assert.equal(await auditCount("special_law.mark", u.editor.id), 1);
  const pub = (await anonView("public_special_law")).rows;
  assert.equal(pub.length, 1);
  assert.equal(pub[0].promulgation_url, LAW_URL);
  assert.deepEqual(Object.keys(pub[0]).sort(), ["confirmed_at", "promulgated_on", "promulgation_url"]);
  const cmp = await anonView("public_dev_method_compare", "select=special_law_basis&slug=eq.trust&item=eq.target");
  assert.deepEqual(cmp.rows, [{ special_law_basis: false }], "행 확인 전");
  for (const p of ["/realestate/development-methods", "/realestate/development-methods/trust"]) assert.ok(!(await page(p)).includes(MARK), `${p} 행 확인 전 특례법 요소 0`);
});

test("d) 행 확인 뒤 — 공개 화면에 특례법 근거와 공포 원문 링크 · anon은 확인 기록 표를 못 읽는다", async () => {
  const deniedRow = await sl(u.editor, { op: "row", target: "compare", slug: "trust", item: "target", status: "enacted", reason: "시험용 사유" });
  assert.equal(deniedRow.status, 403, show(deniedRow));
  const row = await sl(u.admin, { op: "row", target: "compare", slug: "trust", item: "target", status: "enacted", reason: "시험용 행 확인" });
  assert.equal(row.status, 201, show(row));
  assert.equal(await auditCount("special_law.confirm", u.admin.id), 2, "공포 확인 1 + 행 확인 1");
  assert.deepEqual((await anonView("public_dev_method_compare", "select=special_law_basis&slug=eq.trust&item=eq.target")).rows, [{ special_law_basis: true }]);
  assert.deepEqual((await anonView("public_dev_method_compare", "select=special_law_basis&slug=eq.trust&item=eq.actor")).rows, [{ special_law_basis: false }]);
  for (const p of ["/realestate/development-methods", "/realestate/development-methods/trust"]) {
    const html = await page(p);
    assert.ok(html.includes(MARK), `${p} 확인 뒤 특례법 요소`);
    assert.ok(html.includes(LAW_URL), `${p} 공포 원문 링크`);
    assert.ok(html.includes("2026-01-02"), `${p} 공포일`);
  }
  assert.ok(!(await page("/realestate/development-methods/redevelopment")).includes(MARK), "표시 없는 방법 상세는 특례법 요소 0");
  const table = await anonView("special_law_confirmations", "select=id");
  assert.ok(table.status === 401 || table.status === 403 || table.status === 404, `anon 표 접근 거부 ${table.status}`);
});

test("e) 글을 고치면 다시 숨김 · 재서명만으로는 숨김 · 다시 확인하면 보임 · 행 철회와 공포 철회로 숨김", async () => {
  const edit = await dm(u.editor, { op: "compare", slug: "trust", item: "target", body: "시험용 고친 글" });
  assert.equal(edit.status, 200, show(edit));
  await signCompare("trust", "target");
  assert.deepEqual((await anonView("public_dev_method_compare", "select=special_law_basis&slug=eq.trust&item=eq.target")).rows, [{ special_law_basis: false }], "고친 뒤");
  assert.ok(!(await page("/realestate/development-methods/trust")).includes(MARK), "고친 뒤 특례법 요소 0");
  const board = (await call("GET", "/special-law", u.admin)).body;
  assert.equal(board.targets.length, 1);
  assert.equal(board.targets[0].confirmed, false);
  const again = await sl(u.admin, { op: "row", target: "compare", slug: "trust", item: "target", status: "enacted", reason: "시험용 다시 확인" });
  assert.equal(again.status, 201, show(again));
  assert.ok((await page("/realestate/development-methods/trust")).includes(MARK), "다시 확인 뒤 보임");
  const wd = await sl(u.admin, { op: "row", target: "compare", slug: "trust", item: "target", status: "withdrawn", reason: "시험용 행 철회" });
  assert.equal(wd.status, 201, show(wd));
  assert.equal(await auditCount("special_law.withdraw", u.admin.id), 1);
  assert.ok(!(await page("/realestate/development-methods/trust")).includes(MARK), "행 철회 뒤 숨김");
  assert.equal((await sl(u.admin, { op: "row", target: "compare", slug: "trust", item: "target", status: "enacted", reason: "시험용 다시" })).status, 201);
  assert.ok((await page("/realestate/development-methods/trust")).includes(MARK));
  const lw = await sl(u.admin, { op: "law", status: "withdrawn", reason: "시험용 공포 철회" });
  assert.equal(lw.status, 201, show(lw));
  assert.equal((await anonView("public_special_law")).rows.length, 0);
  assert.ok(!(await page("/realestate/development-methods/trust")).includes(MARK), "공포 철회 뒤 숨김");
  assert.equal((await one("select count(*)::int n from public.special_law_confirmations")).n, 6, "기록은 지워지지 않고 쌓인다");
});
