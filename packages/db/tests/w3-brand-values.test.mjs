// W3 7단계 값 목록 — docs/dev/W3_설계.md 2장 표와 DB가 같다 (w2e-values와 같은 방식 — 문서를 읽어 대조한다)
//  2.1 people_evidence.kind · consent_doc.scope · consent_doc.status · article_review_marks.state — 표의 값은 받고(또는 나오고) 표 밖 값은 check 위반(23514)
//  2.2 설정 씨앗 career_claim_approved · brand_copy_review — 설계 표의 초기값과 DB 값이 같다
//  2.4 새 기능 키 people_pages · brand_copy — 씨앗 false
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

const DESIGN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "dev", "W3_설계.md");
const MD = fs.readFileSync(DESIGN, "utf8");

function section(no) {
  const sec = MD.split(/^## /m).find((s) => s.startsWith("2. 값 목록"));
  assert.ok(sec, "설계 문서 2장을 찾지 못했다");
  const sub = sec.split(/^### /m).find((s) => s.startsWith(no));
  assert.ok(sub, `설계 문서 ${no} 소절이 없다`);
  return sub;
}
const ticks = (s) => [...s.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
const rowsOf = (sub) => sub.split("\n").filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l)).map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
/** 2.1 — 이름 칸에 name이 든 행의 값 칸 */
function values(name) {
  const row = rowsOf(section("2.1")).find(([n]) => n.split(/[\s(`)]+/).includes(name));
  assert.ok(row, `설계 2.1에 '${name}'이 없다`);
  const v = ticks(row[1]);
  assert.ok(v.length, `설계 2.1 '${name}' 값이 없다`);
  return v;
}
/** 2.2 — 키 행의 초기값 칸 `{a:false, b:null}` → 객체 */
function seed(key) {
  const row = rowsOf(section("2.2")).find(([k]) => ticks(k).includes(key));
  assert.ok(row, `설계 2.2에 ${key}가 없다`);
  const literal = ticks(row[1]).find((t) => t.startsWith("{"));
  assert.ok(literal, `설계 2.2 ${key} 초기값이 없다`);
  return JSON.parse(literal.replace(/([{,]\s*)([a-z_]+)\s*:/g, '$1"$2":'));
}
/** 2.4 — 새 기능 키 (화면 칸 앞의 키 칸에서 (신규) 표시가 있는 것) */
const newFlags = () => rowsOf(section("2.4")).slice(1).filter(([k]) => k.includes("신규")).flatMap(([k]) => ticks(k));

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
async function attempt(sql, params = []) {
  await client.query("savepoint t");
  try {
    const res = await client.query(sql, params);
    await client.query("release savepoint t");
    return { ok: true, rows: res.rows };
  } catch (err) {
    await client.query("rollback to savepoint t");
    return { ok: false, code: err.code, message: err.message };
  }
}
let seq = 0;
const uniq = (p) => `${p}-${process.pid}-${++seq}`;
const person = async () => Number((await client.query("insert into public.people (slug, name, roles, visibility) values ($1, '시험용', '{writer}', 'public') returning id", [uniq("val-p")])).rows[0].id);
const ago = (hours) => new Date(Date.now() - hours * 3_600_000).toISOString();

test("설계 문서 2장의 7단계 값을 모두 읽었다", () => {
  assert.deepEqual(values("people_evidence.kind"), ["document", "official_record", "publisher_history"]);
  assert.equal(values("consent_doc.scope").length, 7);
  assert.deepEqual(values("consent_doc.status"), ["active", "withdrawn", "expired"]);
  assert.deepEqual(values("article_review_marks.state"), ["shown", "hidden_changed", "none"]);
  assert.deepEqual(newFlags().filter((k) => ["people_pages", "brand_copy"].includes(k)), ["people_pages", "brand_copy"]);
});

test("2.1 people_evidence.kind — 표의 값은 받고 표 밖 값은 거부", () =>
  tx(async () => {
    const p = await person();
    const ins = "insert into public.people_evidence (person_id, kind, doc_ref, recorded_by) values ($1, $2, '시험용 위치', 'admin:test')";
    for (const kind of values("people_evidence.kind")) assert.ok((await attempt(ins, [p, kind])).ok, kind);
    assert.equal((await attempt(ins, [p, "photo"])).code, "23514");
  }));

test("2.1 consent_doc.scope — 표의 값 하나씩·전부 받고 표 밖 값은 거부", () =>
  tx(async () => {
    const p = await person();
    const ins = "insert into public.name_likeness_consents (person_id, version, scope, doc_ref, recorded_by) values ($1, $2, $3, '시험용 위치', 'admin:test')";
    const scopes = values("consent_doc.scope");
    for (const s of scopes) assert.ok((await attempt(ins, [p, uniq(s), [s]])).ok, s);
    assert.ok((await attempt(ins, [p, uniq("all"), scopes])).ok);
    assert.equal((await attempt(ins, [p, uniq("x"), ["newsletter"]])).code, "23514");
  }));

test("2.1 consent_doc.status — 관리용 뷰가 내는 상태 값 = 표의 값", () =>
  tx(async () => {
    const ins = "insert into public.name_likeness_consents (person_id, version, scope, doc_ref, recorded_by, valid_from, valid_to) values ($1, $2, '{column}', '시험용 위치', 'admin:test', $3, $4) returning id";
    const active = Number((await client.query(ins, [await person(), "v", ago(2), null])).rows[0].id);
    const expired = Number((await client.query(ins, [await person(), "v", ago(48), ago(1)])).rows[0].id);
    const withdrawn = Number((await client.query(ins, [await person(), "v", ago(2), null])).rows[0].id);
    await client.query("update public.name_likeness_consents set withdrawn_at = now(), withdrawn_by = 'admin:test' where id = $1", [withdrawn]);
    const rows = (await client.query("select id, status from public.name_consent_docs where id = any($1::bigint[])", [[active, expired, withdrawn]])).rows;
    const byId = new Map(rows.map((r) => [Number(r.id), r.status]));
    assert.deepEqual([byId.get(active), byId.get(withdrawn), byId.get(expired)], values("consent_doc.status"));
  }));

test("2.1 article_review_marks.state — 뷰가 내는 상태 값 = 표의 값", () =>
  tx(async () => {
    const reviewer = await person();
    const art = async () => Number((await client.query("insert into public.articles (slug, title, section, content_type, status) values ($1, '시험용', 'tax', 'explainer', 'published') returning id", [uniq("val-a")])).rows[0].id);
    const shown = await art();
    const changed = await art();
    const none = await art();
    for (const a of [shown, changed]) await client.query("insert into public.editorial_reviews (article_id, version, kind, reviewer_id, decision, at) values ($1, 1, 'tax_review', $2, 'approve', $3)", [a, reviewer, ago(3)]);
    await client.query("insert into public.article_revisions (article_id, version, title, body, edited_by, reason, update_kind) values ($1, 2, '시험용', '{}'::jsonb, 'admin:test', '시험용', 'substantive')", [changed]);
    const rows = (await client.query("select article_id, state from public.article_review_marks where article_id = any($1::bigint[])", [[shown, changed, none]])).rows;
    const byId = new Map(rows.map((r) => [Number(r.article_id), r.state]));
    assert.deepEqual([byId.get(shown), byId.get(changed), byId.get(none)], values("article_review_marks.state"));
  }));

test("2.2 설정 씨앗 — career_claim_approved · brand_copy_review 초기값이 설계 표와 같다", async () => {
  for (const key of ["career_claim_approved", "brand_copy_review"]) {
    const { rows } = await client.query("select value from public.settings where key = $1", [key]);
    assert.equal(rows.length, 1, key);
    assert.deepEqual(rows[0].value, seed(key), key);
  }
});

test("2.4 새 기능 키 people_pages · brand_copy — 씨앗 false", async () => {
  const { rows } = await client.query("select value from public.settings where key = 'feature_flags'");
  for (const k of ["people_pages", "brand_copy"]) assert.equal(rows[0].value[k], false, k);
});
