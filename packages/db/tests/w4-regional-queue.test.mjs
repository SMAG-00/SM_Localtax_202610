// W4 8단계 DB — 편집 경고·별도 상품 검토 큐·단계 순서·AI 초안 역할 (docs/dev/W4_설계.md 1장 8단계 · 2.1 · 2.2 · 3장 44 · 6장, 마이그레이션 20261022000044 · PRD-01B REG1-14·17)
//  · 값 목록 — 큐 상태 2 = 설계 2.1 · 큐 판정 = 2.1 편집자 판정 중 비보도 3 · 설정 씨앗 stale_statistics_days = 2.2(365), 저장 검사 1~3650 정수
//  · 비보도 판정 → 열린 큐 항목 정확히 1건(판정 바꿔도 1건) · 기사 후보·지우기 → 닫힘 · 다시 비보도 → 새 항목 · 넣기·고치기 규칙(열린 항목 하나·판정 일치·닫힌 항목 고정·닫을 때 메모)
//  · 열린 항목 원고는 어떤 유형으로도 공개 0 — 공개 뷰(사이트맵 원본)·자체 취재 집계(news_production_facts)에 0, 닫으면 가이드는 발행 · 공개 중 비보도 판정·비보도 공개 행 넣기 거부
//  · 단계 순서 — 지역 기사 초안·검토 중·보류 → 공개 거부, 편집 승인 없이 승인 거부, 세무 감수 반려 → 승인 거부, 승인 → 공개 통과 · 지역 기사 아님·광고·다시 공개·새 행은 밖
//  · AI 초안 역할 ai_drafter — 로그인 0·RLS 우회 0·public 표 쓰기 권한 0, articles·article_sources 쓰기는 권한을 잘못 줘도 RLS가 거부
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
const QUEUE_STATUSES = codes("| separate_product_queue.status");
const JUDGEMENTS = codes("| article.editorial_judgement");
const STALE_SEED = JSON.parse(codes("| `stale_statistics_days` |")[0]);

const SEOUL = "1100000000";
const Q = "시험용 공익적 질문 — 이 지역 지방재정에 어떤 영향을 주나";
const FULL = { evidence: true, relation: true, ad_independence: true };
const JUDGED = { judged_by: "user:w4rq-test", judged_at: new Date() };

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
  insert("articles", { slug: uniq("w4rq"), title: "시험용 지역 기사", section: "local", content_type: "reported_news", status: "draft", region_codes: [SEOUL], editorial_field: "local_finance", public_question: Q, ...over });
const setStatus = (id, status, extra = "") => attempt(`update public.articles set status = $2${extra} where id = $1 returning status, first_published_at`, [id, status]);
const person = () => insert("people", { slug: uniq("p"), name: "시험용 편집자", roles: ["editor"] });
const review = async (articleId, kind, decision, checklist = FULL) => {
  const who = await person();
  return tryInsert("editorial_reviews", { article_id: articleId, kind, reviewer_id: who.id, decision, checklist: JSON.stringify(checklist), ...(decision === "approve" ? {} : { reason: "시험용 사유" }) });
};
/** 단계를 밟아 공개 — 편집 승인(3항목) → 승인 → 발행 */
async function publishByStages(id) {
  await client.query("savepoint s");
  try {
    const r = await review(id, "desk_edit", "approve");
    if (!r.ok) throw new Error(r.message);
    await client.query("update public.articles set status = 'approved' where id = $1 and status <> 'approved'", [id]);
    const res = await client.query("update public.articles set status = 'published' where id = $1 returning status, first_published_at", [id]);
    await client.query("release savepoint s");
    return { ok: true, rows: res.rows };
  } catch (err) {
    await client.query("rollback to savepoint s");
    return { ok: false, message: err.message, code: err.code };
  }
}
const queueOf = async (articleId) => (await client.query("select * from public.separate_product_queue where article_id = $1 order by id", [articleId])).rows;
const checkValues = async (table, constraint) => {
  const def = (await client.query("select pg_get_constraintdef(oid) d from pg_constraint where conrelid = $1::regclass and conname = $2", [`public.${table}`, constraint])).rows[0]?.d ?? "";
  return [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
};

test("값 목록 — 큐 상태 = 설계 2.1(open·closed) · 큐 판정 = 비보도 3종 · stale_statistics_days 씨앗 = 2.2(365), 저장은 1~3650 정수만", () =>
  tx(async () => {
    assert.deepEqual(QUEUE_STATUSES, ["open", "closed"]);
    assert.deepEqual(await checkValues("separate_product_queue", "separate_product_queue_status_check"), QUEUE_STATUSES);
    assert.deepEqual(await checkValues("separate_product_queue", "separate_product_queue_judgement_check"), JUDGEMENTS.filter((j) => j !== "news_candidate"));
    assert.equal(STALE_SEED, 365);
    assert.equal((await one("select value from public.settings where key = 'stale_statistics_days'")).value, STALE_SEED);
    for (const bad of [0, 3651, "365", 1.5, -1, [365]]) {
      const r = await attempt("update public.settings set value = $1::jsonb where key = 'stale_statistics_days'", [JSON.stringify(bad)]);
      assert.equal(r.ok, false, JSON.stringify(bad));
      assert.equal(r.code, "23514");
    }
    for (const good of [1, 30, 3650, 365]) assert.ok((await attempt("update public.settings set value = $1::jsonb where key = 'stale_statistics_days'", [JSON.stringify(good)])).ok, String(good));
  }));

test("비보도 판정 → 열린 큐 항목 정확히 1건 — 판정을 바꿔도 1건, 기사 후보로 바꾸면 닫힘, 다시 비보도면 새 항목", () =>
  tx(async () => {
    const a = await draft();
    assert.equal((await queueOf(a.id)).length, 0, "판정 전 0건");
    await client.query("update public.articles set editorial_judgement = 'travel_review', judged_by = 'user:w4rq-a', judged_at = '2026-10-20T10:00:00+09:00' where id = $1", [a.id]);
    let q = await queueOf(a.id);
    assert.equal(q.length, 1);
    assert.deepEqual([q[0].judgement, q[0].judged_by, q[0].status, new Date(q[0].at).toISOString()], ["travel_review", "user:w4rq-a", "open", "2026-10-20T01:00:00.000Z"]);
    // 같은 판정을 다시 적어도·다른 비보도 판정으로 바꿔도 1건 (판정만 맞춘다)
    await client.query("update public.articles set editorial_judgement = 'travel_review' where id = $1", [a.id]);
    await client.query("update public.articles set editorial_judgement = 'restaurant_pick', judged_by = 'user:w4rq-b', judged_at = now() where id = $1", [a.id]);
    q = await queueOf(a.id);
    assert.equal(q.length, 1, "판정을 바꿔도 항목 1건");
    assert.deepEqual([q[0].judgement, q[0].judged_by, q[0].status], ["restaurant_pick", "user:w4rq-b", "open"]);
    // 기사 후보로 바꾸면 닫힌다 (닫은 사람 = 새 판정자, 메모 = 판정 변경)
    await client.query("update public.articles set editorial_judgement = 'news_candidate', judged_by = 'user:w4rq-c', judged_at = now() where id = $1", [a.id]);
    q = await queueOf(a.id);
    assert.deepEqual([q.length, q[0].status, q[0].closed_by, q[0].closed_at !== null], [1, "closed", "user:w4rq-c", true]);
    assert.match(q[0].note, /news_candidate\(으\)로 바뀌어 닫힘/);
    // 다시 행사 홍보 → 새 열린 항목 (닫힌 항목은 그대로)
    await client.query("update public.articles set editorial_judgement = 'event_promo', judged_by = 'user:w4rq-c', judged_at = now() where id = $1", [a.id]);
    q = await queueOf(a.id);
    assert.deepEqual(q.map((x) => [x.judgement, x.status]), [["restaurant_pick", "closed"], ["event_promo", "open"]]);
    // 판정 지우기도 닫는다
    await client.query("update public.articles set editorial_judgement = null, judged_by = null, judged_at = null where id = $1", [a.id]);
    assert.deepEqual((await queueOf(a.id)).map((x) => x.status), ["closed", "closed"]);
    // 처음부터 비보도 판정으로 넣은 원고도 1건
    const b = await draft({ editorial_judgement: "event_promo", ...JUDGED });
    assert.deepEqual((await queueOf(b.id)).map((x) => [x.judgement, x.status]), [["event_promo", "open"]]);
    const c = await draft({ editorial_judgement: "news_candidate", ...JUDGED });
    assert.equal((await queueOf(c.id)).length, 0, "기사 후보 판정은 큐 0");
  }));

test("큐 넣기·고치기 — 원고마다 열린 항목 하나, 판정은 원고 판정과 같아야, 닫힌 항목 고정, 닫을 때 닫은 사람·시각·메모 필수", () =>
  tx(async () => {
    const a = await draft({ editorial_judgement: "travel_review", ...JUDGED });
    const [item] = await queueOf(a.id);
    const second = await tryInsert("separate_product_queue", { article_id: a.id, judgement: "travel_review", judged_by: "user:x" });
    assert.equal(second.code, "23505", "열린 항목 두 번 0");
    const mismatch = await tryInsert("separate_product_queue", { article_id: (await draft()).id, judgement: "travel_review", judged_by: "user:x" });
    assert.match(mismatch.message, /편집자 판정\(없음\)과 다릅니다/);
    assert.match((await tryInsert("separate_product_queue", { article_id: a.id, judgement: "travel_review", judged_by: "user:x", status: "closed", closed_by: "user:x", closed_at: new Date(), note: "x" })).message, /열린 상태\(open\)로만/);
    assert.equal((await tryInsert("separate_product_queue", { article_id: a.id, judgement: "tour", judged_by: "user:x" })).code, "23514");
    // 닫기 — 메모 없이 0, 닫은 사람 없이 0
    assert.equal((await attempt("update public.separate_product_queue set status = 'closed', closed_by = 'user:x', closed_at = now() where id = $1", [item.id])).code, "23514", "메모 필수");
    assert.equal((await attempt("update public.separate_product_queue set status = 'closed', closed_at = now(), note = '광고 상품으로 전환' where id = $1", [item.id])).code, "23514", "닫은 사람 필수");
    assert.equal((await attempt("update public.separate_product_queue set article_id = $2 where id = $1", [item.id, (await draft()).id])).ok, false, "원고 번호 고정");
    assert.ok((await attempt("update public.separate_product_queue set status = 'closed', closed_by = 'user:x', closed_at = now(), note = '광고·협찬 상품으로 전환' where id = $1", [item.id])).ok);
    const reopen = await attempt("update public.separate_product_queue set status = 'open', closed_by = null, closed_at = null where id = $1", [item.id]);
    assert.match(reopen.message, /닫힌 별도 상품 검토 항목.*고칠 수 없습니다/);
    // anon·authenticated 읽기·쓰기 0 (service_role은 관리자 전체 권한 — admin-rights 시험)
    for (const role of ["anon", "authenticated"]) {
      assert.equal((await attempt("select count(*) from public.separate_product_queue", [], role)).code, "42501", role);
    }
  }));

test("열린 큐 항목 원고는 어떤 유형으로도 공개 0 — 공개 뷰·자체 취재 집계 0, 닫으면 가이드는 발행 · 공개 중 비보도 판정·비보도 공개 행 거부", () =>
  tx(async () => {
    const from = new Date(Date.now() - 3_600_000).toISOString();
    const control = await draft({ editorial_judgement: "news_candidate", ...JUDGED });
    assert.equal((await publishByStages(control.id)).ok, true, "기사 후보는 단계를 밟아 발행");
    const queued = await draft({ editorial_judgement: "travel_review", ...JUDGED });
    const r = await publishByStages(queued.id);
    assert.equal(r.ok, false);
    assert.match(r.message, /보도기사·해설로 발행할 수 없습니다/, "보도기사는 7단계 문장이 먼저");
    const guide = await draft({ content_type: "guide", editorial_judgement: "event_promo", ...JUDGED });
    const g = await publishByStages(guide.id);
    assert.equal(g.ok, false, "가이드도 큐에 열려 있으면 공개 0");
    assert.match(g.message, /별도 상품 검토 큐에 열린 항목\(\d+\)이 있는 원고는 공개할 수 없습니다/);
    const scheduled = await setStatus(guide.id, "scheduled", ", publish_at = now() + interval '1 day'");
    assert.equal(scheduled.ok, false, "예약도 공개");
    // 공개 뷰(사이트맵 원본) · 자체 취재 집계
    const publicSlugs = (await attempt("select slug from public.public_articles where slug = any($1::text[])", [[control.slug, queued.slug, guide.slug]], "anon")).rows.map((x) => x.slug);
    assert.deepEqual(publicSlugs, [control.slug], "공개 뷰에 큐 원고 0");
    const facts = (await one("select public.news_production_facts($1::timestamptz, now() + interval '1 minute') f", [from])).f;
    const counted = (facts.articles ?? []).map((x) => Number(x.id));
    assert.ok(counted.includes(Number(control.id)), "대조 기사는 집계에 1");
    assert.ok(!counted.includes(Number(queued.id)) && !counted.includes(Number(guide.id)), "큐 원고는 자체 취재 집계 0");
    // 검토를 닫으면 가이드는 발행된다 (7단계 비보도 규칙은 보도·해설만)
    await client.query("update public.separate_product_queue set status = 'closed', closed_by = 'user:w4rq-editor', closed_at = now(), note = '가이드로 유지 — 편집 판단' where article_id = $1 and status = 'open'", [guide.id]);
    assert.equal((await publishByStages(guide.id)).ok, true, "닫힌 뒤 가이드 발행");
    // 공개 중인 원고(유형 무관)를 비보도로 판정 — 거부
    const onAir = await attempt("update public.articles set editorial_judgement = 'restaurant_pick', judged_by = 'user:x', judged_at = now() where id = $1", [control.id]);
    assert.match(onAir.message, /먼저 내린 뒤 판정하세요/);
    const g2 = await draft({ content_type: "guide" });
    assert.equal((await publishByStages(g2.id)).ok, true);
    const onAirGuide = await attempt("update public.articles set editorial_judgement = 'event_promo', judged_by = 'user:x', judged_at = now() where id = $1", [g2.id]);
    assert.match(onAirGuide.message, /공개\(예약\) 중인 원고는 .*별도 상품 검토 큐로 보낼 수 없습니다/, "가이드도 공개 중이면 큐로 못 보낸다");
    assert.equal((await queueOf(g2.id)).length, 0);
    // 비보도 판정으로 공개 행을 바로 넣기 — 거부
    const direct = await tryInsert("articles", { slug: uniq("w4rq"), title: "t", section: "local", content_type: "guide", status: "published", region_codes: [SEOUL], editorial_field: "local_tax", public_question: Q, editorial_judgement: "event_promo", ...JUDGED });
    assert.match(direct.message, /별도 상품 검토 큐로 보낼 수 없습니다/);
  }));

test("단계 순서 — 지역 기사 초안·검토 중·보류 → 공개 거부, 편집 승인 없이 승인 거부, 세무 감수 반려 → 승인 거부, 승인 → 공개 통과", () =>
  tx(async () => {
    const a = await draft();
    for (const to of ["published", "scheduled"]) {
      const r = await setStatus(a.id, to, to === "scheduled" ? ", publish_at = now() + interval '1 day'" : "");
      assert.equal(r.ok, false, to);
      assert.match(r.message, /승인 단계를 거쳐야 공개합니다 — 지금 상태\(draft\)/);
    }
    assert.ok((await setStatus(a.id, "in_review")).ok, "초안 → 검토 중(취재 검증)");
    assert.match((await setStatus(a.id, "published")).message, /지금 상태\(in_review\)/);
    const skip = await setStatus(a.id, "approved");
    assert.equal(skip.ok, false);
    assert.match(skip.message, /편집 승인 기록 없이 승인 단계로 갈 수 없습니다/);
    assert.equal((await review(a.id, "desk_edit", "approve")).ok, true);
    assert.equal((await one("select editorial_status from public.articles where id = $1", [a.id])).editorial_status, "approved");
    assert.ok((await setStatus(a.id, "approved")).ok, "편집 승인 뒤 승인");
    const pub = await setStatus(a.id, "published");
    assert.equal(pub.ok, true, pub.message);
    assert.ok(pub.rows[0].first_published_at, "발행일 기록");
    // 편집 보류(held) 상태에서 바로 공개 0
    const held = await draft();
    assert.ok((await review(held.id, "desk_edit", "hold")).ok);
    assert.ok((await setStatus(held.id, "held")).ok);
    assert.match((await setStatus(held.id, "published")).message, /지금 상태\(held\)/);
    // 세무 감수 반려 → 승인 거부 (편집 승인이 있어도)
    const taxed = await draft({ content_type: "explainer" });
    assert.ok((await review(taxed.id, "desk_edit", "approve")).ok);
    assert.ok((await review(taxed.id, "tax_review", "reject")).ok);
    assert.equal((await one("select tax_review_status from public.articles where id = $1", [taxed.id])).tax_review_status, "rejected");
    assert.match((await setStatus(taxed.id, "approved")).message, /세무 감수가 반려·보류된 원고는 승인 단계로 갈 수 없습니다/);
  }));

test("단계 순서 밖 — 지역 기사 아님·광고·협찬·이미 공개된 기사의 다시 공개·새 행 넣기(이관·시드)", () =>
  tx(async () => {
    const tax = await draft({ section: "tax", content_type: "explainer", region_codes: [], editorial_field: null, public_question: null });
    assert.ok((await setStatus(tax.id, "published")).ok, "지역 기사가 아니면 이 규칙 밖");
    const ad = await draft({ content_type: "sponsored", label: "ad" });
    assert.ok((await setStatus(ad.id, "published")).ok, "광고·협찬 제외");
    const republish = await draft({ status: "held", first_published_at: new Date(Date.now() - 86_400_000 * 10) });
    assert.ok((await setStatus(republish.id, "published")).ok, "이미 공개된 기사의 다시 공개");
    const seeded = await tryInsert("articles", { slug: uniq("w4rq"), title: "t", section: "local", content_type: "explainer", status: "published", region_codes: [SEOUL], editorial_field: "local_tax", public_question: Q });
    assert.equal(seeded.ok, true, seeded.message);
    // 지역 태그를 같은 고치기에서 지워 우회해도 거부 (고치기 전·뒤 중 하나라도 지역 기사면 본다)
    const dodge = await draft({ section: "realestate" });
    assert.match((await attempt("update public.articles set status = 'published', region_codes = '{}', editorial_field = null, public_question = null where id = $1", [dodge.id])).message, /승인 단계를 거쳐야/);
  }));

test("AI 초안 역할 ai_drafter — 로그인 0·RLS 우회 0·public 표 쓰기 권한 0, articles·article_sources 쓰기는 권한을 잘못 줘도 RLS가 거부", () =>
  tx(async () => {
    const role = await one("select rolcanlogin, rolbypassrls, rolsuper, rolinherit from pg_roles where rolname = 'ai_drafter'");
    assert.deepEqual(role, { rolcanlogin: false, rolbypassrls: false, rolsuper: false, rolinherit: false });
    const writable = (
      await client.query(
        `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind in ('r', 'v', 'p')
            and (has_table_privilege('ai_drafter', c.oid, 'INSERT') or has_table_privilege('ai_drafter', c.oid, 'UPDATE') or has_table_privilege('ai_drafter', c.oid, 'DELETE'))`,
      )
    ).rows;
    assert.deepEqual(writable, [], "public 표·뷰 쓰기 권한 0");
    for (const table of ["articles", "article_sources"]) {
      const rls = await one("select relrowsecurity from pg_class where oid = $1::regclass", [`public.${table}`]);
      assert.equal(rls.relrowsecurity, true, `${table} RLS 켜짐`);
      const policy = await one("select permissive, roles::text[] r, qual, with_check from pg_policies where schemaname = 'public' and tablename = $1 and policyname = $2", [table, `${table}_ai_drafter_deny`]);
      assert.deepEqual([policy.permissive, policy.r, policy.qual, policy.with_check], ["RESTRICTIVE", ["ai_drafter"], "false", "false"]);
    }
    const a = await draft({ title: "시험용 원래 제목" });
    const src = await insert("article_sources", { article_id: a.id, kind: "other", title: "시험용 출처" });
    // 권한 없음 — 쓰기 모두 42501
    const writes = [
      ["insert into public.articles (slug, title, section, content_type) values ($1, 'AI 초안', 'local', 'reported_news')", [uniq("ai")]],
      ["insert into public.articles (slug, title, section, content_type, status) values ($1, 'AI 공개', 'tax', 'explainer', 'published')", [uniq("ai")]],
      ["update public.articles set title = 'AI가 고친 제목' where id = $1", [a.id]],
      ["delete from public.articles where id = $1", [a.id]],
      ["insert into public.article_sources (article_id, kind, title) values ($1, 'other', 'AI 출처')", [a.id]],
      ["update public.article_sources set title = 'AI' where id = $1", [src.id]],
    ];
    for (const [sql, params] of writes) assert.equal((await attempt(sql, params, "ai_drafter")).code, "42501", sql);
    // 권한을 잘못 준 경우(이 거래 안에서만) — RLS가 넣기를 거부, 고치기·지우기는 보이는 행 0
    await client.query("grant select, insert, update, delete on public.articles, public.article_sources to ai_drafter");
    await client.query("grant usage on all sequences in schema public to ai_drafter");
    await client.query("grant execute on all functions in schema public to ai_drafter");
    for (const [sql, params] of [writes[0], writes[1], writes[4]]) {
      const r = await attempt(sql, params, "ai_drafter");
      assert.equal(r.code, "42501", sql);
      assert.match(r.message, /row-level security/, sql);
    }
    for (const [sql, params] of [writes[2], writes[3], writes[5]]) {
      const r = await attempt(sql, params, "ai_drafter");
      assert.deepEqual([r.ok, r.rowCount], [true, 0], `${sql} — RLS가 행을 숨긴다`);
    }
    assert.equal((await attempt("select count(*)::int n from public.articles", [], "ai_drafter")).rows[0].n, 0, "읽기도 0행");
    assert.equal((await one("select title from public.articles where id = $1", [a.id])).title, "시험용 원래 제목", "원래 행 그대로");
    assert.equal((await one("select title from public.article_sources where id = $1", [src.id])).title, "시험용 출처");
  }));

test("함수 실행 권한 0 — 큐·단계 순서·설정 검사 함수는 anon·authenticated 실행 0", () =>
  tx(async () => {
    for (const fn of ["is_regional_article(public.articles)", "separate_product_queue_guard()", "articles_separate_product_sync()", "articles_stage_order()", "stale_statistics_settings_guard()"]) {
      for (const role of ["anon", "authenticated"]) {
        assert.equal((await one("select has_function_privilege($1, $2, 'execute') ok", [role, `public.${fn}`])).ok, false, `${role} ${fn}`);
      }
    }
  }));
