// W2-c 5단계 DB — 제휴 규정 버전·실사 점검 기록·기사 생산 읽기 함수·내부 집계 기간 씨앗 (NAV-13 · NAV-14, docs/dev/W2-c_설계.md 2.8·3장·8.5)
//  · 2.8 값 목록 = DB 제약 (플랫폼·상태·심사 기간 잡는 법·점검 종류·점검 상태) · 설정 씨앗 = 2.8 블록, 기준 숫자 칸 0
//  · 규정 버전: 번호는 플랫폼마다 1부터(넣은 값 무시) · 확정에는 원문 URL·확인일·등록 유형·적용 시작일·심사 기간·요건 1개·승인자 필수 ·
//    확정 버전은 고치기·지우기 거부 — 새 버전을 확정해도 앞 버전이 남는다 · 적용 기간·심사 기간 모양 · 이어받기는 같은 플랫폼만
//  · 점검 기록: 추가만(service_role도 고치기·지우기 거부) · 확인은 근거 위치 필수 · 부정평가 위험은 점수·일어난 날 필수
//  · 읽기 함수: [p_from, p_to) 경계(1밀리초 앞 제외·시작 포함·끝 제외) · 근거·권리·사람 반응·최근 유사도·기획 종류·정정·점검·기자·진행 중 기획
//  · RLS: anon·authenticated 두 표 읽기 0·쓰기 거부, 함수 실행 거부(42501) · service_role 실행
// 모든 시험은 트랜잭션 안에서 하고 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

const DESIGN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "dev", "W2-c_설계.md");
const MD = fs.readFileSync(DESIGN, "utf8");

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
    return { ok: false, message: err.message, code: err.code };
  }
}

/** 설계 2.8 소절 */
function section28() {
  const sec = MD.split(/^### /m).find((s) => s.startsWith("2.8"));
  assert.ok(sec, "설계 문서 2.8을 찾지 못했다");
  return sec.split(/^## /m)[0];
}
function list28(name) {
  const line = section28()
    .split("\n")
    .find((l) => l.startsWith(`| ${name} `));
  assert.ok(line, `설계 2.8에 ${name} 줄이 없다`);
  return [...line.split("|")[2].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}
function seed28(key) {
  const m = section28().match(new RegExp(`^#### \`${key}\`\\s*\\n+\`\`\`json\\n([\\s\\S]*?)\\n\`\`\``, "m"));
  assert.ok(m, `설계 2.8에 ${key} 블록이 없다`);
  return JSON.parse(m[1]);
}

let seq = 0;
const uniq = (p) => `${p}-${process.pid}-${++seq}`;
const ITEM = {
  key: "own_ratio",
  label: "자체 생산 기사 비율",
  metric: "ratio",
  numerator: { contentTypes: ["reported_news"] },
  denominator: {},
  numeratorText: "자체 취재 보도기사",
  denominatorText: "전체 발행 기사",
  exclusionsText: "금주 핫뉴스·칼럼·광고",
  criterion: null,
};
const READY = {
  media_type: "인터넷신문",
  source_url: "https://example.test/rules/2026",
  source_text_ref: "공유 드라이브 규정/2026 원문 제3조",
  checked_at: "2026-10-10",
  effective_from: "2026-03-01",
  review_period: JSON.stringify({ months: 3, basis: "closed_months", text: "과거 1년 중 임의의 3개월" }),
  requirements: JSON.stringify([ITEM]),
};

/** 규정 버전 한 줄 (service_role 소유 연결 — 트리거·제약을 그대로 지난다) */
async function requirement(cols = {}) {
  const all = { platform: "naver", title: "시험 규정", created_by: "user:00000000-0000-4000-8000-000000000001", ...cols };
  const keys = Object.keys(all);
  return (await client.query(`insert into public.news_partner_requirements (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, Object.values(all))).rows[0];
}
const confirm = (id, role = null) =>
  attempt("update public.news_partner_requirements set status = 'confirmed', approved_by = 'user:00000000-0000-4000-8000-000000000002', approved_at = now() where id = $1 returning *", [id], role);

// ── 값 목록 · 씨앗 ─────────────────────────────────────────

test("설계 2.8 값 목록 = DB 제약 — 표의 값은 저장되고 목록 밖 값은 check 위반", async () => {
  await tx(async () => {
    for (const platform of list28("news_partner_requirements.platform")) assert.ok((await attempt("insert into public.news_partner_requirements (platform, title, created_by) values ($1, 't', 'user:x')", [platform])).ok, platform);
    assert.equal((await attempt("insert into public.news_partner_requirements (platform, title, created_by) values ('daum', 't', 'user:x')")).code, "23514");
    const statuses = list28("news_partner_requirements.status");
    assert.deepEqual(statuses, ["unconfirmed", "confirmed"]);
    assert.equal((await attempt("insert into public.news_partner_requirements (platform, title, created_by, status) values ('naver', 't', 'user:x', 'approved')")).code, "23514");
    for (const basis of list28("review_period.basis")) {
      const r = await attempt("insert into public.news_partner_requirements (platform, title, created_by, review_period) values ('naver', 't', 'user:x', $1)", [JSON.stringify({ months: 3, basis })]);
      assert.ok(r.ok, `${basis}: ${r.message}`);
    }
    assert.equal((await attempt("insert into public.news_partner_requirements (platform, title, created_by, review_period) values ('naver', 't', 'user:x', $1)", [JSON.stringify({ months: 3, basis: "rolling" })])).code, "23514");
    for (const kind of list28("news_partner_checks.kind")) {
      const r = await attempt("insert into public.news_partner_checks (kind, item, status, checked_by, points, occurred_at) values ($1, '항목', 'unconfirmed', 'user:x', 1, now())", [kind]);
      assert.ok(r.ok, `${kind}: ${r.message}`);
    }
    assert.equal((await attempt("insert into public.news_partner_checks (kind, item, status, checked_by) values ('naver_score', '항목', 'unconfirmed', 'user:x')")).code, "23514");
    for (const status of list28("news_partner_checks.status")) {
      const r = await attempt("insert into public.news_partner_checks (kind, item, status, evidence_ref, checked_by) values ('registration', '등록 유형', $1, '등록증 사본 위치', 'user:x')", [status]);
      assert.ok(r.ok, `${status}: ${r.message}`);
    }
    assert.equal((await attempt("insert into public.news_partner_checks (kind, item, status, checked_by) values ('registration', '등록 유형', '확인', 'user:x')")).code, "23514");
  });
});

test("설정 씨앗 news_readiness_windows = 설계 2.8 블록 — 기간 정의만, 기준 숫자 칸 0", async () => {
  const { rows } = await client.query("select value from public.settings where key = 'news_readiness_windows'");
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].value, seed28("news_readiness_windows"));
  assert.deepEqual(Object.keys(rows[0].value).sort(), ["basis", "months", "version"]);
  assert.ok(list28("review_period.basis").includes(rows[0].value.basis));
  // 공개 설정 키가 아니다 (anon 0행)
  await tx(async () => {
    const r = await attempt("select key from public.settings where key = 'news_readiness_windows'", [], "anon");
    assert.ok(!r.ok || r.rows.length === 0);
  });
  // 규정 버전은 마이그레이션이 씨앗으로 넣지 않는다 — 원문을 확인한 담당자가 적는다 (NAV-13 '수치 기준을 고정하지 않는다')
  const migrations = fs.readdirSync(path.join(path.dirname(DESIGN), "..", "..", "packages", "db", "supabase", "migrations"));
  for (const name of migrations) {
    const sql = fs.readFileSync(path.join(path.dirname(DESIGN), "..", "..", "packages", "db", "supabase", "migrations", name), "utf8");
    assert.ok(!/insert\s+into\s+public\.news_partner_requirements/i.test(sql), `${name}: 규정 버전 씨앗`);
  }
});

// ── 규정 버전 ──────────────────────────────────────────────

test("규정 버전 번호는 플랫폼마다 1부터 차례로 — 넣은 번호는 무시된다", async () => {
  await tx(async () => {
    const max = async (p) => (await client.query("select coalesce(max(version), 0)::int m from public.news_partner_requirements where platform = $1", [p])).rows[0].m;
    const naver0 = await max("naver");
    const kakao0 = await max("kakao");
    const a = await requirement({ version: 99 });
    const b = await requirement();
    const k = await requirement({ platform: "kakao" });
    assert.deepEqual([a.version, b.version, k.version], [naver0 + 1, naver0 + 2, kakao0 + 1]);
    assert.equal(a.status, "unconfirmed");
    // 번호·플랫폼은 바꿀 수 없다
    assert.equal((await attempt("update public.news_partner_requirements set version = 50 where id = $1", [a.id])).code, "23514");
    assert.equal((await attempt("update public.news_partner_requirements set platform = 'kakao' where id = $1", [a.id])).code, "23514");
  });
});

test("확정에는 원문 URL·확인일·등록 유형·적용 시작일·심사 기간·요건 1개·승인자가 모두 필요 — 하나라도 없으면 거부", async () => {
  await tx(async () => {
    const missing = { source_url: null, checked_at: null, media_type: null, effective_from: null, review_period: null, requirements: "[]" };
    for (const [col, empty] of Object.entries(missing)) {
      const r = await requirement({ ...READY, [col]: empty });
      const c = await confirm(r.id);
      assert.equal(c.ok, false, `${col} 없이 확정됨`);
      assert.equal(c.code, "23514", col);
      assert.match(c.message, /news_partner_requirements_confirm_ready/, col);
    }
    const r = await requirement(READY);
    // 승인자 없이 상태만 확정 — 거부 (확정과 승인은 함께)
    const noApprover = await attempt("update public.news_partner_requirements set status = 'confirmed' where id = $1", [r.id]);
    assert.match(noApprover.message ?? "", /news_partner_requirements_approval/);
    const onlyApprover = await attempt("update public.news_partner_requirements set approved_by = 'user:x', approved_at = now() where id = $1", [r.id]);
    assert.match(onlyApprover.message ?? "", /news_partner_requirements_approval/, "작성 중 버전에 승인 칸만 적으면 거부");
    const blankApprover = await attempt("update public.news_partner_requirements set status = 'confirmed', approved_by = '  ', approved_at = now() where id = $1", [r.id]);
    assert.match(blankApprover.message ?? "", /news_partner_requirements_confirm_ready/);
    const ok = await confirm(r.id);
    assert.ok(ok.ok, ok.message);
    assert.equal(ok.rows[0].status, "confirmed");
  });
});

test("확정된 버전은 고치기·지우기 거부 — 새 버전을 확정해도 앞 버전이 그대로 남는다 / 작성 중 버전은 고치고 지울 수 있다", async () => {
  await tx(async () => {
    const v1 = await requirement(READY);
    assert.ok((await confirm(v1.id)).ok);
    const edit = await attempt("update public.news_partner_requirements set title = '바꾼 제목' where id = $1", [v1.id], "service_role");
    assert.equal(edit.code, "23514");
    assert.match(edit.message, /확정된 규정 버전.*고칠 수 없습니다.*새 버전/);
    const back = await attempt("update public.news_partner_requirements set status = 'unconfirmed', approved_by = null, approved_at = null where id = $1", [v1.id], "service_role");
    assert.equal(back.code, "23514", "확정을 되돌려 고치는 우회 0");
    const del = await attempt("delete from public.news_partner_requirements where id = $1", [v1.id], "service_role");
    assert.equal(del.code, "23514");
    assert.match(del.message, /지울 수 없습니다/);

    const v2 = await requirement({ ...READY, title: "다음 규정", supersedes_id: v1.id });
    assert.ok((await confirm(v2.id)).ok);
    const { rows } = await client.query("select id, status, title from public.news_partner_requirements where id = any($1::bigint[]) order by id", [[v1.id, v2.id]]);
    assert.deepEqual(rows.map((r) => [r.status, r.title]), [["confirmed", "시험 규정"], ["confirmed", "다음 규정"]]);

    const draft = await requirement({ title: "작성 중" });
    assert.ok((await attempt("update public.news_partner_requirements set title = '작성 중 고침' where id = $1", [draft.id], "service_role")).ok);
    assert.equal((await attempt("delete from public.news_partner_requirements where id = $1", [draft.id], "service_role")).rowCount, 1);
  });
});

test("적용 기간 — 끝날이 시작일보다 앞이면 거부, 같은 날은 된다 · 심사 기간은 1~12 정수 달과 잡는 법 · 원문 주소는 http(s)만 · 이어받기는 같은 플랫폼만", async () => {
  await tx(async () => {
    assert.match((await attempt("insert into public.news_partner_requirements (platform, title, created_by, effective_from, effective_to) values ('naver', 't', 'u', '2026-03-02', '2026-03-01')")).message, /effective_period/);
    assert.ok((await attempt("insert into public.news_partner_requirements (platform, title, created_by, effective_from, effective_to) values ('naver', 't', 'u', '2026-03-01', '2026-03-01')")).ok);
    for (const months of [0, 13, 3.5, "3"]) {
      const r = await attempt("insert into public.news_partner_requirements (platform, title, created_by, review_period) values ('naver', 't', 'u', $1)", [JSON.stringify({ months, basis: "closed_months" })]);
      assert.match(r.message ?? "", /review_period_shape/, String(months));
    }
    assert.ok((await attempt("insert into public.news_partner_requirements (platform, title, created_by, review_period) values ('naver', 't', 'u', $1)", [JSON.stringify({ months: 12, basis: "including_current" })])).ok);
    for (const url of ["javascript:alert(1)", "ftp://example.test/r", "https://exa mple.test"]) {
      assert.equal((await attempt("insert into public.news_partner_requirements (platform, title, created_by, source_url) values ('naver', 't', 'u', $1)", [url])).code, "23514", url);
    }
    assert.equal((await attempt("insert into public.news_partner_requirements (platform, title, created_by, requirements) values ('naver', 't', 'u', '{}')")).code, "23514", "요건은 배열");
    const naver = await requirement();
    const cross = await attempt("insert into public.news_partner_requirements (platform, title, created_by, supersedes_id) values ('kakao', 't', 'u', $1)", [naver.id]);
    assert.match(cross.message ?? "", /같은 플랫폼/);
  });
});

// ── 실사·점검 기록 ─────────────────────────────────────────

test("점검 기록은 추가만 — service_role도 고치기·지우기 거부, 확인은 근거 위치 필수, 부정평가 위험은 점수·일어난 날 필수", async () => {
  await tx(async () => {
    const row = (await client.query("insert into public.news_partner_checks (kind, item, status, evidence_ref, checked_by) values ('registration', '등록 유형', 'confirmed', '등록증 사본 위치', 'user:x') returning id")).rows[0];
    assert.equal((await attempt("update public.news_partner_checks set status = 'unconfirmed' where id = $1", [row.id], "service_role")).code, "42501");
    assert.equal((await attempt("delete from public.news_partner_checks where id = $1", [row.id], "service_role")).code, "42501");
    assert.match((await attempt("insert into public.news_partner_checks (kind, item, status, checked_by) values ('registration', '등록 유형', 'confirmed', 'user:x')")).message, /confirmed_evidence/);
    assert.match((await attempt("insert into public.news_partner_checks (kind, item, status, checked_by) values ('penalty_risk', '광고성 기사 우려', 'unconfirmed', 'user:x')")).message, /news_partner_checks_penalty/);
    const next = await attempt("insert into public.news_partner_checks (kind, item, status, evidence_ref, checked_by, supersedes_id) values ('registration', '등록 유형', 'confirmed', '새 등록증', 'user:x', $1)", [row.id]);
    assert.ok(next.ok, "새 판은 새 행");
  });
});

// ── 권한 ──────────────────────────────────────────────────

test("RLS — anon·authenticated는 두 표 읽기 0·쓰기 거부, 읽기 함수 실행 거부(42501) / service_role은 읽기·쓰기·실행", async () => {
  await tx(async () => {
    await requirement(READY);
    await client.query("insert into public.news_partner_checks (kind, item, status, checked_by) values ('document', '규정 원문', 'unconfirmed', 'user:x')");
    for (const role of ["anon", "authenticated"]) {
      for (const table of ["news_partner_requirements", "news_partner_checks"]) {
        const r = await attempt(`select count(*)::int n from public.${table}`, [], role);
        assert.ok(!r.ok || r.rows[0].n === 0, `${role} ${table} 읽기`);
      }
      assert.equal((await attempt("insert into public.news_partner_requirements (platform, title, created_by) values ('naver', 't', 'u')", [], role)).code, "42501");
      assert.equal((await attempt("insert into public.news_partner_checks (kind, item, status, checked_by) values ('document', 'x', 'unconfirmed', 'u')", [], role)).code, "42501");
      assert.equal((await attempt("select public.news_production_facts('2001-01-01T00:00:00Z', '2001-02-01T00:00:00Z')", [], role)).code, "42501", `${role} 함수 실행`);
    }
    const svc = await attempt("select public.news_production_facts('2001-01-01T00:00:00Z', '2001-02-01T00:00:00Z') f", [], "service_role");
    assert.ok(svc.ok, svc.message);
    assert.ok((await attempt("select count(*) from public.news_partner_requirements", [], "service_role")).ok);
  });
});

// ── 기사 생산 읽기 함수 ───────────────────────────────────

const FROM = "2001-03-31T15:00:00Z"; // 한국 2001-04-01 0시
const TO = "2001-06-30T15:00:00Z"; // 한국 2001-07-01 0시
const at = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();

async function article(cols) {
  const all = { slug: uniq("e2e-facts"), title: "생산 시험", section: "tax", content_type: "explainer", status: "published", ...cols };
  const keys = Object.keys(all);
  return (await client.query(`insert into public.articles (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, Object.values(all))).rows[0].id;
}
const personRow = async (name, roles = "{reporter}", employment = "staff") =>
  (await client.query("insert into public.people (slug, name, roles, employment) values ($1, $2, $3, $4) returning id", [uniq("facts-p"), name, roles, employment])).rows[0].id;

test("읽기 함수 — [p_from, p_to) 경계, 기사마다 근거·권리·승인·감수·사람 반응·최근 유사도·기획 종류, 기간 안 정정·점검, 기자·진행 중 기획", async () => {
  await tx(async () => {
    const reporter = await personRow("생산 시험 기자");
    const editor = await personRow("생산 시험 편집자", "{editor}");
    const writer = await personRow("외부 필자", "{writer}", "external");
    const feature = (
      await client.query(
        "insert into public.story_assignments (section, kind, status, reporter_id, editor_id, conflicts, relevance) values ('tax', 'feature', 'assigned', $1, $2, '없음', '세수') returning id",
        [reporter, editor],
      )
    ).rows[0].id;
    await client.query("insert into public.story_assignments (section, kind, status, reporter_id, editor_id, conflicts, relevance) values ('tax', 'general', 'reporting', $1, $2, '없음', '세수')", [reporter, editor]);
    const confirmed = (await client.query("insert into public.media (path, kind, rights_status, credit, license, checked_at, photographer) values ('f/ok.png', 'photo', 'confirmed', '편집국', '자체', now(), '김') returning id")).rows[0].id;
    const unconfirmed = (await client.query("insert into public.media (path, kind) values ('f/no.png', 'photo') returning id")).rows[0].id;

    const before = await article({ first_published_at: at(FROM, -1), author_id: reporter });
    const first = await article({
      first_published_at: FROM,
      author_id: reporter,
      content_type: "reported_news",
      reporting_method: "quantitative",
      story_assignment_id: feature,
      tax_review_status: "pending",
      body: JSON.stringify({ blocks: [{ type: "image", mediaId: String(unconfirmed) }, { type: "image", mediaId: String(confirmed) }], claims: [] }),
    });
    // 칼럼 발행은 필자의 활성 이름·초상 동의서가 필요하다 (W3 7단계) — 시험용 동의서
    await client.query("insert into public.name_likeness_consents (person_id, version, scope, doc_ref, recorded_by) values ($1, '시험용', array['column'], '시험용 위치', 'admin:test')", [writer]);
    const held = await article({ first_published_at: at(FROM, 3_600_000), status: "held", author_id: writer, content_type: "opinion" });
    const last = await article({ first_published_at: at(TO, -1), author_id: writer, content_type: "opinion" });
    const after = await article({ first_published_at: TO, author_id: reporter });
    await client.query("insert into public.editorial_reviews (article_id, kind, reviewer_id, decision) values ($1, 'desk_edit', $2, 'approve')", [first, editor]);
    await client.query(
      "insert into public.article_evidence (article_id, evidence_type, location, rights_status, verification_status) values ($1, 'dataset', '보관함/1', 'confirmed', 'verified'), ($1, 'interview', '보관함/2', 'unconfirmed', 'pending')",
      [first],
    );
    await client.query("insert into public.article_stats (article_id, hour, views_all, views_human, shares, engaged_views) values ($1, '2001-04-02T01:00:00Z', 9, 7, 1, 3), ($1, '2001-08-02T01:00:00Z', 2, 2, 0, 1)", [first]);
    const check = (id, status, when) =>
      client.query(
        "insert into public.seo_checks (target_type, target_id, rules_version, engine_version, scores, similarity, checked_at, checked_by) values ('article', $1, 'r', 'e', '{\"seo\":1,\"aeo\":1,\"geo\":1,\"common\":1}', $2, $3, 'editor')",
        [String(id), JSON.stringify({ status }), when],
      );
    await check(first, "blocked", at(FROM, 1_000));
    await check(first, "pass", at(FROM, 2_000));
    await check(last, "no_sources", at(TO, 5_000)); // 기간 뒤 점검 — 점검 목록 0, 최근 상태는 남는다
    await client.query("insert into public.article_corrections (article_id, kind, reason, decided_by, created_at) values ($1, 'rebuttal', '반론 게재', 'user:x', $2), ($1, 'follow_up', '추후보도', 'user:x', $3)", [
      first,
      at(FROM, 86_400_000),
      at(TO, 0),
    ]);

    const { rows } = await client.query("select public.news_production_facts($1, $2) f", [FROM, TO]);
    const f = rows[0].f;
    const ids = f.articles.map((a) => Number(a.id));
    assert.deepEqual(ids, [first, held, last].map(Number), "1밀리초 앞 제외 · 시작 포함 · 끝 1밀리초 앞 포함 · 끝 제외 (보류 기사도 사실로 온다 — 빼는 일은 규칙)");
    assert.ok(!ids.includes(Number(before)) && !ids.includes(Number(after)));
    const a = f.articles[0];
    assert.equal(Date.parse(a.published_at), Date.parse(FROM));
    assert.deepEqual(
      {
        content_type: a.content_type,
        reporting_method: a.reporting_method,
        status: a.status,
        assignment_kind: a.assignment_kind,
        editorial_status: a.editorial_status,
        tax_review_status: a.tax_review_status,
        evidence_total: a.evidence_total,
        evidence_verified: a.evidence_verified,
        evidence_rights_unconfirmed: a.evidence_rights_unconfirmed,
        media_unconfirmed: a.media_unconfirmed,
        views_human: a.views_human,
        engaged_views: a.engaged_views,
        shares: a.shares,
        last_similarity: a.last_similarity,
      },
      {
        content_type: "reported_news",
        reporting_method: "quantitative",
        status: "published",
        assignment_kind: "feature",
        editorial_status: "approved",
        tax_review_status: "pending",
        evidence_total: 2,
        evidence_verified: 1,
        evidence_rights_unconfirmed: 1,
        media_unconfirmed: 1,
        views_human: 9,
        engaged_views: 4,
        shares: 1,
        last_similarity: "pass",
      },
    );
    assert.equal(f.articles[2].last_similarity, "no_sources", "가장 최근 점검 상태");
    assert.equal(f.articles[1].assignment_kind, null);
    assert.deepEqual(f.corrections.map((c) => [Number(c.article_id), c.kind]), [[Number(first), "rebuttal"]], "기간 안 정정만");
    assert.deepEqual(f.similarity_checks.map((c) => [Number(c.article_id), c.status]), [[Number(first), "blocked"], [Number(first), "pass"]], "기간 안 점검만");
    const people = new Map(f.people.map((p) => [Number(p.id), p]));
    assert.deepEqual([...people.keys()].filter((id) => [reporter, writer, editor].map(Number).includes(id)).sort(), [reporter, writer].map(Number).sort(), "기간 기사 작성자 + 진행 중 기획 기자");
    assert.deepEqual(people.get(Number(writer)), { id: Number(writer), name: "외부 필자", roles: ["writer"], employment: "external" });
    assert.equal(f.open_assignments.find((o) => Number(o.reporter_id) === Number(reporter)).count, 2, "진행 중 기획 2건 (assigned·reporting)");

    assert.match((await attempt("select public.news_production_facts($1, $1)", [FROM])).message, /기간이 틀렸습니다/);
    assert.match((await attempt("select public.news_production_facts('2001-01-01T00:00:00Z', '2003-12-31T00:00:00Z')")).message, /800일/);
  });
});
