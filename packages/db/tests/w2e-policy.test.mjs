// W2-e 4단계 — policy_versions (docs/dev/W2-e_설계.md 2.1 · 3.4, HELP-02 · HELP-05)
//  · 승인 기록(검토자·검토일·메모) 없이는 게시 거부 · 버전 2부터 개정 사유 필수
//  · 문서마다 게시본·초안 하나뿐 · 게시본 본문 수정·삭제 거부 · 새 버전 게시 시 이전 판 superseded(덮어쓰지 않음)
//  · doc_key 값 = 설계 2.1 · 공개 뷰는 승인 기록 칸이 없고 초안은 안 보임 · RLS: anon·authenticated 표 0, service_role 전권
//  · 마이그레이션에 policy_versions 삽입 문장 0 (씨앗 0행 — 정책 문구는 코드·씨앗에 없다)
// 모든 시험은 트랜잭션 안에서 하고 되돌린다. 로컬 DB에서만 돈다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MD = fs.readFileSync(path.join(ROOT, "docs", "dev", "W2-e_설계.md"), "utf8");
const DOC_KEYS = [...MD.match(/policy\.doc_key[^\n]*/)[0].matchAll(/`([a-z-]+)`/g)].map((m) => m[1]).filter((k) => k !== "doc_key");
const BODY = JSON.stringify([{ heading: "시험 절", blocks: [{ type: "paragraph", text: "시험용 문단" }] }]);

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
    return { ok: true, rows: res.rows };
  } catch (err) {
    await client.query("rollback to savepoint t");
    return { ok: false, code: err.code, message: err.message };
  }
}
const draft = (doc, version = 1) => attempt("insert into public.policy_versions (doc_key, version, body) values ($1, $2, $3::jsonb) returning id", [doc, version, BODY]);
const publish = (doc, version, over = {}) =>
  attempt("select public.policy_publish($1, $2, $3, $4, $5, $6, $7, 'test')", [
    doc,
    version,
    "by" in over ? over.by : "시험 검토자",
    "on" in over ? over.on : "2026-10-20",
    "note" in over ? over.note : "시험 근거",
    over.summary ?? null,
    "2026-11-01",
  ]);
const rows = async (doc) => (await client.query("select version, status from public.policy_versions where doc_key = $1 order by version", [doc])).rows;

test("doc_key 값 목록 = 설계 2.1 (11종), 목록 밖 값 거부", async () => {
  assert.equal(DOC_KEYS.length, 11);
  assert.ok(DOC_KEYS.includes("youth-protection") && DOC_KEYS.includes("copyright-policy"));
  await tx(async () => {
    for (const k of DOC_KEYS) assert.equal((await draft(k)).ok, true, k);
    const bad = await draft("cookies");
    assert.equal(bad.ok, false);
    assert.equal(bad.code, "23514");
  });
});

test("승인 기록 없이 게시 거부 - 검토자 공백, 검토일 없음, 메모 빈 값 각각 23514, 초안 그대로", async () => {
  await tx(async () => {
    await draft("privacy");
    for (const over of [{ by: " " }, { on: null }, { note: "" }]) {
      const r = await publish("privacy", 1, over);
      assert.equal(r.ok, false, JSON.stringify(over));
      assert.equal(r.code, "23514");
    }
    assert.deepEqual(await rows("privacy"), [{ version: 1, status: "draft" }]);
    assert.equal((await publish("privacy", 1)).ok, true);
    assert.deepEqual(await rows("privacy"), [{ version: 1, status: "published" }]);
  });
});

test("초안이 없는 번호 게시는 P0002", async () => {
  await tx(async () => {
    const r = await publish("terms", 7);
    assert.equal(r.ok, false);
    assert.equal(r.code, "P0002");
  });
});

test("새 버전 게시 - 이전 게시본은 superseded, 개정 사유 없는 버전 2는 거부되고 이전 게시본은 그대로", async () => {
  await tx(async () => {
    await draft("terms");
    assert.equal((await publish("terms", 1)).ok, true);
    await draft("terms", 2);
    const noSummary = await publish("terms", 2);
    assert.equal(noSummary.ok, false);
    assert.equal(noSummary.code, "23514");
    assert.deepEqual(await rows("terms"), [
      { version: 1, status: "published" },
      { version: 2, status: "draft" },
    ]);
    assert.equal((await publish("terms", 2, { summary: "시험 개정 사유" })).ok, true);
    assert.deepEqual(await rows("terms"), [
      { version: 1, status: "superseded" },
      { version: 2, status: "published" },
    ]);
  });
});

test("문서마다 초안은 하나뿐, 같은 문서 같은 버전 중복 거부, 다른 문서는 영향 없음", async () => {
  await tx(async () => {
    assert.equal((await draft("ethics")).ok, true);
    assert.equal((await draft("ethics", 2)).code, "23505");
    assert.equal((await draft("ethics", 1)).code, "23505");
    assert.equal((await draft("about")).ok, true);
  });
});

test("게시본 본문·승인 기록 수정, 게시본 삭제, 번호 바꾸기, 이전 판 수정 거부 - 초안은 고치고 지울 수 있다", async () => {
  await tx(async () => {
    await draft("about");
    assert.equal((await attempt("update public.policy_versions set body = '[]'::jsonb where doc_key = 'about'")).ok, true, "초안 수정");
    await publish("about", 1);
    assert.equal((await attempt("update public.policy_versions set body = '[]'::jsonb where doc_key = 'about'")).code, "23514");
    assert.equal((await attempt("update public.policy_versions set approval_note = 'x' where doc_key = 'about'")).code, "23514");
    assert.equal((await attempt("delete from public.policy_versions where doc_key = 'about'")).code, "23514");
    assert.equal((await attempt("update public.policy_versions set version = 9 where doc_key = 'about'")).code, "23514");
    await draft("about", 2);
    await publish("about", 2, { summary: "개정" });
    assert.equal((await attempt("update public.policy_versions set change_summary = 'x' where doc_key = 'about' and version = 1")).code, "23514");
    await draft("ethics");
    assert.equal((await attempt("delete from public.policy_versions where doc_key = 'ethics'")).ok, true, "초안 삭제");
  });
});

test("공개 뷰 - 게시본·이전 판만, 승인 기록·고친 사람 칸 없음, 초안은 안 보임", async () => {
  await tx(async () => {
    await draft("privacy");
    await publish("privacy", 1);
    await draft("privacy", 2);
    const r = await attempt("select * from public.public_policy_versions where doc_key = 'privacy'", [], "anon");
    assert.equal(r.ok, true);
    assert.deepEqual(
      r.rows.map((x) => [x.version, x.status]),
      [[1, "published"]],
    );
    assert.deepEqual(Object.keys(r.rows[0]).sort(), ["body", "change_summary", "doc_key", "effective_on", "published_at", "status", "version"]);
    await publish("privacy", 2, { summary: "개정" });
    const r2 = await attempt("select version, status from public.public_policy_versions where doc_key = 'privacy' order by version", [], "anon");
    assert.deepEqual(
      r2.rows.map((x) => [x.version, x.status]),
      [
        [1, "superseded"],
        [2, "published"],
      ],
    );
  });
});

test("RLS·권한 - anon·authenticated는 표·게시 함수 0, service_role 전권, company_info만 공개 설정", async () => {
  await tx(async () => {
    await draft("about");
    for (const role of ["anon", "authenticated"]) {
      assert.equal((await attempt("select * from public.policy_versions", [], role)).ok, false, `${role} select`);
      assert.equal((await attempt("insert into public.policy_versions (doc_key, version) values ('terms', 1)", [], role)).ok, false, `${role} insert`);
      assert.equal((await attempt("select public.policy_publish('about', 1, 'a', '2026-10-20', 'b', null, null, 'x')", [], role)).ok, false, `${role} publish`);
    }
    assert.equal((await attempt("select count(*)::int n from public.policy_versions", [], "service_role")).ok, true);
    await client.query("insert into public.settings (key, value) values ('company_info', '{}'::jsonb) on conflict (key) do nothing");
    assert.equal((await attempt("select key from public.settings where key = 'company_info'", [], "anon")).rows.length, 1);
  });
});

test("씨앗 0행 - policy_versions는 비어 있고 마이그레이션에 삽입 문장이 없다", async () => {
  const dir = path.join(ROOT, "packages", "db", "supabase", "migrations");
  for (const f of fs.readdirSync(dir)) {
    const sql = fs.readFileSync(path.join(dir, f), "utf8").replace(/--[^\n]*/g, "");
    assert.doesNotMatch(sql, /insert\s+into\s+(public\.)?policy_versions/i, f);
  }
  assert.equal((await client.query("select count(*)::int n from public.policy_versions")).rows[0].n, 0);
});
