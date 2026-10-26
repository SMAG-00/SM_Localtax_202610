// W12-a 수용 E2E - 검색 색인 (docs/dev/W12-a_설계.md - PRD-04 RAG-01~06 · ASK-14)
// standalone 빌드를 로컬 Supabase에 붙인다. 법령·조문은 전부 시험용 가짜 글이다. 임베딩 공급자는 설정하지 않는다(벡터 꺼짐 - 전문 검색만으로 동작).
//  a) 작업 index-refresh - 새 법령 조문 1건이 한 번 실행으로 청크가 되고(메타 모두 채워짐), 다시 돌려도 중복 0
//  b) 검색 - anon 키로 agent_search를 불러 그 청크를 찾는다 (표 직접 읽기는 막힘), 범위 플래그가 꺼진 범위·프리미엄·권리 미확인은 0
//  c) 철회 - 원천이 색인 대상에서 빠지면(스냅샷 origin을 live_fetch로) 다음 실행에서 검색 결과 0
//  d) 작업 인증 - 비밀 없이 호출하면 거부
//  e) 경계 - 색인·검색 코드가 상속·증여 엔진을 불러오지 않고(NT9) AI SDK를 쓰지 않으며, 학습용 내보내기가 없다
// 만든 행은 끝나면 지운다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const SITE = "https://e2e-w12a.example.test";
const CRON = "e2e-w12a-cron";
const GUARD = "e2e-w12a-guard-secret";
const ROOT = path.resolve(import.meta.dirname, "..");

let sb, server, staff, db, base, run, savedFlags;
const made = { snapshots: [], versions: [], articles: [], chunkSources: [] };
const WORD = () => `색인시험${run}`;

const rpc = async (fn, args) => {
  const res = await fetch(`${sb.url}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: sb.anonKey, authorization: `Bearer ${sb.anonKey}`, "content-type": "application/json" }, body: JSON.stringify(args) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const search = (q) => rpc("agent_search", { p_query: q });
const job = (secret = CRON) => fetch(`${base}/api/jobs/index-refresh`, { headers: secret ? { authorization: `Bearer ${secret}` } : {} });

async function purge() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    const ids = made.articles.map(String);
    if (ids.length) {
      await db.query("delete from public.chunk_embeddings where chunk_id in (select id from public.chunks where source_id = any($1::text[]))", [ids]).catch(() => {});
      await db.query("delete from public.chunks where source_id = any($1::text[]) or source_id like $2", [ids, `e2e-w12a-${run}%`]);
      await db.query("delete from public.index_queue where source_id = any($1::text[])", [ids]);
    }
    await db.query("delete from public.law_articles where id = any($1::bigint[])", [made.articles]);
    await db.query("delete from public.law_versions where id = any($1::bigint[])", [made.versions]);
    await db.query("delete from public.raw_snapshots where id = any($1::bigint[])", [made.snapshots]);
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
    NEXT_PUBLIC_SITE_URL: SITE,
    CRON_SECRET: CRON,
    GUARD_SECRET: GUARD,
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  run = staff.run.toLowerCase().replace(/[^a-z0-9]/g, "");
  savedFlags = (await db.query("select value from public.settings where key = 'ask_scope_flags'")).rows[0]?.value;
  await db.query("update public.settings set value = '{\"trust_redevelopment\": false, \"inheritance\": false, \"gift\": false}'::jsonb where key = 'ask_scope_flags'");
  await purge();
});

after(async () => {
  try {
    await purge();
    if (savedFlags) await db.query("update public.settings set value = $1::jsonb where key = 'ask_scope_flags'", [JSON.stringify(savedFlags)]);
  } finally {
    await staff?.cleanup();
    await server?.stop();
  }
});

let articleId;
test("d) 작업 인증 - 비밀이 없거나 틀리면 거부", async () => {
  assert.notEqual((await job("")).status, 200);
  assert.notEqual((await job("wrong")).status, 200);
});

test("a) 새 법령 조문 1건이 한 번 실행으로 색인되고, 메타가 모두 채워지며, 다시 돌려도 중복 0", async () => {
  const law = (await db.query("select id from public.laws where name = '지방세법'")).rows[0].id;
  const snap = (await db.query("insert into public.raw_snapshots (source, url, content_hash, payload) values ('w12a-e2e', $1, $2, '시험용 원문') returning id", [`https://example.test/w12a/${run}`, `h-${run}`])).rows[0].id;
  made.snapshots.push(snap);
  const v = (await db.query("insert into public.law_versions (law_id, promulgation_no, promulgated_on, effective_on, body_hash, snapshot_id) values ($1, $2, '2000-01-01', '2000-02-01', $3, $4) returning id", [law, `시험용-${run}`, `bh-${run}`, snap])).rows[0].id;
  made.versions.push(v);
  articleId = (await db.query("insert into public.law_articles (version_id, article_no, branch_no, title, body) values ($1, 7, 0, '시험용 제목', $2) returning id", [v, `${WORD()} 시험용 조문 본문입니다`])).rows[0].id;
  made.articles.push(articleId);

  assert.equal((await job()).status, 200);
  const rows = (await db.query("select * from public.chunks where source_id = $1", [String(articleId)])).rows;
  assert.equal(rows.length, 1);
  const c = rows[0];
  for (const k of ["doc_type", "tax_items", "valid_from", "access_tier", "rights_status", "scope", "source_hash", "content_hash", "index_version", "snapshot_id"]) assert.ok(c[k] !== null && c[k] !== "" && !(Array.isArray(c[k]) && c[k].length === 0), k);
  assert.equal(c.source_type, "law_article");
  assert.equal(c.scope, "base");
  assert.equal(c.access_tier, "public");
  assert.match(c.path, /^지방세법 > 제7조\(시험용 제목\)$/);
  const q = (await db.query("select done_at, attempts from public.index_queue where source_id = $1", [String(articleId)])).rows;
  assert.equal(q.length, 1);
  assert.ok(q[0].done_at);

  assert.equal((await job()).status, 200);
  assert.equal((await db.query("select count(*)::int n from public.chunks where source_id = $1", [String(articleId)])).rows[0].n, 1, "재실행 중복 0");
  assert.equal((await db.query("select count(*)::int n from public.index_queue where source_id = $1", [String(articleId)])).rows[0].n, 1);
});

test("b) anon 키로 agent_search가 그 청크를 찾고, 표 직접 읽기·쓰기는 막히며, 꺼진 범위·프리미엄·권리 미확인은 0", async () => {
  const r = await search(WORD());
  assert.equal(r.status, 200);
  assert.equal(r.body.length, 1);
  assert.equal(r.body[0].source_id, String(articleId));
  assert.equal(r.body[0].fts_rank, 1);
  assert.equal(r.body[0].vec_rank, null, "벡터 꺼짐");

  const direct = await fetch(`${sb.url}/rest/v1/chunks?select=id`, { headers: { apikey: sb.anonKey, authorization: `Bearer ${sb.anonKey}` } });
  assert.ok([401, 403, 404].includes(direct.status) || (direct.status === 200 && (await direct.json()).length === 0));
  const write = await fetch(`${sb.url}/rest/v1/chunks`, { method: "POST", headers: { apikey: sb.anonKey, authorization: `Bearer ${sb.anonKey}`, "content-type": "application/json" }, body: JSON.stringify({ source_type: "guide_version" }) });
  assert.ok(write.status >= 400);
  assert.equal((await rpc("chunk_index_put", { p_source_type: "guide_version", p_source_id: "x", p_index_version: "v", p_meta: {}, p_chunks: [] })).status >= 400, true);

  // 같은 낱말이 든 다른 범위·프리미엄·권리 미확인 청크를 직접 넣어도 anon 검색에는 0
  const base = { doc_type: "guide", source_type: "guide_version", path: "시험용", content: `${WORD()} 다른 청크`, token_est: 3, tax_items: ["local"], valid_from: "2000-01-01", source_hash: "h", index_version: "chunk-v1" };
  const mk = async (i, over) => {
    const row = { ...base, source_id: `e2e-w12a-${run}-${i}`, chunk_no: 0, content_hash: (await db.query("select encode(sha256($1::bytea), 'hex') h", [`${run}-${i}`])).rows[0].h, access_tier: "public", rights_status: "confirmed", scope: "base", ...over };
    const keys = Object.keys(row);
    await db.query(`insert into public.chunks (${keys.join(", ")}) values (${keys.map((_, k) => `$${k + 1}`).join(", ")})`, keys.map((k) => row[k]));
  };
  await mk(1, { scope: "gift" });
  await mk(2, { scope: "inheritance" });
  await mk(3, { scope: "trust_redevelopment" });
  await mk(4, { access_tier: "premium", source_type: "publication", doc_type: "publication" });
  await mk(5, { rights_status: "unchecked" });
  const afterSearch = await search(WORD());
  assert.deepEqual(afterSearch.body.map((x) => x.source_id), [String(articleId)]);
  const hint = await rpc("agent_premium_hint", { p_query: WORD() });
  assert.equal(hint.body, 1, "비구독자에게는 프리미엄 건수만");
  assert.ok(!JSON.stringify(hint.body).includes("다른 청크"));
});

test("c) 원천이 색인 대상에서 빠지면 다음 실행에서 청크가 빠지고 검색 결과 0", async () => {
  const snap = made.snapshots[0];
  await db.query("update public.raw_snapshots set origin = 'live_fetch' where id = $1", [snap]);
  assert.equal((await job()).status, 200);
  assert.equal((await db.query("select count(*)::int n from public.chunks where source_id = $1 and retired_at is null", [String(articleId)])).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from public.chunks where source_id = $1", [String(articleId)])).rows[0].n, 1, "행은 보존");
  assert.equal((await search(WORD())).body.length, 0);
});

test("e) 경계 - NT9(상속·증여 엔진 import 0) · AI SDK import 0 · 학습용 내보내기 0", () => {
  const dirs = ["apps/web/lib/agent", "apps/web/lib/server/agent"];
  const files = dirs.flatMap((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith(".ts")).map((f) => path.join(d, f)));
  assert.ok(files.length >= 8);
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.doesNotMatch(text, new RegExp(["@ltr", "ig" + "t-engine"].join("/")), f);
    assert.doesNotMatch(text, /from\s+["'](?:ai|openai|@ai-sdk\/[^"']*|@anthropic-ai\/[^"']*)["']/, f);
    assert.doesNotMatch(text, /fine[-_ ]?tun|jsonl|writeFile|createWriteStream/i, f);
  }
});
