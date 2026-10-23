// W5 DB — 개발금융 (docs/dev/W5_설계.md 1장 1·2단계 · 2장, 마이그레이션 20261024000060 · 61 · PRD-01B DF-01~05 · DF-09)
//  · 씨앗 — 기능 키 finance 꺼짐 · 설정 3개 · 표 행 0 · 공개 뷰 0행
//  · 기능 키 켜기 — 법률 검토 기록(approved) 없이 거부, 설정 저장 검사
//  · 구조 해설 — 초안 모양(관계 1개 이상·대체 텍스트) · 서명(reviewer)·법률 확인 · 고치면 재감수 필요 + 공개는 마지막 승인본 · 승인본 추가만
//  · 통계·규제 — 원자료 칸 · 차단 도메인·추적 쿼리 거부 · 추가만 시계열 · 시행 상태 계산
//  · 사례 — 실명 기업 반론 기록 · 무응답 대기 · 비실명 확인 · 공개 자료 근거 · 편집 승인 checklist · 미공개 조건 칸 없음
//  · 칼럼 — 소속 2항목 · 발행 검사 · 자사 홍보 아님 확인
//  · 권한 — anon은 표 읽기 0, 공개 뷰만 (키 꺼짐 0행)
// 모든 시험은 거래 안에서 돌고 되돌린다 (남는 행 0). 내용은 시험용 가짜다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
});
after(async () => client?.end());

async function attempt(sql, params = []) {
  await client.query("savepoint t");
  try {
    const res = await client.query(sql, params);
    await client.query("release savepoint t");
    return { ok: true, rows: res.rows };
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
const one = async (sql, params) => (await client.query(sql, params)).rows[0];
const all = async (sql, params) => (await client.query(sql, params)).rows;
const flag = (key, on) => client.query("update public.settings set value = value || jsonb_build_object($1::text, $2::boolean) where key = 'feature_flags'", [key, on]);
const setSetting = (key, value) => attempt("update public.settings set value = $2::jsonb where key = $1", [key, JSON.stringify(value)]);
const approvedReview = { reviewer: "시험용 법률 검토자", reviewed_on: "2026-10-01", conclusion: "approved" };
const openFinance = async () => {
  assert.ok((await setSetting("finance_legal_review", approvedReview)).ok);
  await flag("finance", true);
};
const insert = async (table, row) => {
  const keys = Object.keys(row);
  return (await client.query(`insert into public.${table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, keys.map((k) => row[k]))).rows[0];
};
const tryInsert = (table, row) => {
  const keys = Object.keys(row);
  return attempt(`insert into public.${table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, keys.map((k) => row[k]));
};
async function reviewer() {
  const id = (await one("insert into auth.users (id) values (gen_random_uuid()) returning id")).id;
  await client.query("insert into public.staff_roles (user_id, role, granted_by) values ($1, 'reviewer', 'admin:test')", [id]);
  return `user:${id}`;
}
const snapshot = () => insert("raw_snapshots", { source: "시험용 원문", url: "https://www.example.test/doc", content_hash: `h-${process.pid}-${++seq}`, payload: "시험용 원문 글자" });

const diagram = (over = {}) => ({
  alt: "시험용 구조도 대체 텍스트",
  nodes: [
    { key: "a", label: "주체 가" },
    { key: "b", label: "주체 나" },
  ],
  edges: [{ from: "a", to: "b", label: "관계 하나" }],
  ...over,
});
const LENS = { topics: ["시험세목"], points: ["시험용 포인트"], links: [{ kind: "explainer", label: "시험용 해설", url: "/tax/x" }], base_date: "2026-10-01" };
const structure = (over = {}) =>
  tryInsert("finance_structures", { slug: `w5-s-${process.pid}-${++seq}`, structure_type: "trust", title: "시험용 구조", summary: "시험용 한 줄", diagram: JSON.stringify(diagram()), notes: JSON.stringify(["시험용 문단"]), lens_omit_reason: "시험용 생략 사유", drafted_by: "user:test", ...over });
const sign = (id, by) => attempt("insert into public.finance_structure_versions (structure_id, tax_signed_by) values ($1, $2) returning *", [id, by]);
const legal = (id) => attempt("update public.finance_structures set legal_checked_by = '시험용 법률 검토자', legal_checked_at = current_date where id = $1 returning *", [id]);

const article = (over = {}) => insert("articles", { slug: `w5-a-${process.pid}-${++seq}`, title: "시험용 개발금융 기사", section: "finance", content_type: "reported_news", status: "draft", ...over });
const publish = (id) => attempt("update public.articles set status = 'published' where id = $1 returning status", [id]);
const approve = async (articleId, checklist) => {
  const p = await insert("people", { slug: `w5-p-${process.pid}-${++seq}`, name: "시험용 편집자", roles: ["editor"] });
  return tryInsert("editorial_reviews", { article_id: articleId, kind: "desk_edit", reviewer_id: p.id, decision: "approve", checklist: JSON.stringify(checklist) });
};
const evidence = (id) => insert("article_evidence", { article_id: id, evidence_type: "document", location: "시험용 보관함" });
const caseRow = (id, over = {}) => tryInsert("finance_cases", { article_id: id, structure_type: "trust", issues: ["시험 쟁점"], outcome: "시험용 결과", updated_by: "user:test", ...over });

test("씨앗 — 기능 키 finance 꺼짐 · 설정 3개 · 표 행 0 · 공개 뷰 0행 (운영 씨앗은 비어 있다)", async () => {
  const f = await one("select value from public.settings where key = 'feature_flags'");
  assert.equal(f.value.finance, false);
  assert.deepEqual((await one("select value from public.settings where key = 'finance_legal_review'")).value, {});
  assert.deepEqual((await one("select value from public.settings where key = 'finance_blocked_domains'")).value, []);
  assert.equal((await one("select value from public.settings where key = 'finance_rebuttal_wait_days'")).value, 7);
  for (const t of ["finance_structures", "finance_structure_versions", "finance_indicators", "finance_regulations", "finance_cases", "finance_column_interest_items"]) {
    assert.equal((await one(`select count(*)::int n from public.${t}`)).n, 0, `${t} 씨앗 0`);
  }
  const phrases = (await one("select value -> 'phrases' p from public.settings where key = 'forbidden_phrases'")).p;
  for (const p of ["매수 추천", "수익률 순위", "지금 가입"]) assert.ok(phrases.includes(p), `금지 표현 ${p}`);
});

test("기능 키 켜기 — 법률 검토 기록(approved) 없이 거부, rejected도 거부, approved면 켜지고 끄는 것은 항상 된다", async () => {
  await tx(async () => {
    const none = await attempt("update public.settings set value = value || '{\"finance\": true}'::jsonb where key = 'feature_flags'");
    assert.equal(none.ok, false);
    assert.match(none.message, /법률 검토 기록/);
    assert.ok((await setSetting("finance_legal_review", { ...approvedReview, conclusion: "rejected" })).ok);
    assert.equal((await attempt("update public.settings set value = value || '{\"finance\": true}'::jsonb where key = 'feature_flags'")).ok, false, "rejected");
    await openFinance();
    assert.equal((await one("select (value -> 'finance') = 'true'::jsonb as on from public.settings where key = 'feature_flags'")).on, true);
    await flag("finance", false);
  });
});

test("설정 저장 검사 — 법률 검토 기록 모양 · 차단 도메인 모양·중복 · 대기 기간 범위", async () => {
  await tx(async () => {
    for (const bad of [[], { reviewer: "가" }, { ...approvedReview, conclusion: "maybe" }, { ...approvedReview, reviewed_on: "2026-13-40" }, { ...approvedReview, reviewer: " " }]) {
      assert.equal((await setSetting("finance_legal_review", bad)).ok, false, JSON.stringify(bad));
    }
    assert.ok((await setSetting("finance_blocked_domains", ["shop.example.test"])).ok);
    assert.equal((await setSetting("finance_blocked_domains", ["Bad Domain"])).ok, false);
    assert.equal((await setSetting("finance_blocked_domains", ["a.example.test", "a.example.test"])).ok, false);
    assert.equal((await setSetting("finance_rebuttal_wait_days", 0)).ok, false);
    assert.equal((await setSetting("finance_rebuttal_wait_days", "7")).ok, false);
    assert.ok((await setSetting("finance_rebuttal_wait_days", 10)).ok);
  });
});

test("구조 해설 초안 — 관계 없음·대체 텍스트 없음·노드 key 오류·금지 표현·자리 채움·세액 표현 거부", async () => {
  await tx(async () => {
    assert.ok((await structure()).ok, "정상");
    const bad = [
      [diagram({ edges: [] }), /관계\(edges\)/],
      [diagram({ alt: " " }), /대체 텍스트/],
      [diagram({ edges: [{ from: "a", to: "zz", label: "" }] }), /관계는/],
      [diagram({ nodes: [{ key: "a", label: "하나" }, { key: "a", label: "둘" }] }), /두 번/],
    ];
    for (const [d, re] of bad) {
      const r = await structure({ diagram: JSON.stringify(d) });
      assert.equal(r.ok, false);
      assert.match(r.message, re);
    }
    assert.match((await structure({ summary: "이 상품은 매수 추천 대상입니다" })).message, /금지 표현/);
    assert.match((await structure({ summary: "확인 중" })).message, /자리 채움/);
    assert.match((await structure({ summary: "세금은 1,000원입니다" })).message, /세액/);
    assert.equal((await structure({ structure_type: "stock" })).ok, false, "구조 유형 값 목록");
    assert.equal((await structure({ legal_checked_by: "가", legal_checked_at: "2026-10-01" })).ok, false, "새 초안에 법률 확인 0");
  });
});

test("구조 해설 승인 — 서명은 감수위원만 · 법률 확인 필요 · 박스 또는 생략 사유 필요 · 고치면 재감수 필요 + 공개는 마지막 승인본 · 승인본 추가만", async () => {
  await tx(async () => {
    const rev = await reviewer();
    const plain = `user:${(await one("insert into auth.users (id) values (gen_random_uuid()) returning id")).id}`;
    const s = (await structure()).rows[0];
    assert.equal((await one("select review_status from public.finance_structure_board where id = $1", [s.id])).review_status, "draft");
    assert.match((await sign(s.id, rev)).message, /법률 확인 기록이 없습니다/);
    assert.ok((await legal(s.id)).ok);
    assert.match((await sign(s.id, plain)).message, /세무 감수위원/);
    assert.match((await sign(s.id, "user:not-uuid")).message, /세무 감수위원/);
    const noLens = (await structure({ lens_omit_reason: null })).rows[0];
    await legal(noLens.id);
    assert.match((await sign(noLens.id, rev)).message, /박스 또는 생략 사유/);

    const v1 = await sign(s.id, rev);
    assert.ok(v1.ok);
    assert.equal(v1.rows[0].version, 1);
    assert.equal(v1.rows[0].content.title, "시험용 구조");
    assert.equal((await one("select review_status from public.finance_structure_board where id = $1", [s.id])).review_status, "approved");

    await openFinance();
    assert.equal((await one("select title from public.public_finance_structures where slug = $1", [s.slug])).title, "시험용 구조");

    // 고치면 법률 확인이 지워지고 재감수 필요, 공개는 마지막 승인본 그대로
    assert.ok((await attempt("update public.finance_structures set title = '바꾼 제목' where id = $1", [s.id])).ok);
    const board = await one("select review_status, legal_checked_by from public.finance_structure_board where id = $1", [s.id]);
    assert.deepEqual(board, { review_status: "rereview_needed", legal_checked_by: null });
    assert.equal((await one("select title from public.public_finance_structures where slug = $1", [s.slug])).title, "시험용 구조", "공개본은 마지막 승인본");
    assert.match((await sign(s.id, rev)).message, /법률 확인 기록이 없습니다/, "고친 뒤 다시 법률 확인");
    await legal(s.id);
    const v2 = await sign(s.id, rev);
    assert.equal(v2.rows[0].version, 2);
    assert.equal((await one("select title, version from public.public_finance_structures where slug = $1", [s.slug])).title, "바꾼 제목");

    // 승인본 추가만 · 내용을 고치는 쓰기에 법률 확인 넣기 0 · 초안 지우기 0
    assert.equal((await attempt("update public.finance_structure_versions set version = 9 where id = $1", [v1.rows[0].id])).ok, false);
    assert.equal((await attempt("delete from public.finance_structure_versions where id = $1", [v1.rows[0].id])).ok, false);
    assert.equal((await attempt("delete from public.finance_structures where id = $1", [s.id])).ok, false);
    assert.equal((await attempt("update public.finance_structures set title = '또 바꿈', legal_checked_by = '가', legal_checked_at = current_date where id = $1", [s.id])).ok, false);
  });
});

test("공개 뷰 — 키 꺼짐이면 승인본·통계·규제가 모두 0행, 서명자 계정·메모 칸 0", async () => {
  await tx(async () => {
    const rev = await reviewer();
    const s = (await structure()).rows[0];
    await legal(s.id);
    await sign(s.id, rev);
    const snap = await snapshot();
    await insert("finance_indicators", { indicator_key: "idx_a", label: "시험 지표", definition: "시험 정의", value: 1.5, unit: "단위", as_of: "2026-09-30", collected_on: "2026-10-01", provider: "시험 기관", source_url: "https://www.example.test/a", snapshot_id: snap.id, recorded_by: "user:t" });
    await insert("finance_regulations", { reg_key: "reg_a", title: "시험 규제", stage: "예정", effective_on: "2099-01-01", provider: "시험 기관", source_url: "https://www.example.test/r", snapshot_id: snap.id, recorded_by: "user:t" });
    for (const v of ["public_finance_structures", "public_finance_indicators", "public_finance_regulations"]) {
      assert.equal((await one(`select count(*)::int n from public.${v}`)).n, 0, `${v} 키 꺼짐 0행`);
    }
    await openFinance();
    for (const v of ["public_finance_structures", "public_finance_indicators", "public_finance_regulations"]) {
      assert.equal((await one(`select count(*)::int n from public.${v}`)).n, 1, `${v} 키 켜짐 1행`);
    }
    const cols = (await all("select column_name from information_schema.columns where table_schema = 'public' and table_name = any($1)", [["public_finance_structures", "public_finance_indicators", "public_finance_regulations", "public_finance_cases", "public_finance_column_interest_items"]])).map((r) => r.column_name);
    for (const bad of ["tax_signed_by", "recorded_by", "snapshot_id", "rebuttal_note", "rebuttal_requested_at", "structure_id", "drafted_by"]) assert.ok(!cols.includes(bad), `공개 뷰에 ${bad} 0`);
  });
});

test("통계 지표 — 원자료 칸 필수 · 차단 도메인·추적 쿼리·미래 기준일 거부 · 추가만(새 값은 새 행) · 최신 표시", async () => {
  await tx(async () => {
    const snap = await snapshot();
    const base = { indicator_key: "idx_a", label: "시험 지표", definition: "시험 정의", value: 1.5, unit: "단위", as_of: "2026-09-30", collected_on: "2026-10-01", provider: "시험 기관", source_url: "https://www.example.test/a", snapshot_id: snap.id, recorded_by: "user:t" };
    const first = await tryInsert("finance_indicators", base);
    assert.ok(first.ok);
    for (const missing of ["provider", "source_url", "snapshot_id", "as_of", "collected_on", "definition", "unit"]) {
      assert.equal((await tryInsert("finance_indicators", { ...base, [missing]: null })).ok, false, `${missing} 없음 거부`);
    }
    assert.ok((await setSetting("finance_blocked_domains", ["shop.example.test"])).ok);
    assert.match((await tryInsert("finance_indicators", { ...base, source_url: "https://m.shop.example.test/x" })).message, /막아 둔 도메인/);
    assert.match((await tryInsert("finance_indicators", { ...base, source_url: "https://www.example.test/a?utm_source=x" })).message, /추적 쿼리/);
    assert.match((await tryInsert("finance_indicators", { ...base, as_of: "2099-01-01" })).message, /뒤입니다/);
    assert.match((await tryInsert("finance_indicators", { ...base, label: "수익률 순위 표" })).message, /금지 표현/);
    const second = await tryInsert("finance_indicators", { ...base, value: 2.5, as_of: "2026-10-01" });
    assert.ok(second.ok, "새 값은 새 행");
    assert.equal((await attempt("update public.finance_indicators set value = 9 where id = $1", [first.rows[0].id])).ok, false, "덮어쓰기 0");
    assert.equal((await attempt("delete from public.finance_indicators where id = $1", [first.rows[0].id])).ok, false, "지우기 0");
    await openFinance();
    const rows = await all("select id, is_latest from public.public_finance_indicators order by id");
    assert.deepEqual(rows.map((r) => r.is_latest), [false, true], "이전 값이 남고 최신만 표시");
  });
});

test("규제 항목 — 원문 칸 필수 · 시행 상태는 한국 시간 날짜로 계산 · 추가만 · 최신 표시", async () => {
  await tx(async () => {
    const snap = await snapshot();
    const base = { reg_key: "reg_a", title: "시험 규제", stage: "입법예고", effective_on: "2099-01-01", provider: "시험 기관", source_url: "https://www.example.test/r", snapshot_id: snap.id, recorded_by: "user:t" };
    assert.ok((await tryInsert("finance_regulations", base)).ok);
    assert.equal((await tryInsert("finance_regulations", { ...base, snapshot_id: null })).ok, false, "스냅샷 없음");
    assert.equal((await tryInsert("finance_regulations", { ...base, effective_on: null })).ok, false, "시행 예정일 없음");
    const kst = (await one("select (now() at time zone 'Asia/Seoul')::date::text d")).d;
    assert.ok((await tryInsert("finance_regulations", { ...base, stage: "시행", effective_on: kst })).ok, "시행일 당일 = 시행");
    assert.equal((await attempt("update public.finance_regulations set stage = '바꿈'")).ok, false);
    await openFinance();
    const rows = await all("select stage, is_latest, in_force from public.public_finance_regulations order by id");
    assert.deepEqual(rows.map((r) => [r.stage, r.is_latest, r.in_force]), [["입법예고", false, false], ["시행", true, true]]);
  });
});

test("사례 — 실명 기업은 반론 요청일·방법·답변 상태 없이 승인·발행 거부, 무응답은 대기 기간 뒤에만", async () => {
  await tx(async () => {
    const a = await article();
    await evidence(a.id);
    assert.ok((await caseRow(a.id, { named_company: true })).ok);
    const noRebuttal = await approve(a.id, { public_scope: true });
    assert.equal(noRebuttal.ok, false);
    assert.match(noRebuttal.message, /반론 요청일·요청 방법·답변 상태/);
    assert.match((await publish(a.id)).message, /반론 요청일·요청 방법·답변 상태/);
    assert.equal((await attempt("update public.finance_cases set rebuttal_status = 'answered' where article_id = $1", [a.id])).ok, false, "요청일 없이 답변 상태 0");
    const recent = new Date(Date.now() - 2 * 86400000).toISOString();
    assert.match((await attempt("update public.finance_cases set rebuttal_requested_at = $2, rebuttal_method = 'email', rebuttal_status = 'no_response' where article_id = $1", [a.id, recent])).message, /7일이 지나야/);
    const old = new Date(Date.now() - 8 * 86400000).toISOString();
    assert.ok((await attempt("update public.finance_cases set rebuttal_requested_at = $2, rebuttal_method = 'email', rebuttal_status = 'no_response' where article_id = $1", [a.id, old])).ok, "7일 지난 무응답");
    assert.ok((await approve(a.id, { public_scope: true })).ok);
    assert.ok((await publish(a.id)).ok);
  });
});

test("사례 — 공개 자료 범위 확인 없이 승인 0 · 근거 없이 발행 0 · 판결문 인용은 비실명 확인 필요 · 사례 하위 분야는 기록 필요", async () => {
  await tx(async () => {
    const a = await article();
    assert.ok((await caseRow(a.id)).ok);
    assert.match((await approve(a.id, {})).message, /public_scope/);
    assert.ok((await approve(a.id, { public_scope: true })).ok, "실명 아님 — 반론 기록 없이도 승인");
    assert.match((await publish(a.id)).message, /공개 자료 근거/);
    await evidence(a.id);
    assert.ok((await attempt("update public.finance_cases set judgment_quoted = true where article_id = $1", [a.id])).ok);
    assert.match((await publish(a.id)).message, /비실명 확인/);
    assert.ok((await attempt("update public.finance_cases set anonymized_checked = true where article_id = $1", [a.id])).ok);
    assert.ok((await publish(a.id)).ok);
    await openFinance();
    const pub = await one("select structure_type, named_company from public.public_finance_cases where article_id = $1", [a.id]);
    assert.deepEqual(pub, { structure_type: "trust", named_company: false });

    const cat = (await one("select id from public.categories where section = 'finance' and slug = 'cases'")).id;
    const b = await article({ category_id: cat });
    assert.match((await publish(b.id)).message, /금융 사례 기록/);
    const other = await article({ section: "tax" });
    assert.equal((await caseRow(other.id)).ok, false, "개발금융 분야 기사에만");
  });
});

test("사례 표 칸 — 미공개 조건(금리·수수료·약정) 칸 없음, 반론 메모는 공개 뷰에 없음 (DF-03 스키마 검사)", async () => {
  const cols = (await all("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'finance_cases'")).map((r) => r.column_name);
  assert.deepEqual(cols.filter((c) => /rate|fee|interest|commission|covenant|금리|수수료|약정|price|yield/i.test(c)), []);
  assert.ok(cols.includes("rebuttal_note"));
  const pub = (await all("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'public_finance_cases'")).map((r) => r.column_name);
  assert.ok(!pub.includes("rebuttal_note"));
});

test("개발금융 칼럼 — 소속 금융사·신탁사 2항목, 칼럼 기록이 있으면 비면 발행 0 · 없음은 확인자와 함께 · 자사 홍보 아님 확인 없이 승인 0", async () => {
  await tx(async () => {
    const a = await article({ content_type: "opinion" });
    const p = await insert("people", { slug: `w5-w-${process.pid}-${++seq}`, name: "시험용 필자", roles: ["writer"], employment: "external" });
    await insert("column_meta", { article_id: a.id, person_id: p.id, interest_state: "declared", interest_text: "시험용" });
    const item = (name, state, extra = {}) => tryInsert("finance_column_interest_items", { article_id: a.id, item: name, state, ...(state === "declared" ? { interest_text: "시험용 소속" } : { confirmed_by: "시험용 확인자", confirmed_at: new Date().toISOString() }), ...extra });
    assert.equal((await item("union", "declared")).ok, false, "항목 값 목록");
    assert.equal((await item("financial_company", "declared", { interest_text: " " })).ok, false, "빈 내용");
    assert.equal((await item("financial_company", "none_confirmed", { confirmed_by: null })).ok, false, "확인자 없음");
    assert.match((await publish(a.id)).message, /빠진 항목: 소속 금융사·소속 신탁사/);
    assert.ok((await item("financial_company", "declared")).ok);
    assert.match((await publish(a.id)).message, /빠진 항목: 소속 신탁사\./);
    assert.ok((await item("trust_company", "none_confirmed")).ok);
    assert.match((await approve(a.id, {})).message, /not_self_promo/);
    assert.ok((await approve(a.id, { not_self_promo: true })).ok);
    assert.equal((await tryInsert("finance_column_interest_items", { article_id: (await article({ section: "tax", content_type: "opinion" })).id, item: "trust_company", state: "declared", interest_text: "x" })).ok, false, "다른 분야 칼럼 0");
    assert.match((await attempt("update public.finance_column_interest_items set interest_text = '추천 상품 매수 추천' where article_id = $1 and item = 'financial_company'", [a.id])).message, /금지 표현/);
    assert.doesNotMatch((await publish(a.id)).message ?? "", /소속/, "2항목이 갖춰지면 이 검사는 통과 — 이어서 W3 칼럼 검사(필자 검증·계약)가 막는다");
    await client.query("set local session_replication_role = replica");
    await client.query("update public.articles set status = 'published' where id = $1", [a.id]);
    await client.query("set local session_replication_role = origin");
    assert.match((await attempt("delete from public.finance_column_interest_items where article_id = $1", [a.id])).message, /지울 수 없습니다/);
    await openFinance();
    const rows = await all("select item, state from public.public_finance_column_interest_items where article_id = $1 order by item", [a.id]);
    assert.deepEqual(rows, [{ item: "financial_company", state: "declared" }, { item: "trust_company", state: "none_confirmed" }]);
  });
});

test("권한 — anon은 W5 표를 읽지 못하고 공개 뷰만 읽는다, 추가만 표는 service_role도 고치기·지우기 0", async () => {
  await tx(async () => {
    await client.query("set local role anon");
    for (const t of ["finance_structures", "finance_structure_versions", "finance_indicators", "finance_regulations", "finance_cases", "finance_column_interest_items", "finance_structure_board"]) {
      assert.equal((await attempt(`select 1 from public.${t}`)).ok, false, `${t} anon 읽기 0`);
    }
    for (const v of ["public_finance_structures", "public_finance_indicators", "public_finance_regulations", "public_finance_cases", "public_finance_column_interest_items"]) {
      assert.ok((await attempt(`select 1 from public.${v}`)).ok, `${v} anon 읽기`);
    }
    await client.query("reset role");
    await client.query("set local role service_role");
    for (const t of ["finance_structure_versions", "finance_indicators", "finance_regulations"]) {
      assert.equal((await attempt(`update public.${t} set id = id`)).ok, false, `${t} 고치기 권한 0`);
      assert.equal((await attempt(`delete from public.${t}`)).ok, false, `${t} 지우기 권한 0`);
    }
    await client.query("reset role");
  });
});
