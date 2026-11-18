// W4 7단계 DB — 지역 기사 편집 게이트 (발행·승인 트리거는 2026-11-18 PO 결정으로 마이그레이션 20261118000243이 지웠다 — 아래 시험이 그 상태를 지킨다)
// 원래 설명: 지역 기사 편집 게이트 (docs/dev/W4_설계.md 1장 7단계 · 2.1 · 2.2 · 3장 · 12장 #7·#30, 마이그레이션 20261022000043 · PRD-01B REG1-17)
//  · 값 목록 — 소재 4·관계 유형 6·판정 4 = 설계 2.1 글자(DB check) · 설정 씨앗 regional_judge_fields = 2.2(편집 분야 4종), 저장 검사
//  · 발행 트리거 — 지자체뉴스 새 발행은 지역 태그 필수(이미 공개된 적 있는 기사·발행일을 넣어 오는 이관 행은 그대로) ·
//    지역 태그 기사(sponsored 제외)는 편집 분야·공익적 질문 · 판정 책임자 없는 분야 보류 · 비보도 판정 + 보도·해설 거부(공개 중 판정도 거부) ·
//    축제·명소·상권 = 관계 유형 1 + 반려 아닌 근거 1 · 관계 유형 중복·없는 제휴사 번호 거부 · 판정자·시각 없는 판정 거부
//  · 편집 승인 트리거 — 지역 기사 desk_edit approve는 checklist 3항목(evidence·relation·ad_independence = true) · 광고 계약 제휴사를 다룬 원고는 이해관계 표시
//  · 기획 subject_kind·relation_types 값 목록(새 값부터) · 함수 실행 권한 0
// 모든 시험은 거래 안에서 돌고 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESIGN = fs.readFileSync(path.join(HERE, "..", "..", "..", "docs", "dev", "W4_설계.md"), "utf8");
const line = (prefix) => {
  const l = DESIGN.split("\n").find((x) => x.startsWith(prefix));
  assert.ok(l, `설계 문서에 '${prefix}' 줄이 없다`);
  return l;
};
const codes = (prefix, col = 2) => [...line(prefix).split("|")[col].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const SUBJECTS = codes("| article.subject_kind");
const RELATIONS = codes("| article.relation_types");
const JUDGEMENTS = codes("| article.editorial_judgement");
const CHECKLIST = codes("| regional_review.checklist");
const FIELDS = codes("| editorial_field");
const JUDGE_SEED = JSON.parse(codes("| `regional_judge_fields` |")[0]);

const SEOUL = "1100000000";
const Q = "시험용 공익적 질문 — 이 지역 지방재정에 어떤 영향을 주나";
const FULL = { evidence: true, relation: true, ad_independence: true };

let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
});
after(async () => client?.end());

async function attempt(sql, params = [], role = null) {
  await client.query("savepoint t");
  try {
    if (role) await client.query(`set local role ${role}`);
    const res = await client.query(sql, params);
    if (role) await client.query("reset role");
    await client.query("release savepoint t");
    return { ok: true, rows: res.rows, rowCount: res.rowCount };
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
const uniq = (p) => `${p}-${process.pid}-${++seq}`;
const one = async (sql, params) => (await client.query(sql, params)).rows[0];
const insertSql = (table, row) => {
  const keys = Object.keys(row);
  return [`insert into public.${table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, keys.map((k) => row[k])];
};
const tryInsert = (table, row) => attempt(...insertSql(table, row));
const insert = async (table, row) => (await client.query(...insertSql(table, row))).rows[0];

/** 지역 기사 초안 — 지역 태그·편집 분야·공익적 질문이 찬 모양 (가짜 내용) */
const draft = (over = {}) =>
  insert("articles", { slug: uniq("w4rg"), title: "시험용 지역 기사", section: "local", content_type: "reported_news", status: "draft", region_codes: [SEOUL], editorial_field: "local_finance", public_question: Q, ...over });
const DESK_FULL = { evidence: true, relation: true, ad_independence: true };
/**
 * 발행 — W4 8단계부터 지역 기사는 단계를 밟아야 공개된다(초안 → 편집 승인(지역 기사 3항목) → 승인 → 발행, REG1-14 · …44 articles_stage_order).
 * 편집 승인·승인 단계를 밟은 뒤 발행 상태로 바꾼다. 실패하면 그 문장(발행 검사 문장은 7단계·5단계 트리거가 먼저 낸다). 한 번에 되돌린다
 */
async function publish(id) {
  await client.query("savepoint p");
  try {
    const desk = (await client.query("insert into public.people (slug, name, roles) values ($1, '시험용 편집 책임자', '{editor}') returning id", [uniq("desk")])).rows[0].id;
    await client.query("insert into public.editorial_reviews (article_id, kind, reviewer_id, decision, checklist) values ($1, 'desk_edit', $2, 'approve', $3)", [id, desk, JSON.stringify(DESK_FULL)]);
    await client.query("update public.articles set status = 'approved' where id = $1 and status not in ('approved', 'published', 'scheduled')", [id]);
    const res = await client.query("update public.articles set status = 'published' where id = $1 returning status, first_published_at", [id]);
    await client.query("release savepoint p");
    return { ok: true, rows: res.rows, rowCount: res.rowCount };
  } catch (err) {
    await client.query("rollback to savepoint p");
    return { ok: false, message: err.message, code: err.code };
  }
}
const person = () => insert("people", { slug: uniq("p"), name: "시험용 편집자", roles: ["editor"] });
const approve = async (articleId, checklist) => {
  const editor = await person();
  return tryInsert("editorial_reviews", { article_id: articleId, kind: "desk_edit", reviewer_id: editor.id, decision: "approve", checklist: JSON.stringify(checklist) });
};
const checkValues = async (table, constraint) => {
  const def = (await client.query("select pg_get_constraintdef(oid) d from pg_constraint where conrelid = $1::regclass and conname = $2", [`public.${table}`, constraint])).rows[0]?.d ?? "";
  return [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
};

test("값 목록 — 소재 4·관계 유형 6·판정 4·승인 3항목 = 설계 2.1 글자(DB check), 판정 책임자 씨앗 = 2.2(편집 분야 4종)", async () => {
  assert.deepEqual(SUBJECTS, ["general", "festival", "attraction", "commerce"]);
  assert.deepEqual(RELATIONS, ["budget", "tax_revenue", "public_property", "development", "transaction", "housing"]);
  assert.deepEqual(JUDGEMENTS, ["news_candidate", "travel_review", "restaurant_pick", "event_promo"]);
  assert.deepEqual(CHECKLIST, ["evidence", "relation", "ad_independence"]);
  assert.deepEqual(await checkValues("articles", "articles_subject_kind_check"), SUBJECTS);
  assert.deepEqual(await checkValues("articles", "articles_relation_types_check"), RELATIONS);
  assert.deepEqual(await checkValues("articles", "articles_editorial_judgement_check"), JUDGEMENTS);
  assert.deepEqual(await checkValues("story_assignments", "story_assignments_subject_kind_values"), SUBJECTS);
  assert.deepEqual(await checkValues("story_assignments", "story_assignments_relation_types_values"), RELATIONS);
  assert.deepEqual(JUDGE_SEED, FIELDS);
  assert.deepEqual((await one("select value from public.settings where key = 'regional_judge_fields'")).value, JUDGE_SEED);
  assert.equal((await one("select column_default d from information_schema.columns where table_schema = 'public' and table_name = 'articles' and column_name = 'subject_kind'")).d, "'general'::text");
});

test("판정 책임자 설정 — 편집 분야 0~4개 목록만 (목록 밖·두 번·목록 아님 거부), 빈 목록·일부는 저장", () =>
  tx(async () => {
    for (const bad of [["tourism"], ["local_tax", "local_tax"], { local_tax: true }, "local_tax", [1]]) {
      const r = await attempt("update public.settings set value = $1::jsonb where key = 'regional_judge_fields'", [JSON.stringify(bad)]);
      assert.equal(r.ok, false, JSON.stringify(bad));
      assert.equal(r.code, "23514");
    }
    for (const good of [[], ["local_tax"], JUDGE_SEED]) assert.ok((await attempt("update public.settings set value = $1::jsonb where key = 'regional_judge_fields'", [JSON.stringify(good)])).ok, JSON.stringify(good));
  }));

test("지역 기사 게이트 트리거는 걷어냈다 (마이그레이션 20261118000243, 2026-11-18 PO 결정) — 태그·편집 분야·승인 3항목 없이도 발행·승인된다", () =>
  tx(async () => {
    const gone = await client.query("select tgname from pg_trigger where tgname in ('articles_regional_gate', 'editorial_reviews_regional_guard')");
    assert.deepEqual(gone.rows, [], "발행·승인 트리거가 없어야 한다");
    // 설정값 모양 검사 트리거는 남는다 (regional_judge_fields)
    const kept = await client.query("select tgname from pg_trigger where tgname = 'settings_regional_guard'");
    assert.equal(kept.rows.length, 1);
    // 지역 태그·편집 분야·공익적 질문이 모두 빈 지자체뉴스도 새로 발행된다
    const noTag = await draft({ region_codes: [], editorial_field: null, public_question: null });
    const r = await publish(noTag.id);
    assert.equal(r.ok, true, r.message);
    // 지자체뉴스를 승인 3항목 없이 편집 승인해도 된다
    const other = await draft({ region_codes: [], editorial_field: null, public_question: null });
    assert.equal((await approve(other.id, {})).ok, true, "승인 3항목 없이도 승인");
    // 축제 소재 + 관계 0 + 근거 0도 발행된다
    const festival = await draft({ subject_kind: "festival", relation_types: [] });
    assert.equal((await publish(festival.id)).ok, true, "관계 유형·근거 없이도 발행");
    // 비보도 판정(여행 후기 등)은 별도 상품 검토 큐(w4-regional-queue)가 맡는다 — 이 시험의 범위 밖이라 여기서는 보지 않는다
  }));

test("기획 값 목록 — subject_kind·relation_types는 새 값부터 검사, 함수 실행 권한 0", () =>
  tx(async () => {
    assert.equal((await tryInsert("story_assignments", { section: "local", subject_kind: "tour" })).code, "23514");
    assert.equal((await tryInsert("story_assignments", { section: "local", relation_types: ["tourism"] })).code, "23514");
    assert.equal((await tryInsert("story_assignments", { section: "local", subject_kind: "festival", relation_types: ["budget", "housing"] })).ok, true);
    for (const fn of ["regional_publish_problem(public.articles, boolean)", "articles_regional_gate()", "editorial_reviews_regional_guard()", "regional_settings_guard()"]) {
      for (const role of ["anon", "authenticated"]) {
        assert.equal((await one("select has_function_privilege($1, $2, 'execute') ok", [role, `public.${fn}`])).ok, false, `${role} ${fn}`);
      }
    }
  }));
