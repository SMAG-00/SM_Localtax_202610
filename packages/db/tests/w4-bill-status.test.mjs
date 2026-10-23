// W4 20단계 뒷부분 DB — 기사 '법안 상태를 다룸' 발행 검사 (docs/dev/W4_설계.md 1장 20단계 · 11.20 · 12장 #169, 마이그레이션 20261023000054 · PRD-01B PR-13)
//  · 표시(covers_bill_status) 기본 false — 켜지 않은 기사는 출처가 없어도 그대로 발행
//  · 표시를 켠 기사는 공식 자료 출처(출처 주소 + 확인일) 없이 발행·예약 거부(문장에 빠진 것) · 있으면 발행
//  · 이미 발행된 기사에 표시만 켜도 같은 검사 · 대체된 옛 판 출처만 있으면 거부 · 출처 종류가 공식 자료가 아니면(보도자료) 거부
//  · 함수 실행 권한 0
// 모든 시험은 거래 안에서 돌고 되돌린다 (남는 행 0). 기사·출처 내용은 시험용 가짜다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
});
after(async () => client?.end());

async function attempt(sql, params = []) {
  await client.query("savepoint t");
  try {
    const res = await client.query(sql, params);
    await client.query("release savepoint t");
    return { ok: true, rows: res.rows, rowCount: res.rowCount };
  } catch (err) {
    await client.query("rollback to savepoint t");
    return { ok: false, message: err.message, code: err.code };
  }
}
async function tx(fn) {
  await client.query("begin");
  try {
    return await fn();
  } finally {
    await client.query("rollback");
  }
}

let seq = 0;
const one = async (sql, params) => (await client.query(sql, params)).rows[0];
const draft = (over = {}) => {
  const row = { slug: `w4bs-${process.pid}-${++seq}`, title: "시험용 법안 상태 기사", section: "tax", content_type: "reported_news", status: "draft", ...over };
  const keys = Object.keys(row);
  return client.query(`insert into public.articles (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, keys.map((k) => row[k])).then((r) => r.rows[0]);
};
const OFFICIAL = {
  kind: "official_doc",
  title: "시험용 공식 자료",
  source_url: "https://gasang.example/bill/1",
  source_name: "시험용 기관",
  last_verified_at: "2026-10-20T09:00:00+09:00",
  license_status: "출처표시",
  license_type: "kogl_1",
  published_on: "2026-10-01",
  reference_date: "2026-10-01",
  region_unit: "전국",
  collected_at: "2026-10-20T09:00:00+09:00",
};
const addSource = (articleId, over = {}) => {
  const row = { article_id: articleId, ...OFFICIAL, ...over };
  const keys = Object.keys(row);
  return attempt(`insert into public.article_sources (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, keys.map((k) => row[k]));
};
const publish = (id) => attempt("update public.articles set status = 'published' where id = $1 returning status", [id]);

test("표시 칸 기본값 — covers_bill_status는 false, 켜지 않은 기사는 출처 0건이어도 발행된다 (달라진 것 없음)", async () => {
  await tx(async () => {
    const a = await draft();
    assert.equal(a.covers_bill_status, false);
    const r = await publish(a.id);
    assert.ok(r.ok, r.message);
    assert.equal(r.rows[0].status, "published");
  });
});

test("표시 켬 + 출처 0건 — 발행 거부, 문장에 공식 자료 출처가 필요하다고 나온다", async () => {
  await tx(async () => {
    const a = await draft({ covers_bill_status: true });
    const r = await publish(a.id);
    assert.equal(r.ok, false);
    assert.equal(r.code, "23514");
    assert.match(r.message, /법안 상태를 다룬 기사는 공식 자료 출처가 1건 이상/);
    assert.equal((await one("select status from public.articles where id = $1", [a.id])).status, "draft");
  });
});

test("표시 켬 + 공식 자료(출처 주소·확인일 있음) 1건 — 발행된다", async () => {
  await tx(async () => {
    const a = await draft({ covers_bill_status: true });
    const s = await addSource(a.id);
    assert.ok(s.ok, s.message);
    const r = await publish(a.id);
    assert.ok(r.ok, r.message);
  });
});

test("표시 켬 + 보도자료 출처만 — 공식 자료가 아니므로 발행 거부", async () => {
  await tx(async () => {
    const a = await draft({ covers_bill_status: true });
    const s = await addSource(a.id, { kind: "press_release" });
    assert.ok(s.ok, s.message);
    const r = await publish(a.id);
    assert.equal(r.ok, false);
    assert.match(r.message, /공식 자료 출처가 1건 이상/);
  });
});

test("표시 켬 + 공식 자료가 새 판으로 대체됨 — 대체된 옛 판은 세지 않고 새 판이 있으면 발행된다", async () => {
  await tx(async () => {
    const a = await draft({ covers_bill_status: true });
    const old = await addSource(a.id);
    assert.ok(old.ok, old.message);
    const fresh = await addSource(a.id, { supersedes_id: old.rows[0].id, revision_reason: "시험용 정정", title: "시험용 공식 자료(정정)" });
    assert.ok(fresh.ok, fresh.message);
    assert.ok((await publish(a.id)).ok);
  });
});

test("예약(scheduled)도 같은 검사 — 출처 0건이면 거부", async () => {
  await tx(async () => {
    const a = await draft({ covers_bill_status: true });
    const r = await attempt("update public.articles set status = 'scheduled', publish_at = now() + interval '1 day' where id = $1", [a.id]);
    assert.equal(r.ok, false);
    assert.match(r.message, /법안 상태를 다룬 기사/);
  });
});

test("이미 발행된 기사에 표시만 켜기 — 출처 없으면 거부, 출처를 먼저 더하면 켜진다", async () => {
  await tx(async () => {
    const a = await draft();
    assert.ok((await publish(a.id)).ok);
    const denied = await attempt("update public.articles set covers_bill_status = true where id = $1", [a.id]);
    assert.equal(denied.ok, false);
    assert.match(denied.message, /법안 상태를 다룬 기사/);
    assert.ok((await addSource(a.id)).ok);
    const ok = await attempt("update public.articles set covers_bill_status = true where id = $1 returning covers_bill_status", [a.id]);
    assert.ok(ok.ok, ok.message);
    assert.equal(ok.rows[0].covers_bill_status, true);
  });
});

test("표시 켠 채 초안 저장 — 출처 없이도 저장은 된다 (막는 것은 발행뿐)", async () => {
  await tx(async () => {
    const a = await draft({ covers_bill_status: true });
    const r = await attempt("update public.articles set title = '시험용 고친 제목' where id = $1 returning title", [a.id]);
    assert.ok(r.ok, r.message);
  });
});

test("함수 실행 권한 — anon·authenticated는 검사 함수를 부를 수 없다", async () => {
  for (const fn of ["public.bill_status_publish_problem(public.articles)", "public.articles_bill_status_guard()"]) {
    const rows = (await client.query("select has_function_privilege('anon', $1, 'execute') a, has_function_privilege('authenticated', $1, 'execute') b", [fn])).rows[0];
    assert.deepEqual(rows, { a: false, b: false }, fn);
  }
});
