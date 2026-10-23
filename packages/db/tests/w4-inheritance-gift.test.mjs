// W4 23단계 DB — 상속·증여 안내 (docs/dev/W4_설계.md 1장 23단계 · 2.2 · 2.4 · 11.23, 마이그레이션 20261023000056 · PRD-01B FAM-01·02·08)
//  · 값 — 기능 키 inheritance_gift 씨앗 false · 고지 문구 씨앗 = PRD 문장 · 상황 목록 씨앗 []
//  · 설정 저장 검사 — 고지(글자·1~100자·숫자 0), 상황 목록(배열·4개까지·slug 모양·중복 0·존재·외부 계산기 연결·체크리스트 고지)
//  · 상황 공개 검사 — 목록에 든 상황은 연결·고지 없이 공개 불가, 목록에 없는 상황은 그대로
//  · 공개 뷰 — 기능 키 꺼짐 0행, 켜짐 + 세무 감수 승인 + 해설 + 하위 분야 일치만, 최종 감수일은 가장 늦은 승인
//  · anon — 두 설정 키 읽기, 뷰 읽기
// 모든 시험은 거래 안에서 돌고 되돌린다 (남는 행 0). 상황·기사 내용은 시험용 가짜다.
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
const setSetting = (key, value) => attempt("update public.settings set value = $2::jsonb where key = $1 returning key", [key, JSON.stringify(value)]);
const flag = (on) => client.query("update public.settings set value = value || $1::jsonb where key = 'feature_flags'", [JSON.stringify({ inheritance_gift: on })]);
const CHECKLIST = { items: ["시험용 항목"], notice: "시험용 고지" };
const linkId = async (key = "inheritance_gift", kind = "external_calculator") => Number((await one("select id from public.official_links where kind = $1 and key = $2", [kind, key])).id);
async function situation(over = {}) {
  const row = { slug: `w4ig-${process.pid}-${++seq}`, section: "realestate", title: "시험용 상속 상황", pictogram: "home", checklist: JSON.stringify(CHECKLIST), external_link_id: await linkId(), ...over };
  const keys = Object.keys(row);
  const r = await attempt(`insert into public.situations (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, keys.map((k) => row[k]));
  return { ...r, slug: row.slug };
}

test("값 — 기능 키 inheritance_gift 씨앗 false · 고지 문구 씨앗 = PRD 문장 · 상황 목록 씨앗 빈 목록", async () => {
  const f = (await one("select value from public.settings where key = 'feature_flags'")).value;
  assert.equal(f.inheritance_gift, false);
  assert.equal((await one("select value from public.settings where key = 'inheritance_gift_notice'")).value, "상속세·증여세는 이 사이트에서 계산하지 않습니다");
  assert.deepEqual((await one("select value from public.settings where key = 'inheritance_gift_situations'")).value, []);
});

test("고지 문구 저장 검사 — 글자만 · 1~100자 · 숫자 거부 · 정상 값 저장", () =>
  tx(async () => {
    for (const bad of [123, null, ["a"], "", "   ", "가".repeat(101), "공제 3억 원"]) {
      const r = await setSetting("inheritance_gift_notice", bad);
      assert.equal(r.ok, false, `거부돼야 함: ${JSON.stringify(bad)}`);
      assert.equal(r.code, "23514");
    }
    assert.ok((await setSetting("inheritance_gift_notice", "시험용 고지 문구")).ok);
    assert.ok((await setSetting("inheritance_gift_notice", "가".repeat(100))).ok, "100자 경계 통과");
  }));

test("상황 목록 저장 검사 — 배열 아님·5개·slug 모양·중복·없는 상황 거부 / 빈 목록 통과", () =>
  tx(async () => {
    assert.ok((await setSetting("inheritance_gift_situations", [])).ok);
    for (const bad of ["a", { a: 1 }, ["Bad_Slug"], [1], ["a-1", "a-1"], ["no-such-situation-xyz"], ["a", "b", "c", "d", "e"]]) {
      const r = await setSetting("inheritance_gift_situations", bad);
      assert.equal(r.ok, false, `거부돼야 함: ${JSON.stringify(bad)}`);
      assert.equal(r.code, "23514");
    }
  }));

test("상황 목록 — 외부 계산기 연결·체크리스트 고지·부동산 분야가 없는 상황은 목록에 못 든다 / 갖춘 상황은 든다(4개 경계)", () =>
  tx(async () => {
    const noLink = await situation({ external_link_id: null });
    const wrongLink = await situation({ external_link_id: await linkId("acquisition", "sm_calculator") });
    const noChecklist = await situation({ checklist: null });
    const otherSection = await situation({ section: "tax" });
    for (const [s, word] of [[noLink, "외부 계산기 연결"], [wrongLink, "외부 계산기 연결"], [noChecklist, "체크리스트 고지"], [otherSection, "부동산 분야"]]) {
      assert.ok(s.ok, s.message);
      const r = await setSetting("inheritance_gift_situations", [s.slug]);
      assert.equal(r.ok, false);
      assert.match(r.message, new RegExp(word));
    }
    const good = [];
    for (let i = 0; i < 4; i++) good.push((await situation()).slug);
    assert.ok((await setSetting("inheritance_gift_situations", good)).ok, "갖춘 상황 4개 통과");
  }));

test("상황 공개 검사 — 목록에 든 상황은 연결·고지 없이 공개 불가 / 목록 밖 상황과 비공개 저장은 그대로", () =>
  tx(async () => {
    const good = await situation();
    assert.ok((await setSetting("inheritance_gift_situations", [good.slug])).ok);
    const pubFields = "visible = true, reviewer_id = $2, reviewed_at = now(), checks = $3::jsonb";
    const person = await one("insert into public.people (name, slug, roles) values ('시험용 감수자', 'w4ig-rv-' || txid_current(), '{reviewer}') returning id");
    const checks = JSON.stringify([{ title: "가" }, { title: "나" }, { title: "다" }]);
    // 갖춘 상황은 공개된다
    assert.ok((await attempt(`update public.situations set ${pubFields} where slug = $1 returning id`, [good.slug, person.id, checks])).ok);
    // 공개된 목록 상황의 연결·고지를 지우는 고침은 거부
    for (const set of ["external_link_id = null", "checklist = null"]) {
      const r = await attempt(`update public.situations set ${set} where slug = $1`, [good.slug]);
      assert.equal(r.ok, false, set);
      assert.equal(r.code, "23514");
      assert.match(r.message, /공개 전에 갖춰야/);
    }
    // 목록 밖 상황은 연결 없이도 공개 가능 (달라진 것 없음)
    const outside = await situation({ external_link_id: null, checklist: null });
    assert.ok((await attempt(`update public.situations set ${pubFields} where slug = $1 returning id`, [outside.slug, person.id, checks])).ok);
    // 목록에 들어 있지만 비공개인 상황은 비공개로 고칠 수 있다
    const hidden = await situation();
    assert.ok((await setSetting("inheritance_gift_situations", [good.slug, hidden.slug])).ok);
    assert.ok((await attempt("update public.situations set external_link_id = null where slug = $1 returning id", [hidden.slug])).ok, "비공개는 막지 않는다");
    // 목록에 든 상황을 연결 없이 새로 공개 삽입 → 거부
    await setSetting("inheritance_gift_situations", [good.slug]);
    const ins = await situation({ slug: "w4ig-new-public", external_link_id: null, visible: true, reviewer_id: person.id, reviewed_at: new Date().toISOString(), checks });
    assert.ok(ins.ok, "목록에 없는 slug라 통과");
  }));

async function article(over = {}) {
  const cat = await one("select id from public.categories where section = 'realestate' and slug = 'inheritance-gift'");
  const row = { slug: `w4ig-art-${process.pid}-${++seq}`, title: "시험용 입문 기사", section: "realestate", content_type: "explainer", status: "published", category_id: cat.id, tax_review_status: "approved", first_published_at: new Date().toISOString(), ...over };
  const keys = Object.keys(row);
  const r = await one(`insert into public.articles (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, keys.map((k) => row[k]));
  return Number(r.id);
}
const review = (articleId, personId, decision, at) =>
  client.query("insert into public.editorial_reviews (article_id, kind, reviewer_id, decision, at) values ($1, 'tax_review', $2, $3, $4)", [articleId, personId, decision, at]);
const viewIds = async () => (await client.query("select article_id from public.public_inheritance_intro order by article_id")).rows.map((r) => Number(r.article_id));

test("공개 뷰 — 키 꺼짐 0행 · 켜짐 + 세무 감수 승인된 해설만 · 최종 감수일 = 가장 늦은 승인", () =>
  tx(async () => {
    await client.query("set local session_replication_role = replica"); // 시험 기사·승인 기록을 직접 넣는다(발행 절차는 다른 시험 몫)
    const person = await one("insert into public.people (name, slug, roles) values ('시험용 감수자', 'w4ig-rv-' || txid_current(), '{reviewer}') returning id");
    const ok = await article();
    const pending = await article({ tax_review_status: "pending" });
    const notExplainer = await article({ content_type: "guide" });
    const draft = await article({ status: "draft" });
    const otherCat = await article({ category_id: (await one("select id from public.categories where section = 'realestate' and slug = 'columns'")).id });
    const noRecord = await article();
    await review(ok, person.id, "approve", "2026-09-01T03:00:00Z");
    await review(ok, person.id, "approve", "2026-10-05T03:00:00Z");
    await review(ok, person.id, "hold", "2026-10-20T03:00:00Z");
    for (const id of [pending, notExplainer, draft, otherCat]) await review(id, person.id, "approve", "2026-10-01T03:00:00Z");
    await flag(false);
    assert.deepEqual(await viewIds(), [], "키 꺼짐 — 0행");
    await flag(true);
    assert.deepEqual(await viewIds(), [ok], "승인 전·해설 아님·비공개·다른 하위 분야·승인 기록 없음은 0행");
    const row = await one("select reviewed_at from public.public_inheritance_intro where article_id = $1", [ok]);
    assert.equal(new Date(row.reviewed_at).toISOString(), "2026-10-05T03:00:00.000Z");
    assert.ok(noRecord > 0);
  }));

test("anon — 두 설정 키와 뷰는 읽고 다른 설정 키는 못 읽는다", () =>
  tx(async () => {
    await client.query("set local role anon");
    try {
      const keys = (await client.query("select key from public.settings where key in ('inheritance_gift_notice', 'inheritance_gift_situations') order by key")).rows.map((r) => r.key);
      assert.deepEqual(keys, ["inheritance_gift_notice", "inheritance_gift_situations"]);
      assert.equal((await client.query("select count(*)::int n from public.settings where key = 'forbidden_phrases'")).rows[0].n, 0);
      assert.ok((await attempt("select count(*) from public.public_inheritance_intro")).ok);
    } finally {
      await client.query("reset role");
    }
  }));

test("기능 키 켜기 조건(26단계) — 승인된 입문 기사 없으면 켜기 거부 · 승인 전·다른 하위 분야·비공개·승인 기록 없음도 거부 · 승인되면 켜짐 · 끄기와 이미 켜진 값은 검사 0", () =>
  tx(async () => {
    await client.query("set local session_replication_role = replica");
    await client.query("update public.settings set value = value || '{\"inheritance_gift\": false}'::jsonb where key = 'feature_flags'");
    const turnOn = () => attempt("update public.settings set value = value || '{\"inheritance_gift\": true}'::jsonb where key = 'feature_flags' returning key");
    await client.query("set local session_replication_role = origin"); // 켜기 검사 트리거를 보려면 트리거를 켠 채로
    const base = await turnOn();
    assert.equal(base.ok, false, "입문 기사 0건이면 거부");
    assert.match(base.message, /세무 감수가 승인된 입문 기사/);
    await client.query("set local session_replication_role = replica");
    const person = await one("insert into public.people (name, slug, roles) values ('시험용 감수자', 'w4ig-gate-' || txid_current(), '{reviewer}') returning id");
    const pending = await article({ tax_review_status: "pending" });
    const draft = await article({ status: "draft" });
    const other = await article({ category_id: (await one("select id from public.categories where section = 'realestate' and slug = 'columns'")).id });
    const noRecord = await article();
    for (const id of [pending, draft, other]) await review(id, person.id, "approve", "2026-10-01T03:00:00Z");
    assert.ok(noRecord > 0);
    await client.query("set local session_replication_role = origin");
    const gate = (await one("select public.inheritance_gift_gate_missing() as m")).m;
    assert.match(gate ?? "", /세무 감수가 승인된 입문 기사/, "승인 전·비공개·다른 하위 분야·승인 기록 없음은 조건을 채우지 못한다");
    assert.equal((await turnOn()).ok, false);
    await client.query("set local session_replication_role = replica");
    const ok = await article();
    await review(ok, person.id, "approve", "2026-10-05T03:00:00Z");
    await client.query("set local session_replication_role = origin");
    assert.equal((await one("select public.inheritance_gift_gate_missing() as m")).m, null);
    assert.ok((await turnOn()).ok, "승인된 입문 기사 + 고지가 있으면 켜짐");
    assert.ok((await attempt("update public.settings set value = value || '{\"inheritance_gift\": true, \"sm_calculator\": false}'::jsonb where key = 'feature_flags' returning key")).ok, "이미 켜진 값은 검사 0");
    assert.ok((await attempt("update public.settings set value = value || '{\"inheritance_gift\": false}'::jsonb where key = 'feature_flags' returning key")).ok, "끄기 검사 0");
  }));
