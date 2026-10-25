// W10-d 2단계 DB - 해석 DB 공개 조건·검색·공개 보류 (마이그레이션 89~90)  (PRD-02 TX-10 · CASE-01 · CASE-02)
//  · 스냅샷 없는 문서·권리 미확인·이용 조건 미확인 원천·기능 키 꺼짐은 공개 0
//  · 실명·주민등록번호 패턴이 검출되면 공개 보류 + 공통 검수 항목, 검수 승인 뒤에만 풀림(주민등록번호가 남아 있으면 승인돼도 못 풂)
//  · 검색 함수 - 띄어쓰기 변형 같은 결과, 유형·세목·결정 유형·기간(경계 포함)·조문(연결 기준) 필터, 유형별 개수 5행(0건 포함), 쪽
//  · 검색 p95 <= 800ms (문서 3,000건)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { open, helpers } from "./_w10d_helpers.mjs";

let client;
let h;
before(async () => {
  client = await open();
  h = helpers(client);
});
after(async () => client?.end());

const publicIds = async (ids) => (await h.anon("select id from public.public_legal_docs where id = any($1::bigint[]) order by id", [ids])).rows.map((r) => Number(r.id));
const REQUIRED = ["original_compared", "numbers_dates_links", "no_personal_info", "rights_checked", "anonymity_checked"];

test("공개 조건 - 기능 키 꺼짐 0, 스냅샷 없음 0, 권리 미확인 0, 심판의 비실명 미확인 0, 모두 갖추면 공개", () =>
  h.tx(async () => {
    const ok = await h.doc();
    const noSnap = await h.doc({ snapshot_id: null });
    const unchecked = await h.doc({ rights_status: "unchecked" });
    const noAnon = await h.doc({ doc_type: "tribunal", anonymity_check: "unchecked" });
    const all = [ok, noSnap, unchecked, noAnon];
    assert.deepEqual(await publicIds(all), [], "기능 키 case_db 꺼짐");
    await h.flags({ case_db: true });
    assert.deepEqual(await publicIds(all), [Number(ok)]);
    assert.equal((await h.one("select count(*)::int n from public.legal_doc_texts where legal_doc_id = $1", [noSnap])).n, 0, "스냅샷 없는 문서는 본문 행도 없다");
  }));

test("수집기 문서 - 원천 이용 조건이 허용 전(미확인)이면 공개 0, 허용으로 기록하면 공개", () =>
  h.tx(async () => {
    await h.flags({ case_db: true });
    const src = (await h.one("select key from public.data_sources order by key limit 1")).key;
    const d = await h.doc({ origin: "pipeline", source_key: src, source_doc_id: h.uniq("시험용-원천번호") });
    assert.deepEqual(await publicIds([d]), []);
    await client.query("update public.data_sources set terms_status = 'allowed', terms_note = '시험용 근거', terms_checked_by = 'w10d-test', terms_checked_at = now() where key = $1", [src]);
    assert.deepEqual(await publicIds([d]), [Number(d)]);
  }));

test("실명 패턴 검출 함수 - 당사자 표시어 뒤 성씨+한글은 검출, 가린 표기(○·X·모씨)는 검출 0, 주민등록번호는 문서 유형과 상관없이 검출", async () => {
  const kinds = async (t, type) => (await h.one("select public.legal_doc_pii_kinds($1, $2) as k", [t, type])).k;
  assert.deepEqual(await kinds("원고 김철수는 주장한다", "tribunal"), ["real_name"]);
  assert.deepEqual(await kinds("청구인 박○○의 주장", "case"), []);
  assert.deepEqual(await kinds("피고 김모씨가", "case"), []);
  assert.deepEqual(await kinds("원고 XXX는", "tribunal"), []);
  assert.deepEqual(await kinds("원고 김철수", "ruling"), [], "예규에는 실명 검사를 하지 않는다");
  assert.deepEqual(await kinds("번호 900101-1234567 입니다", "ruling"), ["rrn"]);
  assert.deepEqual(await kinds("번호 9001011234567 입니다", "case"), ["rrn"]);
  assert.deepEqual(await kinds("숫자 12345678901234 이어짐", "ruling"), []);
  assert.deepEqual(await kinds("원고 최영희 900101-2345678", "case"), ["rrn", "real_name"]);
});

test("판결문 실명 보류 - 검출되면 공개 0 + 검수 항목 1건(재저장해도 1건), 가린 문서는 공개, 승인 전에는 풀 수 없고 승인 뒤에 풀면 공개", () =>
  h.tx(async () => {
    await h.flags({ case_db: true });
    const named = await h.doc({ doc_type: "case" }, "원고 김철수가 청구한다");
    const masked = await h.doc({ doc_type: "case" }, "원고 ○○○가 청구한다");
    assert.deepEqual(await publicIds([named, masked]), [Number(masked)]);
    const hold = await h.one("select id, reason from public.legal_doc_holds where legal_doc_id = $1", [named]);
    assert.equal(hold.reason, "real_name");
    assert.equal((await h.one("select count(*)::int n from public.review_items where kind = 'legal_doc' and source_key = $1", [`pii_hold:${named}`])).n, 1);
    await client.query("update public.legal_docs set snapshot_id = snapshot_id where id = $1", [named]);
    assert.equal((await h.one("select count(*)::int n from public.review_items where kind = 'legal_doc' and source_key = $1", [`pii_hold:${named}`])).n, 1, "재검사해도 검수 항목 1건");
    const release = () => h.attempt("select public.legal_doc_hold_release($1, 'w10d-test', '시험용 검수 승인')", [hold.id]);
    assert.match((await release()).message, /공통 검수에서 승인된 뒤에만/);
    const item = (await h.one("select id from public.review_items where source_key = $1", [`pii_hold:${named}`])).id;
    await client.query("select public.review_item_transition($1, 'in_review', 'w10d-test', null, null, null)", [item]);
    await client.query("select public.review_item_transition($1, 'approved', 'w10d-test', null, $2::text[], null)", [item, REQUIRED]);
    assert.ok((await release()).ok);
    assert.deepEqual(await publicIds([named]), [Number(named)]);
    assert.equal((await h.attempt("delete from public.legal_doc_holds where id = $1", [hold.id])).ok, false, "보류 기록 지우기 거부");
  }));

test("주민등록번호 패턴이 본문에 남아 있으면 검수 승인 뒤에도 보류를 풀 수 없다", () =>
  h.tx(async () => {
    await h.flags({ case_db: true });
    const d = await h.doc({ doc_type: "ruling" }, "안내 문서 900101-1234567 포함");
    const hold = await h.one("select id from public.legal_doc_holds where legal_doc_id = $1 and reason = 'rrn'", [d]);
    const item = (await h.one("select id from public.review_items where source_key = $1", [`pii_hold:${d}`])).id;
    await client.query("select public.review_item_transition($1, 'in_review', 'w10d-test', null, null, null)", [item]);
    await client.query("select public.review_item_transition($1, 'approved', 'w10d-test', null, $2::text[], null)", [item, REQUIRED]);
    const r = await h.attempt("select public.legal_doc_hold_release($1, 'w10d-test', '시험용')", [hold.id]);
    assert.equal(r.ok, false);
    assert.match(r.message, /주민등록번호 패턴/);
    assert.deepEqual(await publicIds([d]), []);
  }));

test("검색 - 띄어쓰기 변형 같은 결과, 유형·세목·결정 유형 필터, 기간 경계(시작일·종료일 당일 포함), 유형별 개수 5행(0건 유형 포함)", () =>
  h.tx(async () => {
    await h.flags({ case_db: true });
    const tag = h.uniq("가상쟁점");
    const a = await h.doc({ doc_type: "tribunal", decided_on: "2026-03-01", decision_kind: "rejected", tax_kinds: ["취득세"] }, `이 문서는 ${tag} 간주취득 사례`);
    const b = await h.doc({ doc_type: "tribunal", decided_on: "2026-03-02", decision_kind: "accepted", tax_kinds: ["재산세"] }, `다른 ${tag} 사례`);
    const c = await h.doc({ doc_type: "case", decided_on: "2026-02-28", decision_kind: "rejected", tax_kinds: ["취득세"] }, `판례 ${tag}`);
    const search = async (args) => {
      const p = { q: tag, type: null, tax: null, law: null, art: null, br: 0, dec: null, from: null, to: null, ...args };
      return (await h.anon("select id, total from public.search_legal_docs($1, $2, $3, $4, $5, $6, $7, $8, $9)", [p.q, p.type, p.tax, p.law, p.art, p.br, p.dec, p.from, p.to])).rows;
    };
    const ids = async (args) => (await search(args)).map((r) => Number(r.id)).sort((x, y) => x - y);
    assert.deepEqual(await ids({}), [a, b, c].map(Number).sort((x, y) => x - y));
    assert.deepEqual(await ids({ q: tag.replace("-", " - ") }), await ids({}), "띄어쓰기·기호 변형");
    assert.deepEqual(await ids({ q: `${tag} 간주취득` }), [Number(a)]);
    assert.deepEqual(await ids({ type: "case" }), [Number(c)]);
    assert.deepEqual(await ids({ dec: "rejected", type: "tribunal" }), [Number(a)]);
    assert.deepEqual(await ids({ tax: "재산세" }), [Number(b)]);
    assert.deepEqual(await ids({ from: "2026-03-01" }), [a, b].map(Number).sort((x, y) => x - y), "시작일 당일 포함, 전날 제외");
    assert.deepEqual(await ids({ to: "2026-02-28" }), [Number(c)], "종료일 당일 포함, 다음 날 제외");
    assert.deepEqual(await ids({ q: "!!!" }), [], "정규형이 비는 검색어는 0건");
    assert.equal((await search({}))[0].total, "3");
    const counts = (await h.anon("select doc_type, n::int from public.legal_doc_type_counts($1)", [tag])).rows;
    assert.deepEqual(counts, [{ doc_type: "ruling", n: 0 }, { doc_type: "circular", n: 0 }, { doc_type: "interpretation", n: 0 }, { doc_type: "tribunal", n: 2 }, { doc_type: "case", n: 1 }]);
    const page = (await h.anon("select id from public.search_legal_docs($1, null, null, null, null, 0, null, null, null, 2, 2)", [tag])).rows;
    assert.equal(page.length, 1, "3건 중 2건씩 2쪽 = 1건");
  }));

test("조문 필터 - 그 조문을 확인된 연결로 가리키는 문서만(개수·ID 일치), 후보 연결은 제외", () =>
  h.tx(async () => {
    await h.flags({ case_db: true, law_viewer: true });
    const name = h.uniq("시험용법");
    const law = await h.law(name);
    await h.article(await h.version(law), 11);
    await h.article(await h.version(law, { promulgation_no: h.uniq("시험용"), effective_on: "2026-06-01" }), 12);
    const docs = [await h.doc(), await h.doc(), await h.doc()];
    const l0 = (await h.link({ src_id: docs[0], dst_id: law, dst_article_no: 11, dst_branch_no: 0 })).rows[0].id;
    const l1 = (await h.link({ src_id: docs[1], dst_id: law, dst_article_no: 11, dst_branch_no: 0 })).rows[0].id;
    await h.link({ src_id: docs[2], dst_id: law, dst_article_no: 11, dst_branch_no: 0 });
    await h.confirm(l0);
    await h.confirm(l1);
    const filtered = (await h.anon("select id from public.search_legal_docs(null, null, null, $1, 11, 0, null, null, null)", [law])).rows.map((r) => Number(r.id)).sort((x, y) => x - y);
    const linked = (await h.anon("select src_id from public.public_links where dst_id = $1 and dst_article_no = 11 and dst_branch_no = 0 and src_kind = 'legal_doc'", [law])).rows.map((r) => Number(r.src_id)).sort((x, y) => x - y);
    assert.deepEqual(filtered, linked);
    assert.deepEqual(filtered, [Number(docs[0]), Number(docs[1])].sort((x, y) => x - y));
    assert.deepEqual((await h.anon("select id from public.search_legal_docs(null, null, null, $1, 12, 0, null, null, null)", [law])).rows, []);
  }));

test("권한 - anon은 검색 함수 2개만 실행하고 정규화·검사 도우미는 실행 못 하며, 공개 뷰에는 스냅샷 번호·해시 칸이 없다", () =>
  h.tx(async () => {
    for (const fn of ["legal_doc_pii_kinds(text, text)", "legal_doc_payload_text(text)", "quality_sample_passes(text, integer, integer)", "link_add_candidate(text, bigint, text, bigint, integer, integer, text, text, text)", "legal_doc_hold_release(bigint, text, text)", "law_provision_exists(bigint, integer, integer)"]) {
      const r = await h.one(`select has_function_privilege('anon', 'public.${fn}', 'EXECUTE') a, has_function_privilege('service_role', 'public.${fn}', 'EXECUTE') s`);
      assert.deepEqual(r, { a: false, s: true }, fn);
    }
    for (const fn of ["search_legal_docs(text, text, text, bigint, integer, integer, text, date, date, integer, integer)", "legal_doc_type_counts(text, text, bigint, integer, integer, text, date, date)"]) {
      assert.equal((await h.one(`select has_function_privilege('anon', 'public.${fn}', 'EXECUTE') a`)).a, true, fn);
      assert.equal((await h.one(`select prosecdef from pg_proc where oid = 'public.${fn}'::regprocedure`)).prosecdef, false, `${fn} security invoker`);
    }
    const cols = (await client.query("select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name like 'public\\_law%' or (table_schema = 'public' and table_name in ('public_legal_docs', 'public_legal_doc_bodies', 'public_links'))")).rows;
    assert.ok(cols.length > 0);
    assert.deepEqual(cols.filter((c) => ["snapshot_id", "body_hash", "content_hash", "rights_status", "confirmed_by", "created_by", "evidence"].includes(c.column_name)), []);
  }));

test("검색 p95 <= 800ms - 문서 3,000건에서 같은 질의를 40번", async () => {
  await client.query("begin");
  try {
    await h.flags({ case_db: true });
    await client.query(
      `with s as (insert into public.raw_snapshots (source, url, content_hash, payload)
                    select 'w10d-perf', 'https://example.test/시험용/perf/' || g, 'perf-' || ${process.pid} || '-' || g, '시험용 성능 문서 ' || g || ' 쟁점' || (g % 40) || ' 간주취득 사례 본문'
                      from generate_series(1, 3000) g returning id, payload)
       insert into public.legal_docs (doc_type, issuer, doc_no, decided_on, tax_kinds, source_url, snapshot_id, rights_status, anonymity_check, content_hash)
       select (array['ruling','circular','interpretation','tribunal','case'])[1 + (s.id % 5)::int], '시험용 기관', 'perf-' || ${process.pid} || '-' || s.id, date '2026-01-01' + (s.id % 200)::int,
              array['취득세'], 'https://example.test/시험용/perf', s.id, 'confirmed', 'confirmed', 'ch-' || ${process.pid} || '-' || s.id from s`,
    );
    const times = [];
    for (let i = 0; i < 40; i++) {
      const t0 = performance.now();
      await client.query("set local role anon");
      await client.query("select * from public.search_legal_docs($1, $2, null, null, null, 0, null, null, null, 20, 0)", [`쟁점${i % 40} 간주취득`, i % 2 ? "tribunal" : null]);
      await client.query("reset role");
      times.push(performance.now() - t0);
    }
    times.sort((x, y) => x - y);
    const p95 = times[Math.floor(times.length * 0.95) - 1];
    assert.ok(p95 <= 800, `p95 ${p95.toFixed(0)}ms`);
  } finally {
    await client.query("rollback");
  }
});
