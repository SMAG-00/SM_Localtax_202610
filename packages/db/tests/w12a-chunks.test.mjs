// W12-a DB - 청크 표 · 색인 대기열 · 색인 쓰기 (마이그레이션 151·153, docs/dev/W12-a_설계.md - PRD-04 RAG-01 · RAG-03 · RAG-06)
//  · source_type 허용 목록 밖(회원 글·일반 웹문서 등) 0 (DB 제약) · 메타 하나라도 비면 거부 · 원천/문서 종류 짝 · 출판물은 권리 확인 + 프리미엄만
//  · 고치기·지우기 거부 (효력 끝·뺀 시각만 한 번 채움) · 현행 행은 원천+조각 번호당 1개
//  · chunk_index_put - 메타 빠짐/권리 미확인 거부(행 0) · 멱등 · 바뀌면 이전 행 빼고 새 행 · 법령 효력 끝 양방향 채움
//  · 대기열 - 새 원천 1건 쌓임 · 재실행 중복 0 · 끝난 뒤 같은 해시 재실행 0 · 권리 철회하면 청크 즉시 제외 · origin이 live_fetch면 색인 대상 아님
//  · 권한 - anon·authenticated는 표 읽기 0, 쓰기 함수 실행 거부
// 모든 시험은 거래 안에서 돌고 되돌린다. 글은 시험용 가짜다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { open, helpers } from "./_w10c_helpers.mjs";

let client;
let h;
before(async () => {
  client = await open();
  h = helpers(client);
});
after(async () => client?.end());

const HASH = (n) => createHash("sha256").update(String(n)).digest("hex");
async function chunkRow(over = {}) {
  const row = {
    source_type: "law_article", source_id: h.uniq("src"), chunk_no: 0, doc_type: "law", path: "시험용법 > 제1조", content: "시험용 본문", token_est: 4,
    tax_items: ["local"], valid_from: "2000-01-01", access_tier: "public", rights_status: "confirmed", scope: "base", snapshot_id: null,
    source_hash: "h1", content_hash: HASH(1), index_version: "chunk-v1", ...over,
  };
  if (row.snapshot_id === null && ["law_article", "interpretation", "case_decision"].includes(row.source_type) && !("snapshot_id" in over)) row.snapshot_id = await h.snapshot();
  const keys = Object.keys(row);
  return h.attempt(`insert into public.chunks (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, keys.map((k) => row[k]));
}

test("정상 청크는 들어가고 전문 검색 칸이 생성된다", () =>
  h.tx(async () => {
    const r = await chunkRow();
    assert.equal(r.ok, true, r.message);
    const row = await h.one("select search_text from public.chunks where id = $1", [r.rows[0].id]);
    assert.match(row.search_text, /시험용/);
  }));

test("source_type 허용 목록 밖(회원 작성 글·일반 웹문서·빈 값)은 DB 제약이 거부한다 (RAG-03)", () =>
  h.tx(async () => {
    for (const bad of ["member_post", "comment", "web_page", "qna", ""]) {
      const r = await chunkRow({ source_type: bad });
      assert.equal(r.ok, false, bad);
      assert.match(r.message, /source_type|chunks_type_pair/);
    }
  }));

test("원천 종류와 문서 종류가 안 맞으면 거부", () =>
  h.tx(async () => {
    const r = await chunkRow({ source_type: "law_article", doc_type: "guide" });
    assert.equal(r.ok, false);
    assert.match(r.message, /chunks_type_pair/);
  }));

test("메타가 하나라도 비면 거부 (RAG-01) - NOT NULL·빈 문자열·빈 세목 목록", () =>
  h.tx(async () => {
    const cases = [
      { doc_type: null }, { path: " " }, { content: "" }, { tax_items: [] }, { tax_items: [""] }, { tax_items: null }, { valid_from: null },
      { access_tier: null }, { rights_status: null }, { scope: null }, { source_hash: " " }, { content_hash: "xyz" }, { index_version: "" }, { source_id: "" },
    ];
    for (const over of cases) {
      const r = await chunkRow(over);
      assert.equal(r.ok, false, JSON.stringify(over));
    }
    assert.equal((await chunkRow({ access_tier: "gold" })).ok, false);
    assert.equal((await chunkRow({ scope: "everything" })).ok, false);
    assert.equal((await chunkRow({ valid_to: "1999-01-01" })).ok, false, "효력 끝이 시작보다 빠름");
  }));

test("법령·해석·결정례는 스냅샷이 없으면 거부", () =>
  h.tx(async () => {
    const r = await chunkRow({ snapshot_id: null, source_type: "law_article" });
    assert.equal(r.ok, false);
    const ok = await chunkRow({ source_type: "guide_version", doc_type: "guide" });
    assert.equal(ok.ok, true, ok.message);
  }));

test("출판물 - 권리 미확인 거부, 프리미엄이 아니면 거부, 확인 + 프리미엄이면 들어간다 (RAG-06 · ASK-14)", () =>
  h.tx(async () => {
    const base = { source_type: "publication", doc_type: "publication" };
    assert.equal((await chunkRow({ ...base, access_tier: "premium", rights_status: "unchecked" })).ok, false);
    assert.equal((await chunkRow({ ...base, access_tier: "premium", rights_status: "restricted" })).ok, false);
    assert.equal((await chunkRow({ ...base, access_tier: "public", rights_status: "confirmed" })).ok, false);
    assert.equal((await chunkRow({ ...base, access_tier: "premium", rights_status: "confirmed" })).ok, true);
  }));

test("현행 행은 원천 + 조각 번호당 1개, 빼면 새로 넣을 수 있다", () =>
  h.tx(async () => {
    const sid = h.uniq("dup");
    const a = await chunkRow({ source_id: sid, source_type: "guide_version", doc_type: "guide" });
    assert.equal(a.ok, true);
    assert.equal((await chunkRow({ source_id: sid, source_type: "guide_version", doc_type: "guide", content_hash: HASH(2) })).ok, false);
    await client.query("update public.chunks set retired_at = now() where id = $1", [a.rows[0].id]);
    assert.equal((await chunkRow({ source_id: sid, source_type: "guide_version", doc_type: "guide", content_hash: HASH(2) })).ok, true);
  }));

test("내용 고치기·지우기 거부 - 효력 끝과 뺀 시각만 비어 있을 때 한 번 채운다", () =>
  h.tx(async () => {
    const id = (await chunkRow({ source_type: "guide_version", doc_type: "guide" })).rows[0].id;
    assert.equal((await h.attempt("update public.chunks set content = '바꿈' where id = $1", [id])).ok, false);
    assert.equal((await h.attempt("update public.chunks set scope = 'gift' where id = $1", [id])).ok, false);
    assert.equal((await h.attempt("delete from public.chunks where id = $1", [id])).ok, false);
    assert.equal((await h.attempt("update public.chunks set valid_to = '2010-01-01' where id = $1", [id])).ok, true);
    assert.equal((await h.attempt("update public.chunks set valid_to = '2011-01-01' where id = $1", [id])).ok, false);
    assert.equal((await h.attempt("update public.chunks set retired_at = now() where id = $1", [id])).ok, true);
    assert.equal((await h.attempt("update public.chunks set retired_at = null where id = $1", [id])).ok, false);
  }));

test("권한 - anon·authenticated는 chunks 읽기·쓰기 0, 쓰기 함수 실행 거부, service_role은 읽기만", () =>
  h.tx(async () => {
    await chunkRow({ source_type: "guide_version", doc_type: "guide" });
    for (const role of ["anon", "authenticated"]) {
      const r = await h.attempt("select count(*) from public.chunks", [], role);
      assert.equal(r.ok, false, `${role} 읽기`);
      const fn = await h.attempt("select public.chunk_index_put('guide_version', 'x', 'v', '{}'::jsonb, '[]'::jsonb)", [], role);
      assert.equal(fn.ok, false, `${role} chunk_index_put`);
      const q = await h.attempt("select public.index_queue_scan('v')", [], role);
      assert.equal(q.ok, false, `${role} index_queue_scan`);
    }
    assert.equal((await h.attempt("select count(*) from public.chunks", [], "service_role")).ok, true);
    assert.equal((await h.attempt("insert into public.chunks (source_type) values ('guide_version')", [], "service_role")).ok, false);
  }));

// ── chunk_index_put ──────────────────────────────────────────
const meta = (over = {}) => ({ docType: "guide", taxItems: ["realestate_tax"], validFrom: "2000-01-01", accessTier: "public", rightsStatus: "confirmed", scope: "base", sourceHash: "sh1", ...over });
const chunks = (n = 1, tag = "a") => Array.from({ length: n }, (_, i) => ({ chunkNo: i, path: `시험용 > ${i}`, content: `시험용 본문 ${tag} ${i}`, tokenEst: 5, contentHash: HASH(`${tag}-${i}`) }));
const put = async (type, id, m, c, v = "chunk-v1") => (await h.one("select public.chunk_index_put($1, $2, $3, $4::jsonb, $5::jsonb) as r", [type, id, v, JSON.stringify(m), JSON.stringify(c)])).r;

test("chunk_index_put - 정상 입력은 넣고, 같은 입력을 다시 넣으면 0건(멱등)", () =>
  h.tx(async () => {
    const id = h.uniq("g");
    const first = await put("guide_version", id, meta(), chunks(3));
    assert.equal(first.ok, true);
    assert.equal(first.inserted, 3);
    assert.equal(first.ids.length, 3);
    const again = await put("guide_version", id, meta(), chunks(3));
    assert.deepEqual([again.ok, again.inserted, again.retired], [true, 0, 0]);
    assert.equal((await h.one("select count(*)::int n from public.chunks where source_id = $1 and retired_at is null", [id])).n, 3);
  }));

test("chunk_index_put - 메타가 빠지면 { ok:false, code:meta_missing, fields } 이고 행 0", () =>
  h.tx(async () => {
    const id = h.uniq("g");
    for (const key of ["docType", "taxItems", "validFrom", "accessTier", "rightsStatus", "scope", "sourceHash"]) {
      const m = meta();
      delete m[key];
      const r = await put("guide_version", id, m, chunks());
      assert.equal(r.ok, false, key);
      assert.equal(r.code, "meta_missing");
      assert.ok(r.fields.includes(key), key);
    }
    assert.equal((await put("guide_version", id, meta({ taxItems: [] }), chunks())).code, "meta_missing");
    assert.equal((await put("guide_version", id, meta(), [{ chunkNo: 0, path: "p", content: " ", tokenEst: 1, contentHash: HASH(1) }])).code, "meta_missing");
    assert.equal((await h.one("select count(*)::int n from public.chunks where source_id = $1", [id])).n, 0);
  }));

test("chunk_index_put - 권리 미확인·제한은 거부, 출판물도 권리 확인 전 청크 0 (RAG-06)", () =>
  h.tx(async () => {
    const id = h.uniq("p");
    assert.equal((await put("guide_version", id, meta({ rightsStatus: "unchecked" }), chunks())).code, "rights_not_confirmed");
    assert.equal((await put("publication", id, meta({ docType: "publication", accessTier: "premium", rightsStatus: "unchecked" }), chunks())).code, "rights_not_confirmed");
    assert.equal((await h.one("select count(*)::int n from public.chunks where source_id = $1", [id])).n, 0);
    const ok = await put("publication", id, meta({ docType: "publication", accessTier: "premium" }), chunks());
    assert.equal(ok.ok, true);
  }));

test("chunk_index_put - 원천이 바뀌면(조각 수 감소·해시 변경) 이전 행은 빼고 새 행을 넣는다 (이전 버전 보존)", () =>
  h.tx(async () => {
    const id = h.uniq("g");
    await put("guide_version", id, meta(), chunks(3, "a"));
    const r = await put("guide_version", id, meta({ sourceHash: "sh2" }), chunks(2, "b"));
    assert.equal(r.ok, true);
    assert.equal(r.retired, 3);
    assert.equal(r.inserted, 2);
    const rows = (await client.query("select retired_at is null as active, count(*)::int n from public.chunks where source_id = $1 group by 1 order by 1", [id])).rows;
    assert.deepEqual(rows.map((x) => [x.active, x.n]), [[false, 3], [true, 2]]);
  }));

test("chunk_index_put - 법령 조문의 새 개정판이 색인되면 옛 행의 효력 끝이 새 시행일로 채워진다 (양방향)", () =>
  h.tx(async () => {
    const key = h.uniq("law");
    const snap = await h.snapshot();
    const lm = (from, hash) => meta({ docType: "law", taxItems: ["local"], validFrom: from, sourceHash: hash, snapshotId: snap, supersedeKey: key });
    const a = h.uniq("old");
    const b = h.uniq("new");
    await put("law_article", a, lm("2000-01-01", "o"), chunks(1, "o"));
    await put("law_article", b, lm("2010-01-01", "n"), chunks(1, "n"));
    assert.equal((await h.one("select to_char(valid_to, 'YYYY-MM-DD') v from public.chunks where source_id = $1", [a])).v, "2010-01-01");
    assert.equal((await h.one("select valid_to from public.chunks where source_id = $1", [b])).valid_to, null);
    // 옛 개정판을 나중에 색인해도 효력 끝이 붙는다
    const c = h.uniq("older");
    await put("law_article", c, lm("1990-01-01", "x"), chunks(1, "x"));
    assert.equal((await h.one("select to_char(valid_to, 'YYYY-MM-DD') v from public.chunks where source_id = $1", [c])).v, "2000-01-01");
  }));

// ── 대기열 ───────────────────────────────────────────────────
async function lawArticle(over = {}) {
  const law = (await h.one("select id from public.laws where name = '지방세법'")).id;
  const snap = await h.snapshot(over.snapshot ?? {});
  const v = await h.one(
    "insert into public.law_versions (law_id, promulgation_no, promulgated_on, effective_on, body_hash, snapshot_id) values ($1, $2, '2000-01-01', '2000-02-01', $3, $4) returning id",
    [law, h.uniq("시험용"), h.uniq("bh"), snap],
  );
  return (await h.one("insert into public.law_articles (version_id, article_no, branch_no, body) values ($1, $2, 0, $3) returning id", [v.id, over.no ?? 1, over.body ?? "시험용 조문"])).id;
}

test("스캔 - 새 법령 조문 1건이 대기열에 쌓이고, 재실행해도 중복 0 (RAG-03)", () =>
  h.tx(async () => {
    const id = String(await lawArticle());
    const s1 = await h.one("select public.index_queue_scan('chunk-v1') as r");
    assert.equal(s1.r.ok, true);
    assert.ok(s1.r.enqueued >= 1);
    const q = await client.query("select reason, source_hash from public.index_queue where source_type = 'law_article' and source_id = $1", [id]);
    assert.equal(q.rows.length, 1);
    assert.equal(q.rows[0].reason, "new");
    const s2 = await h.one("select public.index_queue_scan('chunk-v1') as r");
    assert.equal(s2.r.enqueued, 0);
  }));

test("claim -> load -> put -> finish 한 바퀴 뒤 같은 해시는 다시 쌓이지 않고, 청크가 검색 칸과 함께 생긴다", () =>
  h.tx(async () => {
    const id = String(await lawArticle({ body: "시험용 한 줄 조문" }));
    await client.query("select public.index_queue_scan('chunk-v1')");
    const claimed = (await client.query("select * from public.index_queue_claim(1000)")).rows.find((r) => r.source_id === id);
    assert.ok(claimed);
    const payload = (await h.one("select public.chunk_source_load('law_article', $1) as p", [id])).p;
    assert.equal(payload.lawName, "지방세법");
    assert.equal(payload.scope, "base");
    assert.equal(payload.body, "시험용 한 줄 조문");
    const r = await put("law_article", id, { docType: "law", taxItems: payload.taxItems, validFrom: payload.validFrom, accessTier: "public", rightsStatus: "confirmed", scope: "base", sourceHash: payload.sourceHash, snapshotId: payload.snapshotId, supersedeKey: payload.supersedeKey }, chunks());
    assert.equal(r.ok, true, JSON.stringify(r));
    await client.query("select public.index_queue_finish($1, true, null, 1)", [claimed.id]);
    assert.equal((await h.one("select public.index_queue_scan('chunk-v1') as r")).r.enqueued, 0);
    const st = (await h.one("select public.index_queue_status() as s")).s;
    assert.equal(typeof st.pending, "number");
  }));

test("실패하면 시도 횟수만 늘고 다시 가져갈 수 있으며, 5번 넘으면 가져가지 않는다", () =>
  h.tx(async () => {
    const id = String(await lawArticle());
    await client.query("select public.index_queue_scan('chunk-v1')");
    const qid = (await client.query("select id from public.index_queue where source_id = $1", [id])).rows[0].id;
    for (let i = 0; i < 5; i++) {
      const got = (await client.query("select * from public.index_queue_claim(1000)")).rows.some((r) => r.id === qid);
      assert.equal(got, true, `${i + 1}번째 시도`);
      await client.query("select public.index_queue_finish($1, false, $2)", [qid, "x".repeat(500)]);
    }
    assert.equal((await client.query("select * from public.index_queue_claim(1000)")).rows.some((r) => r.id === qid), false);
    const row = await h.one("select attempts, char_length(last_error) as n from public.index_queue where id = $1", [qid]);
    assert.deepEqual([row.attempts, row.n], [5, 300]);
  }));

test("origin이 live_fetch인 스냅샷의 법령은 색인 대상이 아니다 (수집 대기열 검수 전 색인 0)", () =>
  h.tx(async () => {
    const id = String(await lawArticle({ snapshot: { origin: "live_fetch" } }));
    assert.equal((await h.one("select count(*)::int n from public.chunk_sources where source_type = 'law_article' and source_id = $1", [id])).n, 0);
    const ok = String(await lawArticle({ no: 2 }));
    assert.equal((await h.one("select count(*)::int n from public.chunk_sources where source_type = 'law_article' and source_id = $1", [ok])).n, 1);
  }));

test("원천이 색인 대상에서 빠지면(여기서는 스냅샷 origin 변경) 스캔이 그 청크를 즉시 뺀다", () =>
  h.tx(async () => {
    const id = String(await lawArticle());
    const p = (await h.one("select public.chunk_source_load('law_article', $1) as p", [id])).p;
    await put("law_article", id, { docType: "law", taxItems: p.taxItems, validFrom: p.validFrom, accessTier: "public", rightsStatus: "confirmed", scope: "base", sourceHash: p.sourceHash, snapshotId: p.snapshotId }, chunks());
    assert.equal((await h.one("select count(*)::int n from public.chunks where source_id = $1 and retired_at is null", [id])).n, 1);
    await client.query("update public.raw_snapshots set origin = 'live_fetch' where id = $1", [p.snapshotId]);
    const s = await h.one("select public.index_queue_scan('chunk-v1') as r");
    assert.ok(s.r.retired >= 1);
    assert.equal((await h.one("select count(*)::int n from public.chunks where source_id = $1 and retired_at is null", [id])).n, 0);
  }));

test("raw_snapshots.origin - 기본 pipeline, 허용 값 밖 거부", () =>
  h.tx(async () => {
    const id = await h.snapshot();
    assert.equal((await h.one("select origin from public.raw_snapshots where id = $1", [id])).origin, "pipeline");
    for (const ok of ["live_fetch", "web_search", "stats"]) assert.equal((await h.attempt("update public.raw_snapshots set origin = $2 where id = $1", [id, ok])).ok, true, ok);
    assert.equal((await h.attempt("update public.raw_snapshots set origin = 'other' where id = $1", [id])).ok, false);
  }));
