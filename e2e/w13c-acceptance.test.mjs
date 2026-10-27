// W13-c 수용 E2E - 분할 화면·쟁점 타임라인·패널 v2·계정과목 연결 (docs/dev/W13-c_설계.md, PRD-05 LAW-07~10 · LINK-02) - 작성만, 실행은 리드가 db-e2e.sh로 한다
//  a) 기능 키(law_split · law_timeline · account_links)가 꺼져 있으면 각 화면 404
//  b) 분할 화면 - 틀린 패널 조각은 버리고 입력을 화면에 되돌리지 않는다 / 비구독자(비로그인)는 프리미엄 노드 본문 0 (잠금 안내만) /
//     남의 메모 번호·비로그인 메모 패널은 내용 없이 "권한 없음"
//  c) 타임라인 - 없는 쟁점 키·형식이 틀린 키는 404
//  d) 계정과목 연결 - 서명 전 공개 0, 서명 뒤 공개, 회계기준은 std_ref(이름+조항 번호)만
//  e) 소스 정적 검사 - 패널·타임라인 코드에 본문 칸(body/text) 조회 0, 새 API 0 (스크랩은 기존 /api/workspace/items)
// 본문은 시험용 가짜 글이다. 정리 단계에서 설정을 되돌린다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const SITE = "https://e2e-w13c.example.test";
const KEYS = ["feature_flags", "library_preview"];
const BODY = "시험용프리미엄본문가나다라마바사";
const ACCOUNT_NAME = "시험용계정과목E2E";

let sb, server, staff, db, base, saved, run, nodeId, pubId, editionId, mappingId;

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
async function startAll() {
  server = await startServer({ NEXT_PUBLIC_SUPABASE_URL: sb.url, NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey, SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey, NEXT_PUBLIC_SITE_URL: SITE, GUARD_SECRET: "e2e-w13c-guard-secret" });
  base = server.base;
}
async function restart() {
  await server?.stop?.();
  await startAll();
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
  await db.query("begin");
  await db.query("set local session_replication_role = replica");
  pubId = (await db.query("insert into public.publications (slug, title, kind) values ($1, '시험용 출판물', 'book') returning id", [`w13c-${run}`])).rows[0].id;
  editionId = (await db.query("insert into public.editions (publication_id, edition_label, as_of) values ($1, '시험 1판', '2026-01-01') returning id", [pubId])).rows[0].id;
  nodeId = (await db.query("insert into public.pub_nodes (edition_id, depth, ordinal, title, status, approved_job_id, rights_public, rights_ref, rights_confirmed_on, access_tier) values ($1, 1, 0, '시험용 프리미엄 노드', 'approved', 1, 'confirmed', 'w13c-test', current_date, 'premium') returning id", [editionId])).rows[0].id;
  await db.query("insert into public.library_bodies (kind, ref_id, body) values ('node', $1, $2)", [nodeId, BODY]);
  mappingId = (await db.query("insert into public.account_mappings (account_code, account_name, target_type, target_id, relation, std_ref) values ('e2e_account', $1, 'pub_node', $2, 'related', '시험기준 제1호') returning id", [ACCOUNT_NAME, nodeId])).rows[0].id;
  await db.query("commit");
});

after(async () => {
  try {
    for (const k of KEYS) if (saved?.[k] !== undefined) await setSetting(k, saved[k]);
    await db.query("begin");
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.account_mappings where id = $1", [mappingId]);
    await db.query("delete from public.library_bodies where ref_id = $1 and kind = 'node'", [nodeId]);
    await db.query("delete from public.pub_nodes where edition_id = $1", [editionId]);
    await db.query("delete from public.editions where id = $1", [editionId]);
    await db.query("delete from public.publications where id = $1", [pubId]);
    await db.query("commit");
  } finally {
    await staff?.cleanup();
    await server?.stop();
  }
});

test("a 기능 키가 꺼져 있으면 분할 화면·타임라인·계정과목 연결이 모두 404", async () => {
  await setSetting("feature_flags", { ...saved.feature_flags, law_split: false, law_timeline: false, account_links: false });
  await restart();
  assert.equal((await fetch(`${base}/workspace/split?p=case:1`)).status, 404);
  assert.equal((await fetch(`${base}/law/timeline/some_issue`)).status, 404);
  assert.equal((await fetch(`${base}/workspace/accounts`)).status, 404);
});

test("b 분할 화면 - 틀린 조각은 버리고 입력을 되돌리지 않으며, 비구독자에게 프리미엄 본문·남의 메모는 없다", async () => {
  await setSetting("feature_flags", { ...saved.feature_flags, law_split: true, library: true });
  await setSetting("library_preview", {});
  await restart();
  const evil = await fetch(`${base}/workspace/split?p=${encodeURIComponent("evil:1,law:1:<script>alert(1)</script>,case:abc")}`);
  assert.equal(evil.status, 200);
  const evilHtml = await evil.text();
  assert.ok(!evilHtml.includes("<script>alert(1)</script>"));
  assert.match(evilHtml, /열린 패널이 없습니다/);
  const node = await fetch(`${base}/workspace/split?p=node:${nodeId}`);
  const nodeHtml = await node.text();
  assert.equal(node.status, 200);
  assert.ok(!nodeHtml.includes(BODY), "비구독자 응답에 프리미엄 본문이 없어야 한다");
  const note = await fetch(`${base}/workspace/split?p=note:1`);
  const noteHtml = await note.text();
  assert.match(noteHtml, /볼 권한이 없습니다/);
});

test("c 타임라인 - 없는 쟁점 키와 형식이 틀린 키는 404", async () => {
  await setSetting("feature_flags", { ...saved.feature_flags, law_timeline: true });
  await restart();
  assert.equal((await fetch(`${base}/law/timeline/no_such_issue_e2e`)).status, 404);
  assert.equal((await fetch(`${base}/law/timeline/${encodeURIComponent("Bad Key!")}`)).status, 404);
});

test("d 계정과목 연결 - 서명 전 공개 0, 서명 뒤 공개, 회계기준은 이름+조항 번호만", async () => {
  await setSetting("feature_flags", { ...saved.feature_flags, library: true, account_links: true });
  await restart();
  const before = await (await fetch(`${base}/workspace/accounts?account=e2e_account`)).text();
  assert.ok(!before.includes(ACCOUNT_NAME));
  assert.ok(!before.includes("시험기준 제1호"));
  await db.query("select public.account_mapping_sign($1, 'e2e 감수자')", [mappingId]);
  await restart(); // 공개 읽기는 30초 캐시
  const after = await (await fetch(`${base}/workspace/accounts?account=e2e_account`)).text();
  assert.ok(after.includes(ACCOUNT_NAME));
  assert.ok(after.includes("시험기준 제1호"));
});

test("e 소스 정적 검사 - 패널·타임라인은 본문 칸을 읽지 않고 새 API 라우트가 없다", () => {
  const v2 = readFileSync(new URL("../apps/web/lib/server/public/law-v2.ts", import.meta.url), "utf8");
  const relatedSection = v2.slice(v2.indexOf("export async function getRelatedV2"), v2.indexOf("// ── 쟁점 타임라인"));
  assert.ok(!/select\([^)]*\bbody\b/.test(relatedSection), "패널 조회에 body 칸 없음");
  const timelineSection = v2.slice(v2.indexOf("export async function getTimeline"), v2.indexOf("// ── 분할 화면 패널"));
  assert.ok(!/select\([^)]*\bbody\b/.test(timelineSection), "타임라인 조회에 body 칸 없음");
  const scrap = readFileSync(new URL("../apps/web/components/site/ScrapButton.tsx", import.meta.url), "utf8");
  assert.ok(scrap.includes("/api/workspace/items"));
});
