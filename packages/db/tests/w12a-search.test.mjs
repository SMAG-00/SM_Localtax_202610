// W12-a DB - 하이브리드 검색 함수 agent_search · agent_premium_hint (마이그레이션 152, docs/dev/W12-a_설계.md - PRD-04 RAG-04 · RAG-06 · ASK-14)
//  · 필터는 함수 안 SQL - 기준일(효력 구간) · 권리 미확인/제한 0 · 뺀 청크 0 · 세목/원천 종류 필터
//  · 범위 플래그 꺼짐 -> 그 범위 결과 0 (anon · 일반 회원 키) · 상속만 켜면 증여는 계속 0 · 켜면 보임
//  · 접근 등급 - 비회원/비구독 회원은 premium 0, 구독(digital 권한) 회원은 보임, 클라이언트가 보낸 값은 쓰지 않음 (함수에 등급 인자 없음)
//  · 프리미엄 안내 건수 - 비구독자만 n건, 구독자 0, 본문 칸 없음
//  · 벡터 분기 - 임베딩이 없으면 전문 검색만 · (pgvector가 있으면) RRF로 합친 순위 · 차원 불일치는 전문 검색 결과로 폴백
//  · 시험용 대량 청크 p95 <= 800ms · 학습용 내보내기 코드 0 (코드 검토)
// 모든 시험은 거래 안에서 돌고 되돌린다. 글은 시험용 가짜다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { open, helpers } from "./_w10c_helpers.mjs";

let client;
let h;
before(async () => {
  client = await open();
  h = helpers(client);
});
after(async () => client?.end());

const HASH = (n) => createHash("sha256").update(String(n)).digest("hex");
let seq = 0;
async function chunk(content, over = {}) {
  const row = {
    source_type: "guide_version", source_id: h.uniq("s"), chunk_no: 0, doc_type: "guide", path: "시험용 > 경로", content, token_est: 5, tax_items: ["local"],
    valid_from: "2000-01-01", access_tier: "public", rights_status: "confirmed", scope: "base", source_hash: "h", content_hash: HASH(++seq + content),
    index_version: "chunk-v1", ...over,
  };
  const keys = Object.keys(row);
  return Number((await h.one(`insert into public.chunks (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, keys.map((k) => row[k]))).id);
}
async function search(q, args = {}, { role, uid } = {}) {
  await client.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [uid ?? "", uid ? JSON.stringify({ sub: uid }) : ""]);
  const params = [q, args.asOf ?? null, args.tax ?? null, args.types ?? null, args.scopes ?? null, args.emb ?? null, args.model ?? null, args.limit ?? 40];
  const r = await h.attempt("select * from public.agent_search($1, $2::date, $3::text[], $4::text[], $5::text[], $6::double precision[], $7, $8)", params, role ?? null);
  assert.equal(r.ok, true, r.message);
  return r.rows;
}
const ids = (rows) => rows.map((r) => Number(r.chunk_id)).sort((a, b) => a - b);
const setFlags = async (flags) => { await client.query("select set_config('ltr.eval_gate', 'rpc', true)"); await client.query("update public.settings set value = $1::jsonb where key = 'ask_scope_flags'", [JSON.stringify(flags)]); await client.query("select set_config('ltr.eval_gate', '', true)"); };
const authUser = async () => (await client.query("insert into auth.users (id) values (gen_random_uuid()) returning id")).rows[0].id;

test("낱말이 들어 있는 청크만 찾고, 낱말이 많이 맞는 청크가 앞선다 (전문 검색만으로 동작)", () =>
  h.tx(async () => {
    const a = await chunk("알파시험 베타시험 설명");
    const b = await chunk("알파시험만 있는 설명");
    await chunk("관계 없는 가짜 문장");
    const rows = await search("알파시험 베타시험");
    assert.deepEqual(rows.map((r) => Number(r.chunk_id)), [b, a].reverse());
    assert.equal(rows[0].vec_rank, null);
    assert.equal(rows[0].fts_rank, 1);
    assert.ok(rows[0].rrf_score > rows[1].rrf_score);
    assert.equal((await search("   ")).length, 0, "빈 질의");
    assert.equal((await search("전혀없는낱말")).length, 0);
  }));

test("조사가 붙은 낱말도 찾는다 (끝 한 글자를 뗀 낱말 보강)", () =>
  h.tx(async () => {
    const a = await chunk("감마시험세 신고 안내");
    assert.deepEqual(ids(await search("감마시험세는")), [a]);
  }));

test("기준일 필터 - 효력 구간 밖 청크는 0, 구간 안은 보임 (끝 날짜는 배타적)", () =>
  h.tx(async () => {
    const old = await chunk("델타시험 옛 개정판", { valid_from: "2000-01-01", valid_to: "2010-01-01" });
    const now = await chunk("델타시험 현행 개정판", { valid_from: "2010-01-01" });
    const future = await chunk("델타시험 미래 개정판", { valid_from: "2999-01-01" });
    assert.deepEqual(ids(await search("델타시험", { asOf: "2005-06-01" })), [old]);
    assert.deepEqual(ids(await search("델타시험", { asOf: "2009-12-31" })), [old]);
    assert.deepEqual(ids(await search("델타시험", { asOf: "2010-01-01" })), [now]);
    assert.deepEqual(ids(await search("델타시험")), [now], "기준일 없으면 오늘");
    assert.deepEqual(ids(await search("델타시험", { asOf: "2999-06-01" })), [now, future].sort((x, y) => x - y));
    assert.deepEqual(ids(await search("델타시험", { asOf: "1999-01-01" })), []);
  }));

test("권리 미확인·제한 청크와 뺀 청크는 결과 0 (권리 미확인 0 - RAG-06)", () =>
  h.tx(async () => {
    const ok = await chunk("엡실론시험 확인됨");
    await chunk("엡실론시험 미확인", { rights_status: "unchecked" });
    await chunk("엡실론시험 제한", { rights_status: "restricted" });
    const gone = await chunk("엡실론시험 뺌");
    await client.query("update public.chunks set retired_at = now() where id = $1", [gone]);
    assert.deepEqual(ids(await search("엡실론시험")), [ok]);
  }));

test("세목·원천 종류·범위 인자 필터", () =>
  h.tx(async () => {
    const a = await chunk("제타시험 글", { tax_items: ["acq"], source_type: "guide_version" });
    const b = await chunk("제타시험 글", { tax_items: ["prop"], source_type: "issue_graph_version", doc_type: "issue_graph" });
    assert.deepEqual(ids(await search("제타시험", { tax: ["acq"] })), [a]);
    assert.deepEqual(ids(await search("제타시험", { types: ["issue_graph_version"] })), [b]);
    assert.deepEqual(ids(await search("제타시험", { tax: ["none"] })), []);
    assert.deepEqual(ids(await search("제타시험", { scopes: ["gift"] })), [], "요청한 범위가 base가 아니면 0");
  }));

test("범위 플래그 꺼짐 -> 신탁·정비/상속/증여 청크 0 (anon · 일반 회원 키), 켠 범위만 보이고 상속만 켜면 증여는 계속 0 (RAG-04)", () =>
  h.tx(async () => {
    const base = await chunk("에타시험 기본");
    const trust = await chunk("에타시험 신탁", { scope: "trust_redevelopment" });
    const inh = await chunk("에타시험 상속", { scope: "inheritance" });
    const gift = await chunk("에타시험 증여", { scope: "gift" });
    const member = await authUser();
    await setFlags({ trust_redevelopment: false, inheritance: false, gift: false });
    for (const who of [{ role: "anon" }, { role: "authenticated", uid: member }]) assert.deepEqual(ids(await search("에타시험", {}, who)), [base], who.role);
    await setFlags({ trust_redevelopment: false, inheritance: true, gift: false });
    for (const who of [{ role: "anon" }, { role: "authenticated", uid: member }]) assert.deepEqual(ids(await search("에타시험", {}, who)), [base, inh].sort((x, y) => x - y), `${who.role} 상속만`);
    await setFlags({ trust_redevelopment: true, inheritance: true, gift: true });
    assert.deepEqual(ids(await search("에타시험", {}, { role: "anon" })), [base, trust, inh, gift].sort((x, y) => x - y));
  }));

test("프리미엄 - 비회원·비구독 회원은 0, digital 권한 회원은 보임, 만료·철회된 권한은 0 (ASK-14)", () =>
  h.tx(async () => {
    const pub = await chunk("세타시험 공개");
    const prem = await chunk("세타시험 프리미엄", { source_type: "publication", doc_type: "publication", access_tier: "premium" });
    const plain = await authUser();
    const sub = await authUser();
    const expired = await authUser();
    await client.query("insert into public.entitlements (user_id, key, source, source_ref, valid_from, valid_until) values ($1, 'digital', 'manual', 'w12a-1', now() - interval '1 day', now() + interval '1 day')", [sub]);
    await client.query("insert into public.entitlements (user_id, key, source, source_ref, valid_from, valid_until) values ($1, 'digital', 'manual', 'w12a-2', now() - interval '3 day', now() - interval '1 day')", [expired]);
    assert.deepEqual(ids(await search("세타시험", {}, { role: "anon" })), [pub]);
    assert.deepEqual(ids(await search("세타시험", {}, { role: "authenticated", uid: plain })), [pub]);
    assert.deepEqual(ids(await search("세타시험", {}, { role: "authenticated", uid: expired })), [pub]);
    assert.deepEqual(ids(await search("세타시험", {}, { role: "authenticated", uid: sub })), [pub, prem].sort((x, y) => x - y));
    // 등급을 정하는 인자가 함수에 없다
    const args = (await h.one("select pg_get_function_arguments('public.agent_search(text, date, text[], text[], text[], double precision[], text, int)'::regprocedure) as a")).a;
    assert.doesNotMatch(args, /tier|premium|entitle|user|uid/i);
  }));

test("프리미엄 안내 건수 - 비구독자에게는 건수만(본문 칸 없음), 구독자는 0, 같은 출판물의 여러 조각은 1건", () =>
  h.tx(async () => {
    const src = h.uniq("book");
    await chunk("이오타시험 첫째", { source_type: "publication", doc_type: "publication", access_tier: "premium", source_id: src, chunk_no: 0 });
    await chunk("이오타시험 둘째", { source_type: "publication", doc_type: "publication", access_tier: "premium", source_id: src, chunk_no: 1 });
    await chunk("이오타시험 다른 책", { source_type: "publication", doc_type: "publication", access_tier: "premium" });
    await chunk("이오타시험 미확인 책", { source_type: "guide_version", access_tier: "premium", rights_status: "unchecked" });
    const plain = await authUser();
    const sub = await authUser();
    await client.query("insert into public.entitlements (user_id, key, source, source_ref, valid_from, valid_until) values ($1, 'digital', 'manual', 'w12a-3', now() - interval '1 day', now() + interval '1 day')", [sub]);
    await client.query("select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true)");
    const anonHint = await h.attempt("select public.agent_premium_hint('이오타시험') as n", [], "anon");
    assert.equal(anonHint.rows[0].n, 2);
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [plain]);
    assert.equal((await h.one("select public.agent_premium_hint('이오타시험') as n")).n, 2);
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [sub]);
    assert.equal((await h.one("select public.agent_premium_hint('이오타시험') as n")).n, 0);
    const cols = (await client.query("select pg_get_function_result('public.agent_premium_hint(text, date, text[], text[])'::regprocedure) as r")).rows[0].r;
    assert.equal(cols, "integer");
  }));

test("anon·authenticated가 agent_search를 실행할 수 있고, 내부 도우미 함수는 실행할 수 없다", () =>
  h.tx(async () => {
    for (const fn of ["agent_search(text, date, text[], text[], text[], double precision[], text, int)", "agent_premium_hint(text, date, text[], text[])"]) {
      const r = await h.one(`select has_function_privilege('anon', 'public.${fn}', 'EXECUTE') a, has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') b`);
      assert.deepEqual(r, { a: true, b: true }, fn);
    }
    for (const fn of ["chunk_allowed(public.chunks, date, boolean, jsonb, text[], text[], text[])", "chunk_query_terms(text)", "chunk_embedding_put(bigint, text, double precision[])", "chunks_without_embedding(text, int)"]) {
      const r = await h.one(`select has_function_privilege('anon', 'public.${fn}', 'EXECUTE') a, has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') b, has_function_privilege('service_role', 'public.${fn}', 'EXECUTE') s`);
      assert.deepEqual(r, { a: false, b: false, s: true }, fn);
    }
  }));

test("limit은 1~100으로 조여진다", () =>
  h.tx(async () => {
    for (let i = 0; i < 5; i++) await chunk(`카파시험 ${i}`);
    assert.equal((await search("카파시험", { limit: 2 })).length, 2);
    assert.equal((await search("카파시험", { limit: 0 })).length, 1);
    assert.equal((await search("카파시험", { limit: -5 })).length, 1);
    assert.equal((await search("카파시험", { limit: 100000 })).length, 5);
  }));

// ── 벡터 분기 ────────────────────────────────────────────────
async function hasVector() {
  return (await h.one("select to_regclass('public.chunk_embeddings') is not null as ok")).ok;
}
const vec = (i) => Array.from({ length: 1024 }, (_, k) => (k === i ? 1 : 0));

test("벡터 분기 - 임베딩 인자가 없으면 전문 검색만, 있으면 RRF로 합친다 (pgvector가 없으면 건너뜀)", async (t) => {
  await h.tx(async () => {
    if (!(await hasVector())) return t.skip("pgvector 없음 - 벡터 검색은 꺼진 채 전문 검색만 동작");
    const a = await chunk("람다시험 글 하나");
    const b = await chunk("람다시험 글 둘");
    const c = await chunk("전혀 다른 글 셋");
    for (const [id, i] of [[a, 0], [b, 1], [c, 2]]) {
      const r = await h.one("select public.chunk_embedding_put($1, 'm1', $2::double precision[]) as r", [id, vec(i)]);
      assert.equal(r.r.ok, true);
    }
    const fts = await search("람다시험");
    assert.ok(fts.every((r) => r.vec_rank === null));
    const both = await search("람다시험", { emb: vec(2), model: "m1" });
    const byId = new Map(both.map((r) => [Number(r.chunk_id), r]));
    assert.ok(byId.get(c).vec_rank !== null && byId.get(c).fts_rank === null, "벡터로만 찾은 청크");
    assert.ok(byId.get(a).fts_rank !== null && byId.get(a).vec_rank !== null);
    // 차원이 틀린 임베딩은 오류 없이 전문 검색 결과로 폴백
    const bad = await search("람다시험", { emb: [1, 2, 3], model: "m1" });
    assert.deepEqual(ids(bad), ids(fts));
    // 필터는 벡터 분기에도 같이 걸린다
    await client.query("update public.chunks set retired_at = now() where id = $1", [c]);
    assert.ok(!ids(await search("람다시험", { emb: vec(2), model: "m1" })).includes(c));
    assert.equal((await h.one("select public.chunk_embedding_put($1, 'm1', $2::double precision[]) as r", [a, [1, 2]])).r.code, "bad_dimension");
    assert.equal((await client.query("select * from public.chunks_without_embedding('m2', 10)")).rows.length >= 2, true);
  });
});

// ── 성능 ─────────────────────────────────────────────────────
test("시험용 대량 청크(2만 개)에서 검색 응답 p95 <= 800ms (RAG-04) - 실제 100만 청크 규모는 컴퓨트 결정(PO #6) 전 실측 대상", async () => {
  await h.tx(async () => {
    await client.query(
      `insert into public.chunks (source_type, source_id, chunk_no, doc_type, path, content, token_est, tax_items, valid_from, access_tier, rights_status, scope, source_hash, content_hash, index_version)
       select 'guide_version', 'perf-' || g, 0, 'guide', '시험용 > 대량 ' || g, '시험용 대량 청크 ' || g || ' 낱말' || (g % 500) || ' 항목' || (g % 37) || ' 설명 글자 채우기 ' || md5(g::text),
              5, array['local'], date '2000-01-01', 'public', 'confirmed', case when g % 10 = 0 then 'gift' else 'base' end, 'h', encode(sha256(g::text::bytea), 'hex'), 'chunk-v1'
         from generate_series(1, 20000) g`,
    );
    await client.query("analyze public.chunks");
    const times = [];
    for (let i = 0; i < 40; i++) {
      const t0 = performance.now();
      const rows = (await client.query("select chunk_id from public.agent_search($1)", [`낱말${(i * 13) % 500} 항목${i % 37}`])).rows;
      times.push(performance.now() - t0);
      assert.ok(rows.length > 0);
      assert.ok(rows.length <= 40);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(times.length * 0.95) - 1];
    assert.ok(p95 <= 800, `p95 ${p95.toFixed(0)}ms`);
    // 꺼진 범위(gift)는 대량 데이터에서도 0
    const leaked = (await client.query("select count(*)::int n from public.agent_search('낱말10 항목10') s join public.chunks c on c.id = s.chunk_id where c.scope = 'gift'")).rows[0].n;
    assert.equal(leaked, 0);
  });
});

// ── 코드 검토 ────────────────────────────────────────────────
test("학습용 내보내기 코드 0 - 색인 코드에 미세조정·학습 데이터 내보내기·파일 쓰기가 없다 (RAG-06)", () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const files = [
    ...fs.readdirSync(path.join(root, "apps/web/lib/agent")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => `apps/web/lib/agent/${f}`),
    ...fs.readdirSync(path.join(root, "apps/web/lib/server/agent")).filter((f) => f.endsWith(".ts")).map((f) => `apps/web/lib/server/agent/${f}`),
    "packages/db/supabase/migrations/20261026000151_w12a_chunks.sql",
    "packages/db/supabase/migrations/20261026000152_w12a_agent_search.sql",
    "packages/db/supabase/migrations/20261026000153_w12a_index_queue.sql",
  ];
  assert.ok(files.length >= 8);
  for (const f of files) {
    const text = fs.readFileSync(path.join(root, f), "utf8").split("\n").filter((l) => !/^\s*(\/\/|--|\*|\/\*)/.test(l)).join("\n");
    assert.doesNotMatch(text, /fine[-_ ]?tun|training[-_ ]?(data|set)|jsonl|writeFile|createWriteStream|copy\s+.*\sto\s+(program|'|stdout)|\\copy/i, f);
  }
});
