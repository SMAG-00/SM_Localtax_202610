// W4 7단계 DB — 지역 기사 편집 게이트 (docs/dev/W4_설계.md 1장 7단계 · 2.1 · 2.2 · 3장 · 12장 #7·#30, 마이그레이션 20261022000043 · PRD-01B REG1-17)
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
const publish = (id) => attempt("update public.articles set status = 'published' where id = $1 returning status, first_published_at", [id]);
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

test("지자체뉴스 지역 태그 (W2-b #17 · 12장 #30) — 새 발행·예약은 태그 필수, 이미 공개된 적 있는 기사·이관 행은 그대로", () =>
  tx(async () => {
    const noTag = await draft({ region_codes: [], editorial_field: null, public_question: null });
    const r = await publish(noTag.id);
    assert.equal(r.ok, false);
    assert.match(r.message, /지역 태그\(regionCodes\)가 있어야 새로 발행/);
    const scheduled = await attempt("update public.articles set status = 'scheduled', publish_at = now() + interval '1 day' where id = $1", [noTag.id]);
    assert.equal(scheduled.ok, false, "예약도 새 발행");
    const directInsert = await tryInsert("articles", { slug: uniq("w4rg"), title: "t", section: "local", content_type: "explainer", status: "published" });
    assert.equal(directInsert.ok, false, "발행 상태로 바로 넣는 새 행도 거부(한쪽만 우회한 삽입도 실패)");
    // 지역 태그가 있으면 발행된다
    const tagged = await draft();
    assert.equal((await publish(tagged.id)).ok, true);
    // 이미 공개된 적 있는 기사(first_published_at 있음) — 보류 → 다시 공개는 태그 없이도 된다
    const old = await draft({ region_codes: [], editorial_field: null, public_question: null, status: "held", first_published_at: new Date(Date.now() - 86_400_000 * 30) });
    assert.equal((await publish(old.id)).ok, true, "이미 공개된 기사 유지");
    // 이관 — 발행일을 넣어 오는 공개 행은 이미 공개된 기사
    const imported = await tryInsert("articles", { slug: uniq("w4rg"), title: "t", section: "local", content_type: "explainer", status: "published", origin: "legacy", first_published_at: "2024-03-01T00:00:00+09:00" });
    assert.equal(imported.ok, true, imported.message);
    // 다른 분야의 지역 태그 없는 기사는 이 규칙 밖
    assert.equal((await publish((await draft({ section: "tax", content_type: "explainer", region_codes: [], editorial_field: null, public_question: null })).id)).ok, true);
  }));

test("지역 태그 기사 = 편집 분야 + 공익적 질문 (광고·협찬 제외), 판정 책임자 없는 분야는 보류", () =>
  tx(async () => {
    const noField = await draft({ editorial_field: null });
    assert.match((await publish(noField.id)).message, /편집 분야\(editorialField/);
    const noQuestion = await draft({ public_question: "   " });
    assert.match((await publish(noQuestion.id)).message, /공익적 질문\(publicQuestion\)/);
    const otherSection = await draft({ section: "realestate", editorial_field: null });
    assert.equal((await publish(otherSection.id)).ok, false, "부동산 분야라도 지역 태그가 있으면 같은 규칙");
    const ad = await draft({ content_type: "sponsored", label: "ad", editorial_field: null, public_question: null });
    assert.equal((await publish(ad.id)).ok, true, "광고·협찬은 편집 분야 게이트 밖");
    // 판정 책임자 목록에서 지방재정을 빼면 그 분야의 지역 기사 보류
    await client.query("update public.settings set value = '[\"local_tax\", \"realestate\"]'::jsonb where key = 'regional_judge_fields'");
    const held = await draft({ editorial_field: "local_finance" });
    const r = await publish(held.id);
    assert.equal(r.ok, false);
    assert.match(r.message, /판정 책임자가 지정되지 않아 이 지역 기사는 보류\(held\)/);
    assert.equal((await publish((await draft({ editorial_field: "local_tax" })).id)).ok, true, "목록에 있는 분야는 발행");
  }));

test("축제·명소·상권 소재 — 관계 유형 0 → 보류, 관계 1 + 근거 0(반려만 있어도) → 보류, 둘 다 → 후보 (광고·협찬 제외)", () =>
  tx(async () => {
    for (const subject of ["festival", "attraction", "commerce"]) {
      const a = await draft({ subject_kind: subject });
      assert.match((await publish(a.id)).message, /관계 유형\(relationTypes/, subject);
    }
    const noEvidence = await draft({ subject_kind: "festival", relation_types: ["budget"] });
    assert.match((await publish(noEvidence.id)).message, /근거\(evidence\) 1건 이상/);
    await insert("article_evidence", { article_id: noEvidence.id, evidence_type: "document", location: "시험용 보관함", verification_status: "rejected" });
    assert.equal((await publish(noEvidence.id)).ok, false, "반려된 근거는 세지 않는다");
    await insert("article_evidence", { article_id: noEvidence.id, evidence_type: "document", location: "시험용 예산서 사본 보관함" });
    assert.equal((await publish(noEvidence.id)).ok, true, "'축제 예산의 지방재정 영향' — 관계 + 근거 = 후보");
    const general = await draft({ subject_kind: "general" });
    assert.equal((await publish(general.id)).ok, true, "일반 소재는 관계 유형을 보지 않는다");
    const ad = await draft({ subject_kind: "festival", content_type: "sponsored", label: "ad" });
    assert.equal((await publish(ad.id)).ok, true, "광고·협찬은 소재 게이트 밖");
    // 값 모양
    assert.equal((await tryInsert("articles", { slug: uniq("w4rg"), title: "t", section: "local", content_type: "explainer", subject_kind: "tour" })).code, "23514");
    assert.equal((await tryInsert("articles", { slug: uniq("w4rg"), title: "t", section: "local", content_type: "explainer", relation_types: ["tourism"] })).code, "23514");
    const dup = await tryInsert("articles", { slug: uniq("w4rg"), title: "t", section: "local", content_type: "explainer", relation_types: ["budget", "budget"] });
    assert.match(dup.message, /같은 값이 두 번/);
  }));

test("편집자 판정 — 여행 후기·맛집 추천·행사 홍보 + 보도·해설 발행 거부, 공개 중 판정 거부, 판정자·시각 필수", () =>
  tx(async () => {
    const judged = { judged_by: "user:w4rg-test", judged_at: new Date() };
    for (const j of ["travel_review", "restaurant_pick", "event_promo"]) {
      const news = await draft({ editorial_judgement: j, ...judged });
      assert.match((await publish(news.id)).message, /보도기사·해설로 발행할 수 없습니다/, j);
    }
    const explainer = await draft({ content_type: "explainer", editorial_judgement: "travel_review", ...judged });
    assert.equal((await publish(explainer.id)).ok, false);
    const guide = await draft({ content_type: "guide", editorial_judgement: "event_promo", ...judged });
    assert.equal((await publish(guide.id)).ok, true, "가이드는 이 규칙 밖");
    const candidate = await draft({ editorial_judgement: "news_candidate", ...judged });
    assert.equal((await publish(candidate.id)).ok, true);
    // 공개 중인 보도기사를 비보도로 판정 — 거부(먼저 내린다)
    const onAir = await attempt("update public.articles set editorial_judgement = 'restaurant_pick' where id = $1", [candidate.id]);
    assert.equal(onAir.ok, false);
    assert.match(onAir.message, /먼저 내린 뒤 판정하세요/);
    // 판정자·시각 없는 판정·판정 없이 판정자만 — 거부
    assert.equal((await tryInsert("articles", { slug: uniq("w4rg"), title: "t", section: "local", content_type: "explainer", editorial_judgement: "news_candidate" })).code, "23514");
    assert.equal((await tryInsert("articles", { slug: uniq("w4rg"), title: "t", section: "local", content_type: "explainer", judged_by: "user:x", judged_at: new Date() })).code, "23514");
  }));

test("편집 승인 — 지역 기사 desk_edit approve는 3항목 모두 true, 지역 기사가 아닌 기사·광고·반려·보류는 이 규칙 밖", () =>
  tx(async () => {
    const a = await draft();
    for (const key of CHECKLIST) {
      const partial = Object.fromEntries(CHECKLIST.filter((k) => k !== key).map((k) => [k, true]));
      const r = await approve(a.id, partial);
      assert.equal(r.ok, false, key);
      assert.match(r.message, new RegExp(`빠진 항목: .*\\(${key}\\)`));
    }
    assert.equal((await approve(a.id, { ...FULL, evidence: "true" })).ok, false, "글자 'true'는 확인이 아니다");
    assert.equal((await approve(a.id, FULL)).ok, true);
    const untagged = await draft({ region_codes: [], editorial_field: null, public_question: null });
    assert.equal((await approve(untagged.id, {})).ok, false, "지자체뉴스는 태그가 없어도 지역 기사");
    const tax = await draft({ section: "tax", content_type: "explainer", region_codes: [] });
    assert.equal((await approve(tax.id, {})).ok, true, "지역 기사가 아니면 3항목을 보지 않는다");
    const ad = await draft({ content_type: "sponsored", label: "ad" });
    assert.equal((await approve(ad.id, {})).ok, true, "광고·협찬 제외");
    const editor = await person();
    assert.equal((await tryInsert("editorial_reviews", { article_id: a.id, kind: "desk_edit", reviewer_id: editor.id, decision: "hold", reason: "보류", checklist: "{}" })).ok, true, "보류는 이 규칙 밖");
  }));

test("광고·협찬 계약 기록이 있는 제휴사를 다룬 원고 — 이해관계 표시 없이 승인 거부, 계약 기록 없는 제휴사·표시가 있으면 승인 · 없는 제휴사 번호 거부", () =>
  tx(async () => {
    const contracted = await insert("partners", { name: "시험용 가상상회", kind: "local_business", contract_from: "2026-01-01" });
    const plain = await insert("partners", { name: "시험용 가상기관", kind: "institution" });
    const a = await draft({ covered_partner_ids: [contracted.id] });
    const r = await approve(a.id, FULL);
    assert.equal(r.ok, false);
    assert.match(r.message, /시험용 가상상회.*이해관계 표시\(interestDisclosure\)/);
    await client.query("update public.articles set interest_disclosure = '시험용 가상상회는 이 매체의 광고주입니다' where id = $1", [a.id]);
    assert.equal((await approve(a.id, FULL)).ok, true);
    const b = await draft({ covered_partner_ids: [plain.id] });
    assert.equal((await approve(b.id, FULL)).ok, true, "계약 기록이 없으면 표시를 요구하지 않는다");
    const missing = await tryInsert("articles", { slug: uniq("w4rg"), title: "t", section: "local", content_type: "explainer", covered_partner_ids: [999999999] });
    assert.match(missing.message, /없는 제휴사 번호/);
    const twice = await tryInsert("articles", { slug: uniq("w4rg"), title: "t", section: "local", content_type: "explainer", covered_partner_ids: [plain.id, plain.id] });
    assert.match(twice.message, /두 번/);
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
