// W2-d 통합 검색 — docs/dev/W2-d_설계.md 3~7장 (PRD-01A SRCH-01·SRCH-02, PRD-01B REG-08·REG1-11, PRD-01C CHAT-03)
//  · 띄어쓰기 변형: "취득세"·"취득 세", "재건축"·"재 건축"이 같은 결과 (문서 쪽 띄어쓰기도 흡수)
//  · 구어 검색: "차 팔았" → '차를 팔았어요·폐차했어요' 상황 (다시 찾기 · 검색 별칭 · 동의어 사전), "개편안" → 「2026년 지방세제 개편안」 트래커
//  · 비공개 0: 초안·보류·예약·삭제·권리 미확인 대표 이미지·유료·금주 핫뉴스 기사, 숨긴 상황, 공개 전 트래커, 비공개 인물·전문가만인 인물,
//    숨긴·기사 없는·지자체뉴스 하위 분야, 폐지·시작 전 지역, 취재 근거·운영 설정의 글 — anon·authenticated·service_role·소유자 모두
//  · 거르개(기사 유형·분야·지역·기간·종류) · 순위 등급 · 쪽 · 권한(anon 실행은 health_ping·search_public뿐, 도우미 함수 0) · 동의어 사전 공개 범위
// 모두 한 트랜잭션 안에서 넣고 되돌린다. 로컬 DB에서만 돈다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";
import { ANON_EXECUTE_ALLOWED } from "../scripts/verify-rls-remote.mjs";

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
/** search_public — 이름 붙인 인자, 역할(null = 소유자 postgres) */
async function search(query, args = {}, role = "anon") {
  const names = Object.keys(args);
  const sql = `select * from public.search_public(p_query => $1${names.map((n, i) => `, ${n} => $${i + 2}`).join("")})`;
  const r = await attempt(sql, [query, ...names.map((n) => args[n])], role);
  assert.ok(r.ok, `search_public(${query}, ${JSON.stringify(args)}) 실패: ${r.message}`);
  return r.rows;
}
const keys = (rows) => rows.map((r) => `${r.kind}:${r.ref}`).sort();

let seq = 0;
const uniq = (p) => `${p}-${process.pid}-${++seq}`;
async function insert(table, cols) {
  const k = Object.keys(cols);
  const sql = `insert into public.${table} (${k.join(", ")}) values (${k.map((_, i) => `$${i + 1}`).join(", ")}) returning *`;
  return (await client.query(sql, k.map((x) => cols[x]))).rows[0];
}
const para = (...texts) => JSON.stringify({ blocks: texts.map((text) => ({ type: "paragraph", text })), claims: [] });
const CHECKS = JSON.stringify([{ title: "하나" }, { title: "둘" }, { title: "셋" }]);

/** 시험마다 쓰는 사람·도우미 */
async function fixture() {
  const reporter = await insert("people", { slug: uniq("p"), name: "검색 시험 기자", roles: ["reporter"], visibility: "public" });
  const reviewer = await insert("people", { slug: uniq("p"), name: "검색 시험 감수", roles: ["reviewer"] });
  const article = (over) =>
    insert("articles", { slug: uniq("a"), title: "검색 시험 기사", section: "tax", content_type: "explainer", status: "published", author_id: reporter.id, body: para("본문"), ...over });
  const situation = (over) =>
    insert("situations", { slug: uniq("s"), section: "tax", title: "검색 시험 상황", pictogram: "car-sold", checks: CHECKS, visible: true, reviewer_id: reviewer.id, reviewed_at: new Date(), ...over });
  const amendment = (over) => insert("amendments", { slug: uniq("am"), title: "검색 시험 개정안", status: "public", ...over });
  // 용어는 공개(visible) — 숨긴 용어는 w2d-glossary 시험이 본다 (3단계)
  const term = (over) => insert("glossary_terms", { term: uniq("용어"), visible: true, ...over });
  let code = 0;
  const sigungu = (over) => insert("regions", { code: `11${String(800 + ++code).padStart(3, "0")}00000`, parent_code: "1100000000", level: "sigungu", slug: uniq("gu"), name: "검색시험구", ...over });
  return { reporter, reviewer, article, situation, amendment, term, sigungu };
}

// ── 띄어쓰기 변형 ─────────────────────────────────────────────

test("'취득세'와 '취득 세'는 같은 결과 — 제목·본문·문서 쪽 띄어쓰기('취득 세 신고')는 찾고, '취득 시 세율'은 찾지 않는다 (SRCH-01)", () =>
  tx(async () => {
    const f = await fixture();
    const title = await f.article({ title: "취득세 감면 안내" });
    const body = await f.article({ title: "부동산 거래 안내", body: para("올해 취득세 중과 기준이 바뀐다") });
    const spacedDoc = await f.article({ title: "신고 기한", body: para("주택을 사면 취득 세 신고를 60일 안에") });
    const notIt = await f.article({ title: "취득 시 세율 비교" });
    const a = await search("취득세");
    const b = await search("취득 세");
    assert.deepEqual(keys(a), keys(b), "두 검색어의 결과가 같다");
    const refs = a.map((r) => r.ref);
    for (const x of [title, body, spacedDoc]) assert.ok(refs.includes(String(x.id)), `${x.title} 결과에 있음`);
    assert.ok(!refs.includes(String(notIt.id)), "'취득 시 세율'은 취득세가 아니다");
    assert.deepEqual(b[0].query_terms, ["취득세"]);
  }));

test("'재건축'과 '재 건축'은 같은 결과 — 상황·용어·기사 모두 (SRCH-01)", () =>
  tx(async () => {
    const f = await fixture();
    const art = await f.article({ title: "재 건축 조합원 입주권", section: "realestate" });
    const sit = await f.situation({ section: "realestate", title: "재건축·재개발 조합원이에요" });
    const gl = await f.term({ term: "재건축", plain: "낡은 집을 허물고 새로 짓는 일" });
    const other = await f.article({ title: "재산세 건축물 과세표준" });
    const a = await search("재건축");
    const b = await search("재 건축");
    assert.deepEqual(keys(a), keys(b));
    const got = keys(a);
    for (const k of [`article:${art.id}`, `situation:${sit.id}`, `glossary:${gl.id}`]) assert.ok(got.includes(k), k);
    assert.ok(!got.includes(`article:${other.id}`), "'재산세 건축물'은 재건축이 아니다");
  }));

// ── 구어 검색 ─────────────────────────────────────────────────

test("'차 팔았' → '차를 팔았어요·폐차했어요' 상황 — 별칭이 없으면 다시 찾기('차' 그리고 '팔았'), 별칭이 있으면 붙인 낱말로 이름 등급", () =>
  tx(async () => {
    const f = await fixture();
    const sit = await f.situation({ title: "차를 팔았어요·폐차했어요" });
    const plain = await search("차 팔았");
    assert.deepEqual(keys(plain), [`situation:${sit.id}`]);
    assert.deepEqual(plain[0].query_terms, ["차", "팔았"], "붙인 낱말 '차팔았'은 0건이라 띄어 쓴 대로 다시 찾았다");
    assert.equal(plain[0].tier, 1, "두 낱말 모두 제목에 있다");

    await client.query("update public.situations set aliases = $2 where id = $1", [sit.id, ["차 팔았어요", "폐차"]]);
    const alias = await search("차 팔았");
    assert.deepEqual(keys(alias), [`situation:${sit.id}`]);
    assert.deepEqual(alias[0].query_terms, ["차팔았"], "별칭 '차팔았어요' 안에서 붙인 낱말이 바로 찾힌다");
    assert.equal(alias[0].tier, 1);
    const exact = await search("폐차");
    assert.equal(exact.find((r) => r.ref === String(sit.id))?.tier, 0, "별칭과 검색어 전체가 같으면 이름 같음 등급");
  }));

test("동의어 사전 — '자동차매도'를 찾으면 동의어 '차를 팔았'도 함께 찾는다. 사용 중이 아니면 0, anon은 사용 중인 줄의 열쇠 칸만 읽는다", () =>
  tx(async () => {
    const f = await fixture();
    const sit = await f.situation({ title: "차를 팔았어요·폐차했어요" });
    assert.deepEqual(await search("자동차매도"), []);
    const syn = await insert("search_synonyms", { term: "자동차 매도", synonyms: ["차를 팔았", "중고차 처분"], updated_by: "user:시험", note: "편집국 메모" });
    assert.equal(syn.term_key, "자동차매도");
    assert.deepEqual(syn.synonym_keys, ["차를팔았", "중고차처분"]);
    const hit = await search("자동차매도");
    assert.deepEqual(keys(hit), [`situation:${sit.id}`]);
    assert.equal(hit[0].tier, 1, "동의어가 이름(제목) 안에 있다");
    // 열쇠는 정규형 — 띄어쓰기만 다른 낱말을 두 번 넣을 수 없다, 정규형이 빈 낱말·겹친 동의어 거부
    assert.equal((await attempt("insert into public.search_synonyms (term, synonyms, updated_by) values ('자동차매도', '{팔았어}', 'user:시험')")).code, "23505");
    assert.equal((await attempt("insert into public.search_synonyms (term, synonyms, updated_by) values ('?!', '{팔았어}', 'user:시험')")).code, "23514");
    assert.equal((await attempt("insert into public.search_synonyms (term, synonyms, updated_by) values ('폐차하기', '{차 팔기, 차팔기}', 'user:시험')")).code, "23514");
    // anon — 열쇠 칸만, 메모·고친 사람은 권한 거부, 쓰기 거부
    const read = await attempt("select term_key, synonym_keys from public.search_synonyms where term_key = $1", ["자동차매도"], "anon");
    assert.deepEqual(read.rows, [{ term_key: "자동차매도", synonym_keys: ["차를팔았", "중고차처분"] }]);
    for (const sql of ["select note from public.search_synonyms", "select updated_by from public.search_synonyms", "select term from public.search_synonyms"]) {
      assert.equal((await attempt(sql, [], "anon")).code, "42501", sql);
    }
    assert.equal((await attempt("insert into public.search_synonyms (term, synonyms, updated_by) values ('x', '{y}', 'anon')", [], "anon")).code, "42501");
    await client.query("update public.search_synonyms set enabled = false where id = $1", [syn.id]);
    assert.deepEqual(await search("자동차매도"), [], "사용 중이 아닌 동의어는 쓰지 않는다");
    assert.deepEqual((await attempt("select term_key from public.search_synonyms where term_key = $1", ["자동차매도"], "anon")).rows, []);
  }));

test("'개편안' → 공개 트래커 「2026년 지방세제 개편안」(현재 단계·원문), 공개 전·숨긴 트래커는 0 (SRCH-01 견본)", () =>
  tx(async () => {
    const f = await fixture();
    const pub = await f.amendment({ title: "2026년 지방세제 개편안", summary: "정부 개편안 발표" });
    const draft = await f.amendment({ title: "2027년 지방세제 개편안 초안", status: "draft" });
    const hidden = await f.amendment({ title: "옛 개편안", status: "hidden" });
    const snap = await insert("raw_snapshots", { source: "mois", url: "https://www.mois.go.kr/x", content_hash: "h", payload: "원문" });
    await insert("amendment_events", { amendment_id: pub.id, stage: "announced", occurred_on: "2026-08-01", source_url: "https://www.mois.go.kr/x", snapshot_id: snap.id, recorded_by: "user:시험" });
    const rows = await search("개편안");
    assert.deepEqual(keys(rows), [`tracker:${pub.id}`]);
    const t = rows[0];
    assert.equal(t.title, "2026년 지방세제 개편안");
    assert.equal(t.section, "tax");
    assert.deepEqual(t.meta, { stage: "announced", stage_on: "2026-08-01", source_url: "https://www.mois.go.kr/x" });
    assert.equal(t.snippet, "정부 개편안 발표");
    assert.ok(!keys(rows).includes(`tracker:${draft.id}`) && !keys(rows).includes(`tracker:${hidden.id}`));
  }));

// ── 비공개 0 ──────────────────────────────────────────────────

test("비공개 행은 결과 0 — anon·authenticated·service_role·소유자 모두 공개 행만 (RLS + 함수 안 같은 조건)", () =>
  tx(async () => {
    const f = await fixture();
    const M = "검색경계표식";
    const pub = {};
    const priv = [];
    pub.article = await f.article({ title: `${M} 공개 기사` });
    for (const status of ["draft", "in_review", "approved", "held", "deleted"]) priv.push(`article:${(await f.article({ title: `${M} ${status}`, status })).id}`);
    priv.push(`article:${(await f.article({ title: `${M} 예약`, status: "scheduled", publish_at: new Date(Date.now() + 86_400_000) })).id}`);
    const unconfirmed = await insert("media", { path: "u.jpg", kind: "photo" });
    priv.push(`article:${(await f.article({ title: `${M} 권리 미확인 이미지`, lead_media_id: unconfirmed.id })).id}`);
    priv.push(`article:${(await f.article({ title: `${M} 유료`, is_paid: true })).id}`);
    const digest = await f.article({ title: `${M} 금주 핫뉴스`, section: "local", content_type: "digest", digest_id: 1, region_codes: ["1100000000"], editorial_field: "local_tax", public_question: "시험용 공익적 질문" });
    priv.push(`article:${digest.id}`);
    // 취재 근거·운영 설정의 글은 검색 대상이 아니다
    await insert("article_evidence", { article_id: pub.article.id, article_version: 1, evidence_type: "document", location: `${M} 근거 보관함`, rights_status: "confirmed" });
    await insert("settings", { key: `zz_search_${process.pid}`, value: JSON.stringify([`${M} 설정`]) });

    pub.situation = await f.situation({ title: `${M} 상황` });
    priv.push(`situation:${(await f.situation({ title: `${M} 숨긴 상황`, visible: false })).id}`);
    pub.tracker = await f.amendment({ title: `${M} 개정안` });
    priv.push(`tracker:${(await f.amendment({ title: `${M} 초안 개정안`, status: "draft" })).id}`);
    priv.push(`tracker:${(await f.amendment({ title: `${M} 숨긴 개정안`, status: "hidden" })).id}`);
    pub.person = await insert("people", { slug: uniq("p"), name: `${M} 기자`, roles: ["reporter"], visibility: "public" });
    priv.push(`person:${(await insert("people", { slug: uniq("p"), name: `${M} 비공개`, roles: ["reporter"], visibility: "hidden" })).id}`);
    priv.push(`person:${(await insert("people", { slug: uniq("p"), name: `${M} 전문가`, roles: ["expert"], visibility: "public" })).id}`);
    const cat = await insert("categories", { section: "tax", slug: uniq("c").replace(/[^a-z0-9-]/g, ""), name: `${M} 분야`, visible: true });
    await f.article({ title: "분야 기사", category_id: cat.id });
    pub.category = cat;
    const hiddenCat = await insert("categories", { section: "tax", slug: uniq("hc").replace(/[^a-z0-9-]/g, ""), name: `${M} 숨긴 분야`, visible: false });
    await f.article({ title: "숨긴 분야 기사", category_id: hiddenCat.id });
    priv.push(`category:${hiddenCat.id}`);
    priv.push(`category:${(await insert("categories", { section: "tax", slug: uniq("ec").replace(/[^a-z0-9-]/g, ""), name: `${M} 빈 분야`, visible: true })).id}`);
    const localCat = await insert("categories", { section: "local", slug: uniq("lc").replace(/[^a-z0-9-]/g, ""), name: `${M} 지자체 분야`, visible: true });
    await f.article({ title: "지자체 기사", section: "local", category_id: localCat.id, region_codes: ["1100000000"], editorial_field: "local_tax", public_question: "시험용 공익적 질문" });
    priv.push(`category:${localCat.id}`);
    pub.glossary = await f.term({ term: `${M} 용어` });
    pub.region = await f.sigungu({ name: `${M}구` });
    priv.push(`region:${(await f.sigungu({ name: `${M}옛구`, valid_to: "2020-12-31" })).code}`);
    priv.push(`region:${(await f.sigungu({ name: `${M}새구`, valid_from: "2099-01-01" })).code}`);

    const expected = [
      `article:${pub.article.id}`,
      `situation:${pub.situation.id}`,
      `tracker:${pub.tracker.id}`,
      `person:${pub.person.id}`,
      `category:${pub.category.id}`,
      `glossary:${pub.glossary.id}`,
      `region:${pub.region.code}`,
    ].sort();
    for (const role of ["anon", "authenticated", "service_role", null]) {
      const got = keys(await search(M, { p_limit: 50 }, role));
      assert.deepEqual(got, expected, `${role ?? "소유자"}: 공개 행만`);
      for (const p of priv) assert.ok(!got.includes(p), `${role ?? "소유자"}: ${p} 0`);
    }
    assert.deepEqual(await search(`${M} 근거 보관함`), [], "취재 근거 글 0");
    assert.deepEqual(await search(`${M} 설정`), [], "운영 설정 글 0");
    // anon이 표를 직접 읽어도 초안·보류·유료 기사의 찾는 글은 0행 (칸 권한 + RLS) — 읽히는 것은 발행 기사(금주 핫뉴스는 발행 기사지만 검색 결과에서 뺀다)
    const direct = await attempt("select search_text from public.articles where title like $1", [`${M}%`], "anon");
    assert.deepEqual(direct.rows.map((r) => r.search_text).sort(), [pub.article.search_text, digest.search_text].sort());
  }));

// ── 찾는 글 ───────────────────────────────────────────────────

test("기사 찾는 글 — 블록마다 글 칸만(표·FAQ·카드뉴스·인용 발언자·인포그래픽 같은 내용), 블록 종류·주소·media 번호·핵심 주장·링크 주소 0", () =>
  tx(async () => {
    const f = await fixture();
    const body = {
      blocks: [
        { type: "paragraph", text: "[계산기 안내](/calc/acquisition) 문단글" },
        { type: "table", caption: "표제목", rows: [["칸하나", "칸둘"]], chart: { axis: "축", unit: "원", source: "통계청" } },
        { type: "image", mediaId: "987654", alt: "사진설명", caption: "사진캡션" },
        { type: "quote", text: "인용글", speaker: "발언자", origin: "interview", refId: "ev:123" },
        { type: "callout", kind: "tip", title: "상자제목", text: "상자글" },
        { type: "infographic", mediaId: "55", alt: "그림설명", caption: "", template: "compare", chart: null, data: { kind: "table", columns: ["머리칸"], rows: [["자료칸"]] } },
        { type: "video", embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", caption: "영상", summary: "영상요약", captions: true, thumbnailMediaId: "9", durationSeconds: 60 },
        { type: "faq", items: [{ question: "질문글", answer: "답변글" }] },
        { type: "key_summary", lines: ["요약줄"] },
        { type: "slide", title: "장제목", text: "장글", alt: "장설명" },
      ],
      claims: [{ text: "핵심주장비공개", evidenceIds: ["ev:1"] }],
    };
    const a = await f.article({ title: "블록 시험", summary: "요약칸", body: JSON.stringify(body) });
    const text = a.search_text;
    for (const w of ["블록시험", "요약칸", "계산기안내문단글", "표제목", "칸하나", "통계청", "사진설명", "사진캡션", "인용글", "발언자", "상자제목", "그림설명", "머리칸", "자료칸", "영상요약", "질문글", "답변글", "요약줄", "장제목", "장글", "장설명"]) {
      assert.ok(text.includes(w), `찾는 글에 '${w}'`);
    }
    for (const w of ["calc", "acquisition", "paragraph", "infographic", "987654", "youtube", "ev123", "interview", "compare", "tip", "핵심주장", "table"]) {
      assert.ok(!text.includes(w), `찾는 글에 '${w}' 0`);
    }
    assert.deepEqual(a.search_names, ["블록시험"]);
    assert.deepEqual(await search("핵심주장비공개"), []);
    assert.deepEqual(await search("acquisition"), [], "링크 주소는 검색 낱말이 아니다");
    // 생성 칸 — 직접 쓸 수 없다
    assert.equal((await attempt("update public.articles set search_text = 'x' where id = $1", [a.id])).code, "428C9");
  }));

test("요약 없는 기사의 snippet은 첫 문단(링크는 글만, 160자) · 유형 없는 이관 기사도 찾고 유형 거르개를 고르면 0", () =>
  tx(async () => {
    const f = await fixture();
    const long = `[이관 안내](/old/path) ${"가".repeat(200)}`;
    const legacy = await f.article({ title: "이관표식 옛 기사", content_type: null, origin: "legacy", body: para(long, "둘째 문단") });
    const [row] = await search("이관표식");
    assert.equal(row.ref, String(legacy.id));
    assert.equal(row.content_type, null);
    assert.equal(row.snippet, `이관 안내 ${"가".repeat(200)}`.slice(0, 160));
    assert.deepEqual(row.meta, { format: "general", label: "none", partner_badge_name: null, category_id: null, region_codes: [], subtype: "general" });
    assert.deepEqual(await search("이관표식", { p_content_type: "explainer" }), []);
  }));

// ── 거르개 ────────────────────────────────────────────────────

test("기사 유형 거르개 — reported_news만 고르면 다른 유형·다른 종류 0, 종류별 수도 기사만 (SRCH-02)", () =>
  tx(async () => {
    const f = await fixture();
    const M = "유형표식";
    const reported = await f.article({ title: `${M} 보도`, content_type: "reported_news", reporting_method: "qualitative" });
    await f.article({ title: `${M} 해설` });
    // 칼럼 발행은 필자의 활성 이름·초상 동의서가 필요하다 (W3 7단계) — 시험용 동의서
    await client.query("insert into public.name_likeness_consents (person_id, version, scope, doc_ref, recorded_by) values ($1, '시험용', array['column'], '시험용 위치', 'admin:test')", [f.reporter.id]);
    await f.article({ title: `${M} 칼럼`, content_type: "opinion" });
    await f.situation({ title: `${M} 상황` });
    await f.term({ term: `${M} 용어` });
    const all = await search(M);
    assert.equal(all.length, 5);
    const rows = await search(M, { p_content_type: "reported_news" });
    assert.deepEqual(keys(rows), [`article:${reported.id}`]);
    for (const r of rows) {
      assert.equal(r.kind, "article");
      assert.equal(r.content_type, "reported_news");
    }
    assert.deepEqual(rows[0].kind_counts, { article: 1 });
  }));

test("분야 거르개 — 그 분야 기사·상황, 트래커는 지방세, 용어는 용어 분야, 지역은 지자체뉴스, 인물은 0", () =>
  tx(async () => {
    const f = await fixture();
    const M = "분야표식";
    const taxArt = await f.article({ title: `${M} 지방세`, section: "tax" });
    const reArt = await f.article({ title: `${M} 부동산`, section: "realestate" });
    const tracker = await f.amendment({ title: `${M} 개정안` });
    const taxTerm = await f.term({ term: `${M} 세금 용어`, section: ["tax"] });
    const finTerm = await f.term({ term: `${M} 금융 용어`, section: ["finance"] });
    const region = await f.sigungu({ name: `${M}구` });
    await insert("people", { slug: uniq("p"), name: `${M} 기자`, roles: ["reporter"], visibility: "public" });
    assert.deepEqual(keys(await search(M, { p_section: "tax" })), [`article:${taxArt.id}`, `glossary:${taxTerm.id}`, `tracker:${tracker.id}`].sort());
    assert.deepEqual(keys(await search(M, { p_section: "realestate" })), [`article:${reArt.id}`]);
    assert.deepEqual(keys(await search(M, { p_section: "local" })), [`region:${region.code}`]);
    assert.deepEqual(keys(await search(M, { p_section: "finance" })), [`glossary:${finTerm.id}`]);
  }));

test("지역 거르개 — 시·도를 고르면 그 아래 시·군·구 태그 기사까지, 시·군·구는 그곳만, 다른 종류는 지역 결과만 (REG1-11)", () =>
  tx(async () => {
    const f = await fixture();
    const M = "지역표식";
    const gu = await f.sigungu({ name: `${M}동구` });
    const sibling = await f.sigungu({ name: `${M}서구` });
    const inGu = await f.article({ title: `${M} 동구 기사`, section: "local", region_codes: [gu.code], editorial_field: "local_tax", public_question: "시험용 공익적 질문" });
    const inSido = await f.article({ title: `${M} 서울 기사`, section: "local", region_codes: ["1100000000"], editorial_field: "local_tax", public_question: "시험용 공익적 질문" });
    const busan = await f.article({ title: `${M} 부산 기사`, section: "local", region_codes: ["2600000000"], editorial_field: "local_tax", public_question: "시험용 공익적 질문" });
    await f.situation({ title: `${M} 상황` });
    assert.deepEqual(keys(await search(M, { p_region: "1100000000" })), [`article:${inGu.id}`, `article:${inSido.id}`, `region:${gu.code}`, `region:${sibling.code}`].sort());
    assert.deepEqual(keys(await search(M, { p_region: gu.code })), [`article:${inGu.id}`, `region:${gu.code}`].sort());
    assert.deepEqual(keys(await search(M, { p_region: "2600000000" })), [`article:${busan.id}`]);
    for (const bad of ["11000", "abcdefghij"]) {
      const r = await attempt("select * from public.search_public(p_query => $1, p_region => $2)", [M, bad], "anon");
      assert.equal(r.code, "22023", bad);
    }
  }));

test("기간 거르개 — 한국 날짜로 그날 포함 (UTC 15:30 = 다음 날 0:30), 날짜 없는 종류 0, 트래커는 현재 단계 날짜", () =>
  tx(async () => {
    const f = await fixture();
    const M = "기간표식";
    const art = await f.article({ title: `${M} 기사`, first_published_at: "2026-10-01T15:30:00Z" });
    await f.term({ term: `${M} 용어` });
    const tr = await f.amendment({ title: `${M} 개정안` });
    const snap = await insert("raw_snapshots", { source: "mois", url: "https://www.mois.go.kr/y", content_hash: "h", payload: "원문" });
    await insert("amendment_events", { amendment_id: tr.id, stage: "announced", occurred_on: "2026-10-02", source_url: "https://www.mois.go.kr/y", snapshot_id: snap.id, recorded_by: "user:시험" });
    const at = (from, to) => search(M, { p_from: from, p_to: to }).then(keys);
    assert.deepEqual(await at("2026-10-02", "2026-10-02"), [`article:${art.id}`, `tracker:${tr.id}`].sort());
    assert.deepEqual(await at(null, "2026-10-01"), [], "한국 날짜 10월 1일까지 — 10월 2일 0:30 기사 0");
    assert.deepEqual(await at("2026-10-03", null), []);
    assert.equal((await search(M)).length, 3, "기간이 없으면 용어도");
    const r = await attempt("select * from public.search_public(p_query => $1, p_from => '2026-10-02', p_to => '2026-10-01')", [M], "anon");
    assert.equal(r.code, "22023");
  }));

test("종류 거르개 — 고른 종류만 돌려주고, 종류별 수(탭 숫자)는 나머지 거르개 안의 모든 종류", () =>
  tx(async () => {
    const f = await fixture();
    const M = "종류표식";
    await f.article({ title: `${M} 기사 1` });
    await f.article({ title: `${M} 기사 2` });
    const gl = await f.term({ term: `${M} 용어` });
    const rows = await search(M, { p_kinds: ["glossary"] });
    assert.deepEqual(keys(rows), [`glossary:${gl.id}`]);
    assert.equal(Number(rows[0].total_count), 1);
    assert.deepEqual(rows[0].kind_counts, { article: 2, glossary: 1 });
  }));

// ── 순위·쪽 ───────────────────────────────────────────────────

test("순위 — 이름 같음(지역명만 쓴 검색어는 그 지역 먼저) → 이름에 있음 → 본문, 같은 등급은 최신 기사 먼저 (REG-08)", () =>
  tx(async () => {
    const f = await fixture();
    const gu = await f.sigungu({ name: "순위시험구" });
    const older = await f.article({ title: "순위시험구 재개발 소식", first_published_at: "2026-09-01T00:00:00Z" });
    const newer = await f.article({ title: "순위시험구 예산", first_published_at: "2026-10-01T00:00:00Z" });
    const bodyOnly = await f.article({ title: "지자체 소식", body: para("순위시험구 주민 설명회"), first_published_at: "2026-10-10T00:00:00Z" });
    const rows = await search("순위시험구");
    assert.deepEqual(rows.map((r) => `${r.kind}:${r.ref}:${r.tier}`), [`region:${gu.code}:0`, `article:${newer.id}:1`, `article:${older.id}:1`, `article:${bodyOnly.id}:2`]);
    assert.equal(rows[0].section, "local");
    assert.deepEqual(rows[0].meta, { level: "sigungu", parent_code: "1100000000", parent_slug: "seoul", parent_name: "서울특별시" });
    assert.equal(rows[0].snippet, "서울특별시");
    const term = await f.term({ term: "순위시험용어", plain: "쉬운 풀이" });
    const titled = await f.article({ title: "순위시험용어 바뀐다" });
    const [first, second] = await search("순위시험용어");
    assert.deepEqual([`${first.kind}:${first.ref}`, `${second.kind}:${second.ref}`], [`glossary:${term.id}`, `article:${titled.id}`], "용어 이름 같음이 기사 제목보다 먼저");
    assert.equal(first.snippet, "쉬운 풀이");
  }));

test("종류별 묶음 — 종류마다 앞 n개, 종류 순서(지역·상황·트래커·용어·분야·기사·인물)대로", () =>
  tx(async () => {
    const f = await fixture();
    const M = "묶음표식";
    for (let i = 0; i < 3; i++) await f.article({ title: `${M} 기사 ${i}` });
    await f.situation({ title: `${M} 상황` });
    await f.term({ term: `${M} 용어` });
    await f.amendment({ title: `${M} 개정안` });
    await f.sigungu({ name: `${M}구` });
    await insert("people", { slug: uniq("p"), name: `${M} 기자`, roles: ["writer"], visibility: "public" });
    const rows = await search(M, { p_per_kind: 2 });
    assert.deepEqual(rows.map((r) => r.kind), ["region", "situation", "tracker", "glossary", "article", "article", "person"]);
    assert.equal(Number(rows[0].total_count), 8);
    assert.deepEqual(rows[0].kind_counts, { region: 1, situation: 1, tracker: 1, glossary: 1, article: 3, person: 1 });
  }));

test("쪽 나눔 — 건너뛰기마다 겹침 없이 전체를 돌고, 전체 수는 그대로, 끝을 넘으면 0행", () =>
  tx(async () => {
    const f = await fixture();
    for (let i = 0; i < 25; i++) await f.term({ term: `쪽시험 ${String(i).padStart(2, "0")}` });
    const pages = [];
    for (const offset of [0, 10, 20]) pages.push(await search("쪽시험", { p_limit: 10, p_offset: offset }));
    assert.deepEqual(pages.map((p) => p.length), [10, 10, 5]);
    for (const p of pages) assert.ok(p.every((r) => Number(r.total_count) === 25));
    const all = pages.flat().map((r) => r.ref);
    assert.equal(new Set(all).size, 25);
    assert.deepEqual(pages.flat().map((r) => r.title), [...pages.flat().map((r) => r.title)].sort(), "같은 등급의 용어는 이름 차례");
    assert.deepEqual(await search("쪽시험", { p_limit: 10, p_offset: 25 }), []);
  }));

test("검색어가 비거나 남는 글자가 없으면 0행 (오류 아님)", () =>
  tx(async () => {
    const f = await fixture();
    await f.term({ term: "아무 용어" });
    for (const q of ["", "   ", "?!·…", null]) assert.deepEqual(await search(q), [], JSON.stringify(q));
  }));

// ── 권한·색인 ─────────────────────────────────────────────────

test("권한 — anon이 실행할 수 있는 public 함수는 health_ping·search_public뿐, 정규화 도우미는 anon·authenticated 실행 0, 검색 함수는 invoker", async () => {
  const { rows } = await client.query(
    "select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE') order by 1",
  );
  assert.deepEqual(rows.map((r) => r.name), [...ANON_EXECUTE_ALLOWED].sort());
  assert.ok(ANON_EXECUTE_ALLOWED.has("search_public"));
  for (const fn of ["search_squash(text)", "search_keys(text[])", "search_doc(text[])", "jsonb_strings(jsonb)", "article_search_parts(jsonb)", "text_items_short(text[], integer)"]) {
    const r = await client.query(
      `select has_function_privilege('anon', 'public.${fn}', 'EXECUTE') a, has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') b, has_function_privilege('service_role', 'public.${fn}', 'EXECUTE') s`,
    );
    assert.deepEqual(r.rows[0], { a: false, b: false, s: true }, fn);
  }
  const def = await client.query("select p.prosecdef, p.proconfig, p.provolatile from pg_proc p where p.oid = 'public.search_public(text, text[], text, text, text, date, date, integer, integer, integer)'::regprocedure");
  assert.equal(def.rows[0].prosecdef, false, "security invoker");
  assert.deepEqual(def.rows[0].proconfig, ["search_path=extensions, pg_temp"]);
  assert.equal(def.rows[0].provolatile, "s");
});

test("PGroonga — extensions 스키마에 있고, 표 8개(W3 10단계 해석 원문 legal_docs 포함)의 찾는 글 칸에 2글자 조각·NFKC 색인", async () => {
  const ext = await client.query("select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pgroonga'");
  assert.deepEqual(ext.rows, [{ nspname: "extensions" }]);
  const { rows } = await client.query(
    "select c.relname as idx, t.relname as tbl, pg_get_indexdef(c.oid) as def from pg_index i join pg_class c on c.oid = i.indexrelid join pg_class t on t.oid = i.indrelid join pg_am am on am.oid = c.relam where am.amname = 'pgroonga' order by 2",
  );
  assert.deepEqual(rows.map((r) => r.tbl), ["amendments", "articles", "categories", "glossary_terms", "legal_docs", "people", "regions", "situations"]);
  for (const r of rows) {
    assert.match(r.def, /\(search_text\)/, r.idx);
    assert.match(r.def, /tokenizer='TokenBigramSplitSymbolAlphaDigit'/, r.idx);
    assert.match(r.def, /normalizers='NormalizerNFKC150'/, r.idx);
    assert.equal(r.idx, `${r.tbl}_search_idx`);
  }
});

test("작은 표를 순서대로 읽어도(색인 안 씀) 같은 규칙 — 칸 경계를 넘지 않는다", () =>
  tx(async () => {
    const f = await fixture();
    const split = await f.term({ term: "경계용어", related: ["가나", "다라"] });
    const joined = await f.term({ term: "붙은용어", definition: "가나다라" });
    for (const plan of ["set local enable_indexscan = on", "set local enable_indexscan = off"]) {
      await client.query(plan);
      await client.query(plan.replace("indexscan", "bitmapscan"));
      const rows = await search("나다");
      assert.deepEqual(keys(rows), [`glossary:${joined.id}`], `${plan}: '나다'는 한 칸 안의 '가나다라'에만`);
      assert.ok(!keys(rows).includes(`glossary:${split.id}`));
    }
  }));

test("한글 자모 — NFKC가 호환 자모(ㄱ)를 첫소리 글자(ᄀ)로 바꿔도 지우지 않는다 (찾는 글과 검색어가 같은 규칙)", () =>
  tx(async () => {
    const { rows } = await client.query("select public.search_squash('ㄱㄴ 一二') as s");
    assert.equal(rows[0].s, "ᄀᄂ一二");
    const f = await fixture();
    const gl = await f.term({ term: "자모시험", definition: "ㅊㄷㅅ 검색" });
    assert.deepEqual(keys(await search("ㅊㄷㅅ")), [`glossary:${gl.id}`]);
  }));
