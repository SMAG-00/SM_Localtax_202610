// W4 6단계 DB — 원문 변경·시점 만료 검수 큐 (docs/dev/W4_설계.md 1장 6단계 · 2.1 · 2.2 · 3장 · 12장 #23, 마이그레이션 20261022000042 · PRD-01B REG1-13)
//  · 값 목록 — 대상 3종·사유 2종·상태 2종 = 설계 2.1 글자(DB check) · 설정 씨앗 official_source_expiry_days = 2.2(365), 1~3650 정수만
//  · 원문 다시 받기 — 같은 주소를 쓴 공식 자료(기사 N개)의 스냅샷 해시와 다르면 기사마다 항목 1건(기사 번호·옛/새 해시·새 스냅샷), 같은 해시 0,
//    같은 새 해시로 다시 0, 열린 항목이 있으면 다른 새 해시도 0, 대체된 옛 판·삭제 기사·보도자료·다른 주소 0, 스냅샷 없는 출처는 비교 0(센 수만),
//    새 스냅샷은 한 번만(같은 주소·해시는 기존 행), 출처 행은 그대로
//  · 시점 만료 — 확인일(한국 날짜)부터 365일째 0건 · 366일째 1건(00:30 KST 확인 = 전날 15:30 UTC도 한국 날짜로), 초안·대체된 판 0,
//    같은 날 두 번 = 한 벌, 해결 뒤 같은 확인일로는 다시 0, 확인일을 새로 적으면 그 날부터 다시 잰다, 설정을 바꾸면 다음 실행부터
//  · 해결 — 열린 항목만 해결(사람·시각 필수), 다른 칸 고치기·다시 열기 거부 · 대상 검사(공식 자료만·기사 번호 일치·아직 없는 대상 종류 거부)
//  · 권한 — 큐는 anon·authenticated 0(권한 거부), 함수 실행 0 · 공개 뷰는 공개 기사의 열린 항목의 출처 번호만(사유·해시 칸 0)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESIGN = fs.readFileSync(path.join(HERE, "..", "..", "..", "docs", "dev", "W4_설계.md"), "utf8");
const line = (prefix) => {
  const l = DESIGN.split("\n").find((x) => x.startsWith(prefix));
  assert.ok(l, `설계 문서에 '${prefix}' 줄이 없다`);
  return l;
};
const codes = (prefix, col = 2) => [...line(prefix).split("|")[col].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const TARGETS = codes("| source_review.target |");
const REASONS = codes("| source_review.reason |");
const STATUSES = codes("| source_review.status |");
const EXPIRY_SEED = Number(codes("| `official_source_expiry_days` |")[0]);

let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
});
after(async () => client?.end());

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

async function tx(fn) {
  await client.query("begin");
  try {
    return await fn();
  } finally {
    await client.query("rollback");
  }
}

let seq = 0;
const uniq = (p) => `${p}-${process.pid}-${++seq}`;
const hashOf = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const one = async (sql, params) => (await client.query(sql, params)).rows[0];

async function article(over = {}) {
  const row = { slug: uniq("w4sr"), title: "시험용 검수 큐 기사", section: "local", content_type: "reported_news", status: "draft", ...over };
  const keys = Object.keys(row);
  return (await client.query(`insert into public.articles (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, keys.map((k) => row[k]))).rows[0];
}

/** 시험용 원본 스냅샷 (가짜 주소·가짜 글자) */
async function snapshot(url, text) {
  return (await client.query("insert into public.raw_snapshots (source, url, content_hash, payload) values ('시험용', $1, $2, $3) returning *", [url, hashOf(text), text])).rows[0];
}

/** 공식 자료 한 행 — 칸이 모두 찬 모양 (가짜 발표기관·가짜 주소) */
async function officialSource(articleId, over = {}) {
  const row = {
    article_id: articleId,
    kind: "dataset",
    title: "시험용 가상구 지방세 세수 결산",
    source_url: "https://gasang.example/open/tax-2026",
    source_name: "시험용 가상구청",
    last_verified_at: "2026-10-20T10:00:00+09:00",
    license_status: "공공누리 제1유형",
    license_type: "kogl_1",
    source_type: "local_tax_revenue",
    published_on: "2026-10-01",
    reference_date: "2026-06-30",
    region_unit: "시·군·구",
    collected_at: "2026-10-15T09:00:00+09:00",
    ...over,
  };
  const keys = Object.keys(row);
  return (await client.query(`insert into public.article_sources (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, keys.map((k) => row[k]))).rows[0];
}

const refetch = (url, text, actor = "user:w4sr-test") =>
  one("select public.source_snapshot_refetched($1, $2, $3, '시험용 다시 받기', $4) r", [url, hashOf(text), text, actor]).then((x) => x.r);
const scan = (today) => one("select public.source_expiry_scan($1::date) r", [today]).then((x) => x.r);
const queueOf = (ids) =>
  client.query("select * from public.source_review_queue where target_type = 'article_source' and target_id = any($1::bigint[]) order by target_id, id", [ids]).then((r) => r.rows);
const checkValues = async (constraint) => {
  const def = (await client.query("select pg_get_constraintdef(oid) d from pg_constraint where conrelid = 'public.source_review_queue'::regclass and conname = $1", [constraint])).rows[0]?.d ?? "";
  return [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
};

test("값 목록 — 대상 3종·사유 2종·상태 2종 = 설계 2.1 글자(DB check), 만료 기준 씨앗 = 2.2(365)", async () => {
  assert.deepEqual(TARGETS, ["article_source", "project_event", "dev_method_fact"]);
  assert.deepEqual(REASONS, ["snapshot_changed", "expired"]);
  assert.deepEqual(STATUSES, ["open", "resolved"]);
  assert.deepEqual(await checkValues("source_review_queue_target_type_check"), TARGETS);
  assert.deepEqual(await checkValues("source_review_queue_reason_check"), REASONS);
  assert.deepEqual(await checkValues("source_review_queue_status_check"), STATUSES);
  assert.equal(EXPIRY_SEED, 365);
  assert.equal((await one("select value from public.settings where key = 'official_source_expiry_days'")).value, EXPIRY_SEED);
});

test("만료 기준 설정 — 1~3650 정수만 (0·3651·소수·글자·목록 거부), 30은 저장", () =>
  tx(async () => {
    for (const bad of [0, 3651, 365.5, "365", [365], { days: 365 }, -1]) {
      const r = await attempt("update public.settings set value = $1::jsonb where key = 'official_source_expiry_days'", [JSON.stringify(bad)]);
      assert.equal(r.ok, false, JSON.stringify(bad));
      assert.equal(r.code, "23514");
      assert.match(r.message, /1~3650 정수/);
    }
    for (const okValue of [1, 30, 3650]) assert.ok((await attempt("update public.settings set value = $1::jsonb where key = 'official_source_expiry_days'", [JSON.stringify(okValue)])).ok, String(okValue));
  }));

test("원문 다시 받기 — 해시가 다르면 그 주소를 쓴 기사마다 1건, 같은 해시 0, 같은 새 해시·열린 항목이 있으면 0, 대체된 판·삭제 기사·보도자료·다른 주소 0", () =>
  tx(async () => {
    const url = `https://gasang.example/open/${uniq("refetch")}`;
    const OLD = "시험용 가상구 세수 결산 원문 — 처음 받은 판";
    const NEW = "시험용 가상구 세수 결산 원문 — 발표기관이 고친 판";
    const snap = await snapshot(url, OLD);
    const a1 = await article({ status: "published" });
    const a2 = await article();
    const a3 = await article({ status: "published" });
    const s1 = await officialSource(a1.id, { source_url: url, snapshot_id: snap.id });
    const s2 = await officialSource(a2.id, { source_url: url, snapshot_id: snap.id, kind: "official_doc", source_type: null });
    const s3old = await officialSource(a3.id, { source_url: url, snapshot_id: snap.id });
    const s3 = await officialSource(a3.id, { source_url: url, snapshot_id: snap.id, supersedes_id: s3old.id, revision_reason: "시험용 새 버전" });
    // 비교 밖 — 삭제 기사 · 보도자료(같은 주소) · 다른 주소 · 스냅샷 없는 공식 자료(센 수만)
    const gone = await article({ status: "deleted" });
    const sGone = await officialSource(gone.id, { source_url: url, snapshot_id: snap.id });
    const press = (await client.query("insert into public.article_sources (article_id, kind, title, source_url, license_type, snapshot_id) values ($1, 'press_release', '시험용 보도자료', $2, 'kogl_1', $3) returning *", [a1.id, url, snap.id])).rows[0];
    const other = await officialSource(a1.id, { source_url: `${url}-other`, snapshot_id: snap.id });
    const a4 = await article();
    const noSnap = await officialSource(a4.id, { source_url: url });
    const sourcesBefore = (await client.query("select * from public.article_sources where id = any($1::bigint[]) order by id", [[s1.id, s2.id, s3.id, s3old.id, noSnap.id]])).rows;
    const snapsBefore = Number((await one("select count(*)::int n from public.raw_snapshots where url = $1", [url])).n);

    // 같은 원문(같은 해시) → 0건, 새 스냅샷 0 (기존 행을 쓴다)
    const same = await refetch(url, OLD);
    assert.deepEqual({ ...same, snapshotId: undefined }, { snapshotId: undefined, targets: 4, opened: 0, unchanged: 3, alreadyQueued: 0, noSnapshot: 1 });
    assert.equal(Number(same.snapshotId), Number(snap.id), "같은 주소·같은 해시는 기존 스냅샷");
    assert.deepEqual(await queueOf([s1.id, s2.id, s3.id, s3old.id, sGone.id, press.id, other.id, noSnap.id]), [], "같은 해시 → 큐 0");

    // 다른 원문 → 기사 3개(s1·s2·s3)마다 1건 · 기사 번호·옛/새 해시·새 스냅샷
    const changed = await refetch(url, NEW);
    assert.equal(changed.opened, 3, JSON.stringify(changed));
    assert.equal(changed.noSnapshot, 1);
    const q = await queueOf([s1.id, s2.id, s3.id, s3old.id, sGone.id, press.id, other.id, noSnap.id]);
    assert.deepEqual(q.map((r) => [Number(r.target_id), Number(r.article_id)]), [[s1.id, a1.id], [s2.id, a2.id], [s3.id, a3.id]].map(([x, y]) => [Number(x), Number(y)]));
    for (const r of q) {
      assert.equal(r.reason, "snapshot_changed");
      assert.equal(r.status, "open");
      assert.equal(r.old_hash, hashOf(OLD));
      assert.equal(r.new_hash, hashOf(NEW));
      assert.equal(Number(r.new_snapshot_id), Number(changed.snapshotId));
      assert.equal(r.opened_by, "user:w4sr-test");
    }
    const newSnap = await one("select url, content_hash, payload from public.raw_snapshots where id = $1", [changed.snapshotId]);
    assert.deepEqual(newSnap, { url, content_hash: hashOf(NEW), payload: NEW });
    assert.equal(Number((await one("select count(*)::int n from public.raw_snapshots where url = $1", [url])).n), snapsBefore + 1, "새 스냅샷 1행");
    assert.deepEqual((await client.query("select * from public.article_sources where id = any($1::bigint[]) order by id", [[s1.id, s2.id, s3.id, s3old.id, noSnap.id]])).rows, sourcesBefore, "출처 행은 그대로 (스냅샷 번호도)");

    // 같은 새 원문 다시 → 0 (같은 해시로는 한 번) · 열린 항목이 있는데 또 다른 원문 → 0 (대상·사유마다 열린 항목 하나)
    const again = await refetch(url, NEW);
    assert.deepEqual([again.opened, again.alreadyQueued, Number(again.snapshotId)], [0, 3, Number(changed.snapshotId)]);
    const third = await refetch(url, "시험용 가상구 세수 결산 원문 — 세 번째 판");
    assert.deepEqual([third.opened, third.alreadyQueued], [0, 3]);
    assert.equal((await queueOf([s1.id, s2.id, s3.id])).length, 3, "기사마다 1건 그대로");

    // 해결한 뒤 같은 새 해시로 다시 받기 → 0, 다른 새 해시 → 다시 1건씩
    await client.query("update public.source_review_queue set status = 'resolved', resolved_by = 'user:w4sr-test', resolved_at = now() where target_id = any($1::bigint[])", [[s1.id, s2.id, s3.id]]);
    assert.equal((await refetch(url, NEW)).opened, 0, "검수한 해시로는 다시 열지 않는다");
    assert.equal((await refetch(url, "시험용 가상구 세수 결산 원문 — 네 번째 판")).opened, 3);

    // 입력 검사
    for (const [u, h] of [["ftp://gasang.example/x", hashOf("x")], [url, "abc"], [url, `md5:${"0".repeat(64)}`]]) {
      const r = await attempt("select public.source_snapshot_refetched($1, $2, 'x', null, 'user:t')", [u, h]);
      assert.equal(r.ok, false, `${u} ${h}`);
    }
    assert.equal((await attempt("select public.source_snapshot_refetched($1, $2, 'x', null, ' ')", [url, hashOf("x")])).ok, false, "받은 사람 없음");
  }));

test("시점 만료 — 확인일(한국 날짜)부터 365일째 0건·366일째 1건, 00:30 KST 확인도 한국 날짜로, 초안·대체된 판 0, 같은 날 두 번 = 한 벌", () =>
  tx(async () => {
    const TODAY = "2027-10-22";
    const pub = await article({ status: "published" });
    const draft = await article();
    // 2026-10-22 = 365일 전 · 2026-10-21 = 366일 전 · 2026-10-23 = 364일 전 (KST)
    const day365 = await officialSource(pub.id, { last_verified_at: "2026-10-22T23:50:00+09:00", source_url: "https://gasang.example/d365" });
    const day366 = await officialSource(pub.id, { last_verified_at: "2026-10-21T10:00:00+09:00", source_url: "https://gasang.example/d366" });
    // 00:30 KST = 전날 15:30 UTC — UTC 날짜로 재면 366일, 한국 날짜로는 365일 → 0건
    const early365 = await officialSource(pub.id, { last_verified_at: "2026-10-22T00:30:00+09:00", source_url: "https://gasang.example/e365" });
    // 23:30 KST(14:30 UTC) 2026-10-21 → 366일 → 1건
    const late366 = await officialSource(pub.id, { last_verified_at: "2026-10-21T23:30:00+09:00", source_url: "https://gasang.example/l366" });
    const day364 = await officialSource(pub.id, { last_verified_at: "2026-10-23T09:00:00+09:00", source_url: "https://gasang.example/d364" });
    const draftOld = await officialSource(draft.id, { last_verified_at: "2025-01-01T09:00:00+09:00" });
    const oldVersion = await officialSource(pub.id, { last_verified_at: "2025-01-01T09:00:00+09:00", source_url: "https://gasang.example/v1" });
    const newVersion = await officialSource(pub.id, { last_verified_at: "2027-10-01T09:00:00+09:00", source_url: "https://gasang.example/v1", supersedes_id: oldVersion.id, revision_reason: "시험용 새 버전" });
    const all = [day365, day366, early365, late366, day364, draftOld, oldVersion, newVersion].map((s) => s.id);

    const r1 = await scan(TODAY);
    assert.equal(r1.runKey, TODAY);
    assert.equal(r1.expiryDays, 365);
    const q1 = await queueOf(all);
    assert.deepEqual(q1.map((r) => Number(r.target_id)).sort((x, y) => x - y), [day366.id, late366.id].map(Number).sort((x, y) => x - y), "366일째만");
    for (const r of q1) {
      assert.equal(r.reason, "expired");
      assert.equal(r.run_key, TODAY);
      assert.equal(r.opened_by, "job:source-expiry");
      assert.equal(Number(r.article_id), Number(pub.id));
    }
    assert.equal((await one("select basis_on::text d from public.source_review_queue where target_id = $1", [late366.id])).d, "2026-10-21", "잰 확인일 = 한국 날짜");

    // 같은 날 두 번 = 한 벌
    const r2 = await scan(TODAY);
    assert.equal(r2.opened, 0, "같은 날 두 번째 실행은 새 항목 0");
    assert.ok(r2.alreadyQueued >= 2);
    assert.equal((await queueOf(all)).length, 2);

    // 다음 날 → 365일째였던 두 행이 366일째 (1건씩 더)
    await scan("2027-10-23");
    assert.deepEqual((await queueOf(all)).map((r) => Number(r.target_id)).sort((x, y) => x - y), [day365.id, day366.id, early365.id, late366.id].map(Number).sort((x, y) => x - y));

    // 해결 뒤 같은 확인일로는 다시 열지 않는다 · 확인일을 새로 적으면(다시 확인) 그 날부터 다시 잰다
    await client.query("update public.source_review_queue set status = 'resolved', resolved_by = 'user:w4sr-test', resolved_at = now() where target_id = $1", [day366.id]);
    const openOf = async (id) => (await queueOf([id])).filter((r) => r.status === "open").length;
    await scan("2027-10-24");
    assert.equal(await openOf(day366.id), 0, "해결된 확인일로 다시 0");
    await client.query("update public.article_sources set last_verified_at = '2027-10-24T09:00:00+09:00' where id = $1", [day366.id]);
    // 2027-10-24 → 2028-10-23 = 365일 (2028년 2월 29일 포함) → 0, 하루 넘긴 2028-10-24에 1건
    await scan("2028-10-23");
    assert.equal(await openOf(day366.id), 0, "새 확인일 365일째 0");
    await scan("2028-10-24");
    assert.equal(await openOf(day366.id), 1, "새 확인일 366일째 1");
    assert.equal((await one("select basis_on::text d from public.source_review_queue where target_id = $1 and status = 'open'", [day366.id])).d, "2027-10-24");

    // 설정을 30일로 바꾸면 다음 실행부터
    await client.query("update public.settings set value = '30'::jsonb where key = 'official_source_expiry_days'");
    const r4 = await scan("2027-11-24");
    assert.equal(r4.expiryDays, 30);
    assert.equal((await queueOf([day364.id])).length, 1, "30일 기준이면 364일 전 확인 자료도 만료");
    assert.deepEqual(await queueOf([draftOld.id, oldVersion.id]), [], "초안·대체된 판 0 (확인일이 아무리 오래돼도)");
    assert.deepEqual((await queueOf([newVersion.id])).map((r) => r.run_key), ["2028-10-23"], "새 판은 자기 확인일(2027-10-01)로 잰다 — 2027-10-22엔 0");
  }));

test("해결 — 열린 항목만, 해결한 사람·시각 필수, 다른 칸 고치기·다시 열기 거부 / 대상 검사", () =>
  tx(async () => {
    const a = await article({ status: "published" });
    const s = await officialSource(a.id);
    const ins = (cols) => {
      const row = { target_type: "article_source", target_id: s.id, article_id: a.id, reason: "expired", basis_on: "2026-10-20", run_key: "2027-10-22", opened_by: "job:source-expiry", ...cols };
      const keys = Object.keys(row);
      return attempt(`insert into public.source_review_queue (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, keys.map((k) => row[k]));
    };
    const made = await ins({});
    assert.ok(made.ok, made.message);
    const id = made.rows[0].id;
    // 같은 대상·사유의 열린 항목은 하나
    const dup = await ins({ basis_on: "2026-10-21" });
    assert.equal(dup.code, "23505", "열린 항목 하나");

    assert.equal((await attempt("update public.source_review_queue set status = 'resolved' where id = $1", [id])).code, "23514", "해결한 사람·시각 없이 해결 거부");
    assert.match((await attempt("update public.source_review_queue set reason = 'snapshot_changed' where id = $1", [id])).message, /해결 표시/);
    assert.match((await attempt("update public.source_review_queue set run_key = '2027-10-23' where id = $1", [id])).message, /해결 표시/);
    assert.ok((await attempt("update public.source_review_queue set status = 'resolved', resolved_by = 'user:t', resolved_at = now(), resolution_note = '원문 확인' where id = $1", [id])).ok);
    assert.match((await attempt("update public.source_review_queue set status = 'open', resolved_by = null, resolved_at = null where id = $1", [id])).message, /해결된 검수 항목/, "다시 열기 거부");
    assert.match((await attempt("update public.source_review_queue set resolution_note = '고침' where id = $1", [id])).message, /해결된 검수 항목/);

    // 대상 검사 — 보도자료 출처 · 다른 기사 번호 · 없는 출처 · 아직 표가 없는 대상 종류
    const press = (await client.query("insert into public.article_sources (article_id, kind, title, license_type) values ($1, 'press_release', '시험용 보도자료', 'kogl_1') returning id", [a.id])).rows[0];
    assert.match((await ins({ target_id: press.id, basis_on: "2026-10-01" })).message, /공식 자료\(official_doc·dataset\) 출처만/);
    const b = await article();
    assert.match((await ins({ article_id: b.id, basis_on: "2026-10-02" })).message, /기사 번호/);
    assert.equal((await ins({ target_id: 999999999, basis_on: "2026-10-03" })).code, "23503");
    for (const t of ["project_event", "dev_method_fact"]) assert.match((await ins({ target_type: t, article_id: null, basis_on: "2026-10-04" })).message, /아직 받지 않습니다/, t);
    // 사유별 필수 칸
    assert.equal((await ins({ reason: "snapshot_changed", basis_on: null, run_key: null })).code, "23514", "원문 변경은 옛·새 해시·새 스냅샷 필수");
    assert.equal((await ins({ basis_on: null })).code, "23514", "만료는 확인일 필수");
    assert.equal((await ins({ run_key: "어제" , basis_on: "2026-10-05" })).code, "23514", "실행 키 = 한국 날짜 글자");
  }));

test("권한 — 큐는 anon·authenticated 권한 거부, 함수 실행 0 / 공개 뷰는 공개 기사의 열린 항목 출처 번호만", () =>
  tx(async () => {
    const pub = await article({ status: "published" });
    const draft = await article();
    const sPub = await officialSource(pub.id, { source_url: "https://gasang.example/view-pub" });
    const sPub2 = await officialSource(pub.id, { source_url: "https://gasang.example/view-pub2" });
    const sDraft = await officialSource(draft.id, { source_url: "https://gasang.example/view-draft" });
    const ins = (s, articleId, basis) =>
      client.query("insert into public.source_review_queue (target_type, target_id, article_id, reason, basis_on, run_key, opened_by) values ('article_source', $1, $2, 'expired', $3, '2027-10-22', 'job:source-expiry') returning id", [s, articleId, basis]);
    await ins(sPub.id, pub.id, "2026-10-01");
    const resolved = (await ins(sPub2.id, pub.id, "2026-10-01")).rows[0].id;
    await client.query("update public.source_review_queue set status = 'resolved', resolved_by = 'user:t', resolved_at = now() where id = $1", [resolved]);
    await ins(sDraft.id, draft.id, "2026-10-01");

    for (const role of ["anon", "authenticated"]) {
      const r = await attempt("select count(*) from public.source_review_queue", [], role);
      assert.equal(r.code, "42501", `${role} 큐 읽기`);
      for (const fn of ["source_snapshot_refetched('https://a.example', 'sha256:00', 'x', 'x', 'x')", "source_expiry_scan('2027-10-22')"]) {
        assert.equal((await attempt(`select public.${fn}`, [], role)).code, "42501", `${role} ${fn}`);
      }
      const v = await attempt("select * from public.public_source_reviews where article_id = any($1::bigint[]) order by source_id", [[pub.id, draft.id]], role);
      assert.ok(v.ok, v.message);
      assert.deepEqual(v.rows.map((x) => [Number(x.article_id), Number(x.source_id)]), [[Number(pub.id), Number(sPub.id)]], `${role}: 공개 기사의 열린 항목만`);
      assert.deepEqual(Object.keys(v.rows[0]).sort(), ["article_id", "source_id"], "출처 번호만 (사유·해시·사람 0)");
    }
    assert.ok((await attempt("select public.source_expiry_scan('2027-10-22')", [], "service_role")).ok, "service_role은 실행");
    const fnRows = (await client.query("select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'source_%' and has_function_privilege('anon', p.oid, 'EXECUTE')")).rows;
    assert.deepEqual(fnRows, [], "anon이 실행하는 source_* 함수 0");
  }));
