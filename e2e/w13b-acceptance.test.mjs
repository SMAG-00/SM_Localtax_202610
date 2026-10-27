// W13-b 수용 E2E - 워크스페이스 코어 (docs/dev/W13-b_설계.md, PRD-05 WS-01~05) - 작성만, 실행은 리드가 db-e2e.sh로 한다
//  a) 기능 키 꺼짐 -> /workspace·API 404
//  b) 모드 값 위조(쿠키·머리글·본문)해도 권한 판정이 같다 - 비구독자는 새 메모 403, 구독자는 200
//  c) 본인 자료만 - 다른 회원은 내보내기에 내 메모가 없다
//  d) 저장 검색 한도 n=1: 첫 저장 200, 둘째 409
//  e) 스크랩 - 서버가 원문 버전(body_hash)을 정한다 · 비공개(승인 전) 노드는 404 성격 거부
//  f) 내보내기 - 한도 비면 403 / 0이면 발췌 없음 / 5이면 정확히 5글자 / csv BOM / docx 인용 수 = 스크랩 수
//     발췌는 library_read가 전문을 준 경우에만: workspace만 있고 library 없음 -> 0 / 판매 권리 미확인 -> 0
//  g) 권한 만료 후 - 새 메모 403, 기존 자료 열람·내보내기 가능, 발췌는 한도가 커도 0
// 본문은 시험용 가짜 글이다. 정리 단계에서 설정을 되돌린다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const SITE = "https://e2e-w13b.example.test";
const KEYS = ["feature_flags", "export_excerpt_limit", "saved_search_limit"];
const BODY = "시험용본문가나다라마바사아자차카타파하";

let sb, server, staff, db, base, saved, run, sub, other, nodeId, draftId, pubId, editionId;

async function setSetting(key, value) {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("update public.settings set value = $1::jsonb where key = $2", [JSON.stringify(value), key]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}
const auth = (u, extra = {}) => ({ authorization: `Bearer ${u.token}`, "content-type": "application/json", ...extra });
const post = (u, body, extra) => fetch(`${base}/api/workspace/items`, { method: "POST", headers: auth(u, extra), body: JSON.stringify(body) });
const exp = (u, target, format) => fetch(`${base}/api/workspace/export?target=${target}&format=${format}`, { headers: { authorization: `Bearer ${u.token}` } });

async function startAll() {
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    NEXT_PUBLIC_SITE_URL: SITE,
    GUARD_SECRET: "e2e-w13b-guard-secret",
  });
  base = server.base;
}
async function restart() {
  await server?.stop?.();
  await startAll();
}

function zipEntries(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nl).toString("utf8");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    out.set(name, method === 0 ? raw : inflateRawSync(raw));
    p += 46 + nl + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

before(async () => {
  sb = localSupabase();
  buildWeb();
  await startAll();
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  run = staff.run.toLowerCase().replace(/[^a-z0-9]/g, "");
  saved = Object.fromEntries((await db.query("select key, value from public.settings where key = any($1::text[])", [KEYS])).rows.map((r) => [r.key, r.value]));
  sub = await staff.createUser({ label: "w13b-sub" });
  other = await staff.createUser({ label: "w13b-other" });
  await db.query("insert into public.entitlements (user_id, key, source, source_ref, valid_from, valid_until) values ($1, 'workspace', 'manual', $2, now() - interval '1 day', now() + interval '30 days')", [sub.id, `w13b-${run}`]);
  // 승인·권리 확인된 시험용 노드 1건과 초안 1건 (승인은 이관 작업 경로가 정석이라 트리거를 끈 세션으로 직접 넣는다 - 시험 전용)
  await db.query("begin");
  await db.query("set local session_replication_role = replica");
  pubId = (await db.query("insert into public.publications (slug, title, kind) values ($1, '시험용 출판물', 'book') returning id", [`w13b-${run}`])).rows[0].id;
  editionId = (await db.query("insert into public.editions (publication_id, edition_label, as_of) values ($1, '시험 1판', '2026-01-01') returning id", [pubId])).rows[0].id;
  nodeId = (await db.query("insert into public.pub_nodes (edition_id, depth, ordinal, title, status, approved_job_id, rights_public, rights_ref, rights_confirmed_on) values ($1, 1, 0, '시험용 승인 노드', 'approved', 1, 'confirmed', '시험용 계약', '2026-01-02') returning id", [editionId])).rows[0].id;
  draftId = (await db.query("insert into public.pub_nodes (edition_id, depth, ordinal, title) values ($1, 1, 1, '시험용 초안 노드') returning id", [editionId])).rows[0].id;
  await db.query("insert into public.library_bodies (kind, ref_id, body) values ('node', $1, $2)", [nodeId, BODY]);
  await db.query("commit");
});

after(async () => {
  try {
    for (const k of KEYS) if (saved?.[k] !== undefined) await setSetting(k, saved[k]);
    await db.query("begin");
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.library_bodies where ref_id = any($1::bigint[]) and kind = 'node'", [[nodeId, draftId].filter(Boolean)]);
    await db.query("delete from public.pub_nodes where edition_id = $1", [editionId]);
    await db.query("delete from public.editions where id = $1", [editionId]);
    await db.query("delete from public.publications where id = $1", [pubId]);
    await db.query("delete from public.entitlements where source_ref like $1", [`w13b-${run}%`]);
    await db.query("commit");
  } finally {
    await staff?.cleanup();
    await server?.stop();
  }
});

test("a 기능 키가 꺼져 있으면 대시보드·모드·쓰기·내보내기 모두 404", async () => {
  await setSetting("feature_flags", { ...saved.feature_flags, workspace: false });
  await restart();
  assert.equal((await fetch(`${base}/workspace`, { redirect: "manual" })).status, 404);
  assert.equal((await fetch(`${base}/api/workspace/mode`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "expert" }) })).status, 404);
  assert.equal((await post(sub, { action: "note_save", body: "x" })).status, 404);
  assert.equal((await exp(sub, "notes", "csv")).status, 404);
});

test("b 모드 값을 위조해도 권한 판정은 같다 - 비구독자 403, 구독자 200, 비로그인 대시보드는 로그인으로", async () => {
  await setSetting("feature_flags", { ...saved.feature_flags, workspace: true });
  await setSetting("saved_search_limit", { max: 1 });
  await setSetting("export_excerpt_limit", { chars: 5 });
  await restart();
  const anon = await fetch(`${base}/workspace`, { redirect: "manual", headers: { cookie: "ltr_ws_mode=expert" } });
  assert.ok([302, 303, 307, 308].includes(anon.status));
  assert.match(anon.headers.get("location") ?? "", /\/login/);
  for (const forged of [{ cookie: "ltr_ws_mode=expert" }, { "x-ltr-mode": "expert" }, {}]) {
    const r = await post(other, { action: "note_save", body: "시험용 위조 모드", mode: "expert", entitled: true }, forged);
    assert.equal(r.status, 403, JSON.stringify(forged));
    assert.equal((await r.json()).code, "no_entitlement");
  }
  assert.equal((await post(sub, { action: "note_save", body: "시험용 구독자 메모", mode: "general" }, { cookie: "ltr_ws_mode=general" })).status, 200);
  // 모드 API는 쿠키만 바꾸고 허용 밖 값은 거부
  const m = await fetch(`${base}/api/workspace/mode`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "expert" }) });
  assert.equal(m.status, 200);
  assert.match(m.headers.get("set-cookie") ?? "", /ltr_ws_mode=expert/);
  assert.equal((await fetch(`${base}/api/workspace/mode`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "admin" }) })).status, 400);
});

test("c 본인 자료만 - 다른 회원의 내보내기에 내 메모가 없다", async () => {
  const mine = await (await exp(sub, "notes", "csv")).text();
  assert.ok(mine.includes("시험용 구독자 메모"));
  const theirs = await (await exp(other, "notes", "csv")).text();
  assert.ok(!theirs.includes("시험용 구독자 메모"));
  assert.equal((await fetch(`${base}/api/workspace/export?target=notes&format=csv`)).status, 401);
});

test("d 저장 검색 한도 1 - 첫 저장 200, 둘째 409(한도 안내), 한도 비면 첫 저장도 거부", async () => {
  assert.equal((await post(sub, { action: "search_create", name: "시험 검색 1", q: "시험" })).status, 200);
  const second = await post(sub, { action: "search_create", name: "시험 검색 2", q: "시험" });
  assert.equal(second.status, 409);
  assert.equal((await second.json()).code, "limit");
  await setSetting("saved_search_limit", {});
  await db.query("delete from public.saved_searches where user_id = $1", [sub.id]);
  await restart();
  assert.equal((await post(sub, { action: "search_create", name: "시험 검색 3", q: "시험" })).status, 409);
});

test("e 스크랩 - 서버가 원문 버전을 정하고 승인 전 노드는 거부, 개정되면 버전이 달라진다", async () => {
  assert.equal((await post(sub, { action: "scrap_add", targetKind: "node", targetId: String(draftId), label: "위조 제목" })).status, 422);
  const ok = await post(sub, { action: "scrap_add", targetKind: "node", targetId: String(nodeId), label: "위조 제목" });
  assert.equal(ok.status, 200);
  const row = (await db.query("select label, source_version from public.scraps where user_id = $1", [sub.id])).rows[0];
  const hash = (await db.query("select body_hash from public.library_bodies where kind = 'node' and ref_id = $1", [nodeId])).rows[0].body_hash;
  assert.equal(row.label, "시험용 승인 노드");
  assert.equal(row.source_version, hash);
  assert.equal((await post(sub, { action: "scrap_add", targetKind: "node", targetId: String(nodeId), label: "x" })).status, 409); // 중복(이미 담음)
});

test("f 내보내기 - 한도 비면 403 / 0이면 발췌 0 / 5이면 정확히 5글자, csv BOM, docx 인용 수 = 스크랩 수", async () => {
  await setSetting("export_excerpt_limit", {});
  await restart();
  assert.equal((await exp(sub, "scraps", "csv")).status, 403);

  await setSetting("export_excerpt_limit", { chars: 0 });
  await restart();
  const zero = Buffer.from(await (await exp(sub, "scraps", "csv")).arrayBuffer());
  assert.deepEqual([...zero.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.ok(!zero.toString("utf8").includes(BODY.slice(0, 5)));

  // 발췌는 library_read의 전문 결과에서만 - 워크스페이스 권한만 있고 library 권한이 없으면 한도가 커도 0
  await setSetting("feature_flags", { ...saved.feature_flags, workspace: true, library: true });
  await setSetting("export_excerpt_limit", { chars: 1000 });
  await restart();
  const wsOnly = await (await exp(sub, "scraps", "csv")).text();
  assert.ok(!wsOnly.includes(BODY.slice(0, 5)), "workspace만 있고 library 권한 없음 -> 발췌 0");
  // library 권한이 있어도 판매 권리가 확인되지 않았으면(unchecked) 발췌 0
  await db.query("insert into public.entitlements (user_id, key, source, source_ref, valid_from, valid_until) values ($1, 'library', 'manual', $2, now() - interval '1 day', now() + interval '30 days')", [sub.id, `w13b-${run}-lib`]);
  const noSale = await (await exp(sub, "scraps", "csv")).text();
  assert.ok(!noSale.includes(BODY.slice(0, 5)), "rights_sale 미확인 -> 발췌 0");
  await db.query("begin");
  await db.query("set local session_replication_role = replica");
  await db.query("update public.pub_nodes set rights_sale = 'confirmed', rights_ref = '시험용 계약', rights_confirmed_on = '2026-01-02' where id = $1", [nodeId]);
  await db.query("commit");

  await setSetting("export_excerpt_limit", { chars: 5 });
  await restart();
  const five = (await (await exp(sub, "scraps", "csv")).text()).replace(/^﻿/, "");
  assert.ok(five.includes(BODY.slice(0, 5)));
  assert.ok(!five.includes(BODY.slice(0, 6)));
  const res = await exp(sub, "scraps", "docx");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("cache-control") ?? "", /no-store/);
  const xml = zipEntries(Buffer.from(await res.arrayBuffer())).get("word/document.xml").toString("utf8");
  const screen = (await db.query("select count(*)::int n from public.scraps where user_id = $1", [sub.id])).rows[0].n;
  assert.equal((xml.match(/w:pStyle w:val="Citation"/g) ?? []).length, screen);
  assert.ok(xml.includes(BODY.slice(0, 5)) && !xml.includes(BODY.slice(0, 6)));
  assert.equal((await db.query("select count(*)::int n from public.workspace_exports where user_id = $1", [sub.id])).rows[0].n, 6); // 앞선 메모 내보내기 1 + 이 시험의 성공 5(403은 기록 없음)
});

test("g 권한이 끝난 뒤 - 새 메모 403, 기존 자료 열람·내보내기 가능, 발췌는 한도가 커도 0", async () => {
  await setSetting("export_excerpt_limit", { chars: 1000 });
  await db.query("update public.entitlements set valid_until = now() - interval '1 second', valid_from = now() - interval '2 days' where user_id = $1", [sub.id]);
  await restart();
  assert.equal((await post(sub, { action: "note_save", body: "시험용 만료 뒤 메모" })).status, 403);
  const csv = await (await exp(sub, "scraps", "csv")).text();
  assert.ok(csv.includes("시험용 승인 노드"));
  assert.ok(!csv.includes(BODY.slice(0, 5)));
  const notes = await (await exp(sub, "notes", "csv")).text();
  assert.ok(notes.includes("시험용 구독자 메모"));
});
