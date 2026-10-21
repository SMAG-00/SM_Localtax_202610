// W3 10단계 DB — 검색·측정 연결 (docs/dev/W3_설계.md 1장 10단계 · 11장, W2-d 설계 2.1·3장 · PRD-01A SRCH-01 · 01B TX-09·TX-17)
//  · 결과 종류 interpretation(해석 원문) — 공개 가능한 원문 + 발행된 해석 해설(지정·subject 연결)이 있을 때만. 찾는 글 = 유형 글자·발행 기관·문서 번호·세목·조문,
//    문서 번호만 쓰면 등급 0, 분야는 지방세, 기간 거르개 = 결정·회신일, 주소 재료(slug) = 그 원문을 다루는 가장 최근 발행 해설
//  · 공개 전·권리 미확인 원문 0 — 권리 미확인·필수 칸 빈·심판 비실명 미확인·해설 초안·해설 지정 없음·related 연결만 → 0. service_role로 불러도 0(심층 방어)
//  · AI 색인 불허 칼럼 0 — 기고 계약 ai_index_scope = deny면 기사 결과·종류 숫자 0, allow·계약 없음은 그대로. 범위를 줄이면 바로 빠진다
//  · 기존 종류 그대로 — 트래커('개편안')·일반 기사·해설 기사 결과는 이번 변경 전과 같다
//  · 측정 — calculator_card_clicked의 카드 키 목록(W2-c 설계 2.3) = official_links 시드 키, 이벤트 3개는 이름 제약이 받는다(나머지 값은 w2c-analytics가 표 전체로 본다)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

const W2C = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "dev", "W2-c_설계.md"), "utf8");
const designValues = (name) => {
  const line = W2C.split("\n").find((l) => l.startsWith(`| ${name} `));
  assert.ok(line, `W2-c 설계에 '${name}' 줄이 없다`);
  return [...line.split("|")[2].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
};

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

let seq = 0;
const run = `${process.pid}${Date.now().toString(36)}`;
const uniq = (p) => `${p}-${run}-${++seq}`;
const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];

/** search_public 행 — 역할을 바꿔 부른다 (기본 anon) */
async function search(q, opts = {}, role = "anon") {
  await client.query("savepoint s");
  try {
    if (role) await client.query(`set local role ${role}`);
    const r = await client.query(
      "select * from public.search_public($1, $2, $3, $4, $5, $6, $7, $8, 0, null)",
      [q, opts.kinds ?? null, opts.section ?? null, opts.contentType ?? null, opts.region ?? null, opts.from ?? null, opts.to ?? null, 50],
    );
    return r.rows;
  } finally {
    await client.query("rollback to savepoint s");
  }
}
const refsOf = (rows, kind) => rows.filter((r) => r.kind === kind).map((r) => Number(r.ref));

const snapshot = async () =>
  Number((await one("insert into public.raw_snapshots (source, url, content_hash, payload) values ('시험용', 'https://example.test/s', $1, '시험용 가짜 원문') returning id", [uniq("h")])).id);
/** 공개 가능한 원문 (over로 칸을 비우거나 바꾼다) */
async function legalDoc(over = {}) {
  const doc = {
    doc_type: "ruling",
    issuer: "시험용기관",
    doc_no: uniq("시험번호"),
    decided_on: "2026-03-02",
    tax_kinds: ["시험세목"],
    provisions: ["시험법 제1조"],
    source_url: "https://example.test/doc",
    snapshot_id: await snapshot(),
    rights_status: "confirmed",
    anonymity_check: "unchecked",
    content_hash: uniq("hash"),
    ...over,
  };
  const r = await one(
    `insert into public.legal_docs (doc_type, issuer, doc_no, decided_on, tax_kinds, provisions, source_url, snapshot_id, rights_status, anonymity_check, content_hash)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
    [doc.doc_type, doc.issuer, doc.doc_no, doc.decided_on, doc.tax_kinds, doc.provisions, doc.source_url, doc.snapshot_id, doc.rights_status, doc.anonymity_check, doc.content_hash],
  );
  return { id: Number(r.id), ...doc };
}
/** 기사 — 발행이면 최초 발행 시각을 준다 */
async function article({ status = "published", contentType = "explainer", title = "시험용 해설 기사", publishedAt = "2026-03-10T00:00:00Z" } = {}) {
  const slug = uniq("w3sm");
  const r = await one(
    "insert into public.articles (slug, title, summary, section, content_type, status, first_published_at) values ($1, $2, '시험용 요약', 'tax', $3, $4, $5) returning id",
    [slug, title, contentType, status, status === "published" ? publishedAt : null],
  );
  return { id: Number(r.id), slug };
}
/** 해석 해설로 지정하고 원문을 잇는다 (발행된 기사에 지정·연결 — 발행 검사는 기사 쓰기 때 본다, 5단계) */
async function explain(articleId, docId, role = "subject", mark = true) {
  if (mark) await client.query("insert into public.interpretation_articles (article_id) values ($1) on conflict do nothing", [articleId]);
  await client.query("insert into public.article_legal_docs (article_id, legal_doc_id, role) values ($1, $2, $3)", [articleId, docId, role]);
}

// ── 해석 원문 결과 ─────────────────────────────────────────

test("해석 원문 — 공개 원문 + 발행 해설이면 결과 1행: 유형 글자·기관·번호·세목·조문으로 찾고, 번호만 쓰면 등급 0, 제목·한 줄·분야·날짜·주소 재료·meta", () =>
  tx(async () => {
    const doc = await legalDoc({ doc_type: "ruling", issuer: "시험용기관갑", doc_no: uniq("갑번호"), tax_kinds: ["시험세목갑"], provisions: ["시험법 제7조"] });
    const old = await article({ title: "시험용 옛 해설", publishedAt: "2026-03-05T00:00:00Z" });
    const latest = await article({ title: "시험용 새 해설", publishedAt: "2026-03-20T00:00:00Z" });
    await explain(old.id, doc.id);
    await explain(latest.id, doc.id);

    for (const q of [doc.doc_no, "시험용기관갑", "시험세목갑", "시험법 제7조", `예규 ${doc.doc_no}`]) {
      const rows = await search(q, { kinds: ["interpretation"] });
      assert.deepEqual(refsOf(rows, "interpretation"), [doc.id], `'${q}'로 해석 원문 1행`);
    }
    const [hit] = await search(doc.doc_no, { kinds: ["interpretation"] });
    assert.equal(hit.tier, 0, "문서 번호만 쓴 검색어 = 이름 같음");
    assert.equal(hit.title, `시험용기관갑 ${doc.doc_no}`);
    assert.equal(hit.snippet, "시험용 새 해설", "한 줄 = 가장 최근 발행 해설 제목");
    assert.equal(hit.slug, latest.slug, "주소 재료 = 가장 최근 발행 해설");
    assert.equal(hit.section, "tax");
    assert.equal(hit.content_type, null);
    assert.equal(new Date(hit.published_at).toISOString(), "2026-03-01T15:00:00.000Z", "날짜 = 결정일(한국 날짜 0시)");
    assert.deepEqual(hit.meta, { doc_type: "ruling", decided_on: "2026-03-02", tax_kinds: ["시험세목갑"], provisions: ["시험법 제7조"], source_url: "https://example.test/doc" });
    assert.equal(hit.kind_counts.interpretation, 1);

    // 유형 글자 — 예규는 '예규'로 찾히고 '판례'로는 0
    assert.ok(refsOf(await search(`예규 시험세목갑`), "interpretation").includes(doc.id));
    assert.deepEqual(refsOf(await search(`판례 시험세목갑`), "interpretation"), []);
  }));

test("해석 원문 — 거르개: 분야 지방세만, 기사 유형·지역을 고르면 0, 기간 = 결정·회신일(그날 포함)", () =>
  tx(async () => {
    const doc = await legalDoc({ decided_on: "2026-04-15", doc_no: uniq("을번호") });
    const a = await article();
    await explain(a.id, doc.id);
    const q = doc.doc_no;
    assert.deepEqual(refsOf(await search(q, { section: "tax" }), "interpretation"), [doc.id]);
    assert.deepEqual(refsOf(await search(q, { section: "realestate" }), "interpretation"), []);
    assert.deepEqual(refsOf(await search(q, { contentType: "explainer" }), "interpretation"), [], "기사 유형을 고르면 기사만");
    assert.deepEqual(refsOf(await search(q, { region: "1100000000" }), "interpretation"), []);
    assert.deepEqual(refsOf(await search(q, { from: "2026-04-15", to: "2026-04-15" }), "interpretation"), [doc.id], "결정일 당일 포함");
    assert.deepEqual(refsOf(await search(q, { from: "2026-04-16" }), "interpretation"), [], "다음 날부터면 0");
    assert.deepEqual(refsOf(await search(q, { to: "2026-04-14" }), "interpretation"), [], "전날까지면 0");
  }));

test("공개 전·권리 미확인 원문 0 — 권리 미확인·필수 칸 빈·심판 비실명 미확인·해설 초안·지정 없음·related만은 결과 0, service_role로 불러도 0", () =>
  tx(async () => {
    const tag = uniq("비공개표");
    const cases = {
      unchecked: await legalDoc({ rights_status: "unchecked", tax_kinds: [tag] }),
      restricted: await legalDoc({ rights_status: "restricted", tax_kinds: [tag] }),
      noIssuer: await legalDoc({ issuer: " ", tax_kinds: [tag] }),
      noSnapshot: await legalDoc({ snapshot_id: null, tax_kinds: [tag] }),
      noHash: await legalDoc({ content_hash: null, tax_kinds: [tag] }),
      tribunalUnchecked: await legalDoc({ doc_type: "tribunal", anonymity_check: "unchecked", tax_kinds: [tag] }),
    };
    for (const d of Object.values(cases)) {
      const a = await article();
      await explain(a.id, d.id);
    }
    const draftDoc = await legalDoc({ tax_kinds: [tag] });
    const draft = await article({ status: "draft" });
    await explain(draft.id, draftDoc.id);
    const unmarkedDoc = await legalDoc({ tax_kinds: [tag] });
    await explain((await article()).id, unmarkedDoc.id, "subject", false);
    const relatedDoc = await legalDoc({ tax_kinds: [tag] });
    await explain((await article()).id, relatedDoc.id, "related");
    const lonelyDoc = await legalDoc({ tax_kinds: [tag] });

    for (const role of ["anon", "authenticated", "service_role", null]) {
      assert.deepEqual(refsOf(await search(tag), "interpretation"), [], `${role ?? "소유자"}: 공개 전 원문 0`);
    }
    // 같은 자료에서 조건을 채우면 바로 결과 (판정이 실제로 그 조건 때문인지)
    await client.query("update public.legal_docs set anonymity_check = 'confirmed' where id = $1", [cases.tribunalUnchecked.id]);
    await client.query("update public.legal_docs set rights_status = 'confirmed' where id = $1", [cases.unchecked.id]);
    const now = refsOf(await search(tag), "interpretation").sort((x, y) => x - y);
    assert.deepEqual(now, [cases.unchecked.id, cases.tribunalUnchecked.id].sort((x, y) => x - y), "권리 확인·비실명 확인 뒤에만");
    assert.ok(!now.includes(lonelyDoc.id) && !now.includes(relatedDoc.id) && !now.includes(unmarkedDoc.id));
  }));

// ── AI 색인 불허 칼럼 ─────────────────────────────────────────

test("AI 색인 불허 칼럼 0 — 계약 deny면 기사 결과·종류 숫자 0, allow·계약 없음은 그대로, 범위를 줄이면 바로 빠지고 되돌리면 다시", () =>
  tx(async () => {
    const word = uniq("칼럼낱말").replace(/-/g, "");
    const writer = Number((await one("insert into public.people (slug, name, roles, visibility) values ($1, '시험용 필자', '{writer}', 'public') returning id", [uniq("w3sm-p")])).id);
    const contract = async (scope) =>
      Number(
        (await one("insert into public.column_contracts (person_id, doc_ref, signed_on, reuse_scope, ai_index_scope) values ($1, '시험용 계약 위치', '2026-01-01', '{online}', $2) returning id", [writer, scope])).id,
      );
    const column = async (title, scope) => {
      const a = await article({ contentType: "opinion", title });
      if (scope) {
        await client.query("insert into public.column_meta (article_id, person_id, interest_state, interest_text, contract_id) values ($1, $2, 'declared', '시험용 이해관계', $3)", [
          a.id,
          writer,
          await contract(scope),
        ]);
      }
      return a;
    };
    const denied = await column(`시험용 칼럼 ${word} 불허`, "deny");
    const allowed = await column(`시험용 칼럼 ${word} 허용`, "allow");
    const legacy = await column(`시험용 칼럼 ${word} 계약없음`, null);
    const news = await article({ contentType: "reported_news", title: `시험용 보도 ${word}` });

    const rows = await search(word);
    assert.deepEqual(refsOf(rows, "article").sort((x, y) => x - y), [allowed.id, legacy.id, news.id].sort((x, y) => x - y), "불허 칼럼만 빠진다");
    assert.equal(rows[0].kind_counts.article, 3, "탭 숫자에도 0");
    assert.deepEqual(refsOf(await search(word, { contentType: "opinion" }), "article").sort((x, y) => x - y), [allowed.id, legacy.id].sort((x, y) => x - y), "오피니언 거르개 안에서도 0");
    for (const role of ["service_role", null]) assert.ok(!refsOf(await search(word, {}, role), "article").includes(denied.id), `${role ?? "소유자"}로 불러도 0`);

    // 범위를 줄이면 다음 검색부터 빠지고(색인 갱신 = 바로), 되돌리면 다시 찾힌다 (TX-17)
    const allowedContract = (await one("select contract_id from public.column_meta where article_id = $1", [allowed.id])).contract_id;
    await client.query("update public.column_contracts set ai_index_scope = 'deny' where id = $1", [allowedContract]);
    assert.ok(!refsOf(await search(word), "article").includes(allowed.id), "deny로 바꾸면 바로 0");
    await client.query("update public.column_contracts set ai_index_scope = 'allow' where id = $1", [allowedContract]);
    assert.ok(refsOf(await search(word), "article").includes(allowed.id), "allow로 되돌리면 다시 결과");
  }));

// ── 기존 종류 그대로 ─────────────────────────────────────────

test("기존 종류 그대로 — 트래커는 '개편안'으로 찾히고, 해석 해설 기사 자체는 기사 결과(해설)로 그대로 남는다", () =>
  tx(async () => {
    const slug = uniq("w3sm-tracker");
    const m = Number(
      (await one("insert into public.amendments (slug, title, summary, law_names, status) values ($1, $2, '시험용 요약', '{시험법}', 'public') returning id", [slug, `시험용 「2026년 지방세제 개편안」 ${slug}`])).id,
    );
    assert.ok(refsOf(await search(`개편안 ${slug}`), "tracker").includes(m), "개편안 → 트래커");
    const doc = await legalDoc();
    const a = await article({ title: `시험용 해설 ${doc.doc_no}` });
    await explain(a.id, doc.id);
    const rows = await search(doc.doc_no);
    assert.deepEqual(refsOf(rows, "article"), [a.id], "제목에 번호가 있는 해설 기사는 기사 결과 그대로");
    assert.deepEqual(refsOf(rows, "interpretation"), [doc.id], "원문은 따로 해석 원문 결과");
    assert.equal(rows.find((r) => r.kind === "article").content_type, "explainer");
  }));

// ── 측정 ───────────────────────────────────────────────────

test("측정 — calculator_card_clicked 카드 키 목록(W2-c 2.3) = official_links 시드 키(같은 차례), 새 이벤트 3개는 저장되고 이벤트 속성에 주소·입력값 칸은 DB도 거부", () =>
  tx(async () => {
    const keys = (await client.query("select key from public.official_links order by sort, id")).rows.map((r) => r.key);
    assert.deepEqual(designValues("calculator_card_clicked.card"), keys, "카드 키 = 바깥 연결 시드 키");
    const insert = (name, props) =>
      client.query(
        "insert into public.analytics_events (name, session_id, first_visit, stage, entry, section, props, is_bot, is_staff) values ($1, gen_random_uuid(), true, 1, 'direct', $2, $3, false, false) returning id",
        [name, name === "calculator_card_clicked" ? null : "tax", JSON.stringify(props)],
      );
    await insert("calculator_card_clicked", { card: "acquisition", screen: "calc", rank: 1 });
    await insert("amendment_viewed", { amendment_id: 1, stage: "pre_notice" });
    await insert("interpretation_viewed", { article_id: 1, doc_type: "ruling" });
    for (const bad of [{ card: "acquisition", url: "https://sm.example" }, { card: "acquisition", input: "MARKER" }, { card: "acquisition", q: "MARKER" }]) {
      await client.query("savepoint e");
      await assert.rejects(insert("calculator_card_clicked", bad), (err) => err.code === "23514", JSON.stringify(bad));
      await client.query("rollback to savepoint e");
    }
  }));
