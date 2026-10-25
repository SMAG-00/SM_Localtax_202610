// W10-h DB - 금융 사례 DB (마이그레이션 101, PRD-02 DF-07 · DF-06)
//  · 공개 규칙 - 쟁점·결과·출처 1건·기준일, 실명 기업은 반론 요청일+답변 상태, 회신 없음은 대기 기간 뒤, 판결문 인용은 비실명 확인
//  · 글자 규칙 - 투자 권유·수익 암시 거부, 출처 주소 모양, 미래 기준일, 없는 기사 번호
//  · 공개 뷰 - 기능 키 finance·field_data 둘 다 켜져야, draft 는 0, 내부 칸(반론 메모·번호·작성자) 0, 구조 유형 필터 결과가 모두 그 유형
//  · 수집 후보(DF-06) 승인 -> draft 로 들어오고 공개 뷰 0, 반론 기록을 채운 뒤 공개하면 보임
//  · 가격 칸 검사 - 가격 사전 낱말이 든 칸 0 (검사 스크립트와 같은 함수)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup, sha } from "./_w10h_helpers.mjs";
import { scanPriceFields } from "../scripts/check-price-fields.mjs";

let s;
before(async () => {
  s = await setup();
});
after(async () => s?.client?.end());

const entry = (over = {}) => {
  const row = {
    slug: s.h.uniq("fixture-case"), title: "시험용 사례", structure_type: "completion_guarantee", issues: ["시험용 쟁점 가"], outcome: "시험용 결과 문장입니다.",
    as_of: "2026-09-30", sources: JSON.stringify([{ label: "시험용 출처", url: "https://example.test/src/1" }]), created_by: "user:w10h", updated_by: "user:w10h", ...over,
  };
  const keys = Object.keys(row);
  return s.h.attempt(`insert into public.finance_case_entries (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}${keys[i] === "sources" ? "::jsonb" : ""}`).join(", ")}) returning *`, keys.map((k) => row[k]));
};
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

test("draft 는 자유롭게 저장되지만 공개는 쟁점·결과·출처·기준일 규칙을 따른다", () =>
  s.h.tx(async () => {
    assert.equal((await entry({ status: "draft", issues: [], outcome: null, sources: "[]" })).ok, true);
    for (const [name, over, re] of [["쟁점 없음", { issues: [] }, /쟁점 1개 이상/], ["결과 없음", { outcome: null }, /결과/], ["출처 없음", { sources: "[]" }, /출처 1건 이상/]]) {
      const r = await entry({ status: "public", ...over });
      assert.equal(r.ok, false, name);
      assert.match(r.message, re, name);
    }
    assert.equal((await entry({ status: "public" })).ok, true);
  }));

test("글자·출처·날짜 규칙 - 투자 권유 거부, 출처 주소 모양, 미래 기준일, 없는 기사 번호", () =>
  s.h.tx(async () => {
    const bad = [
      ["투자 권유", { issues: ["지금 가입하세요"] }, /금지 표현/],
      ["출처 주소 아님", { sources: JSON.stringify([{ label: "시험용", url: "주소 아님" }]) }, /주소|http|url/i],
      ["출처 이름 없음", { sources: JSON.stringify([{ label: "", url: "https://example.test/x" }]) }, /이름/],
      ["미래 기준일", { as_of: "2999-01-01" }, /기준일/],
      ["없는 기사 번호", { article_ids: [999999999] }, /기사 번호/],
      ["쟁점 9개", { issues: ["a", "b", "c", "d", "e", "f", "g", "h", "i"] }, /issues|check/],
    ];
    for (const [name, over, re] of bad) {
      const r = await entry(over);
      assert.equal(r.ok, false, name);
      assert.match(r.message, re, name);
    }
  }));

test("실명 기업이 있으면 반론 요청일과 답변 상태 없이 공개 0, 회신 없음은 대기 기간(기본 7일) 뒤에만", () =>
  s.h.tx(async () => {
    const pub = { status: "public", companies: ["시험용 주식회사"] };
    let r = await entry(pub);
    assert.equal(r.ok, false);
    assert.match(r.message, /반론 요청일과 답변 상태/);
    r = await entry({ ...pub, rebuttal_requested_on: daysAgo(30) });
    assert.equal(r.ok, false, "요청일만 있고 답변 상태가 없다");
    r = await entry({ ...pub, rebuttal_requested_on: daysAgo(3), rebuttal_status: "no_response" });
    assert.equal(r.ok, false);
    assert.match(r.message, /회신 없음/);
    assert.equal((await entry({ ...pub, rebuttal_requested_on: daysAgo(30), rebuttal_status: "no_response" })).ok, true);
    assert.equal((await entry({ ...pub, rebuttal_requested_on: daysAgo(1), rebuttal_status: "answered" })).ok, true);
    assert.equal((await entry({ ...pub, rebuttal_requested_on: daysAgo(1), rebuttal_status: "declined" })).ok, true);
    assert.equal((await entry({ status: "draft", companies: ["시험용 주식회사"] })).ok, true, "draft 는 반론 기록 없이 저장 가능");
    const noPair = await entry({ rebuttal_status: "answered" });
    assert.equal(noPair.ok, false, "답변 상태만 있고 요청일이 없다");
  }));

test("판결문 인용 사례는 비실명 확인 없이 공개 0", () =>
  s.h.tx(async () => {
    const r = await entry({ status: "public", judgment_quoted: true });
    assert.equal(r.ok, false);
    assert.match(r.message, /비실명 확인/);
    assert.equal((await entry({ status: "public", judgment_quoted: true, anonymized_checked: true })).ok, true);
  }));

test("공개 뷰 - 기능 키 두 개가 모두 켜져야 보이고 draft 는 0, 내부 칸이 없고, 구조 유형 필터 결과는 모두 그 유형", () =>
  s.h.tx(async () => {
    await entry({ slug: "fixture-a", status: "public", structure_type: "trust", rebuttal_note: "내부 메모" });
    await entry({ slug: "fixture-b", status: "public", structure_type: "completion_guarantee" });
    await entry({ slug: "fixture-c", status: "draft", structure_type: "trust" });
    const view = "select slug, structure_type from public.public_finance_case_entries where slug like 'fixture-%' order by slug";
    await s.setFlags({ finance: true, field_data: false });
    assert.equal((await s.client.query(view)).rowCount, 0);
    await s.setFlags({ finance: false, field_data: true });
    assert.equal((await s.client.query(view)).rowCount, 0);
    await s.setFlags({ finance: true, field_data: true });
    assert.deepEqual((await s.client.query(view)).rows.map((r) => r.slug), ["fixture-a", "fixture-b"]);
    const filtered = (await s.client.query("select structure_type from public.public_finance_case_entries where slug like 'fixture-%' and structure_type = 'completion_guarantee'")).rows;
    assert.ok(filtered.length > 0 && filtered.every((r) => r.structure_type === "completion_guarantee"));
    const cols = (await s.client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'public_finance_case_entries'")).rows.map((r) => r.column_name);
    for (const hidden of ["rebuttal_note", "created_by", "updated_by", "source_key", "source_item_id", "source_value_hash", "snapshot_id", "status"]) assert.equal(cols.includes(hidden), false, hidden);
    for (const shown of ["license_type", "source_name", "checked_on", "as_of", "sources"]) assert.equal(cols.includes(shown), true, shown);
    assert.equal((await s.h.attempt("select * from public.public_finance_case_entries", [], "anon")).ok, true);
    assert.equal((await s.h.attempt("select * from public.finance_case_entries", [], "anon")).ok, false);
    assert.equal((await s.h.attempt("insert into public.finance_case_entries (slug, title, structure_type, as_of, created_by, updated_by) values ('x', 'x', 'trust', current_date, 'a', 'a')", [], "anon")).ok, false);
  }));

test("수집 후보(DF-06) 승인 -> draft 로 들어오고 공개 0, 반론 기록을 채운 뒤 공개하면 공개 뷰에 보인다", () =>
  s.h.tx(async () => {
    await s.allowSource("pf_integrated_info");
    await s.setFlags({ finance: true, field_data: true });
    const fields = {
      slug: "fixture-collected", title: "시험용 수집 사례", structure_type: "pf_stage", issues: ["시험용 쟁점 가"], outcome: "시험용 결과 문장입니다.", as_of: "2026-09-30", released_on: "2026-10-01",
      sources: [{ label: "시험용 출처", url: "https://example.test/src/9" }], companies: ["시험용 주식회사"],
    };
    const bads = [
      ["발표일 없음", { released_on: "" }, /released_on/], ["기준일 없음", { as_of: "" }, /as_of/], ["출처 없음", { sources: [] }, /sources/],
      ["판결문 비실명 확인 없음", { judgment_quoted: true }, /비실명 확인/], ["주민번호 모양", { outcome: "시험용 900101-1234567 결과" }, /주민등록번호/], ["수익률 순위", { outcome: "수익률 1위 사례" }, /금지 표현/],
      ["가격 칸", { sale_price: "시험용" }, /허용되지 않은 칸/],
    ];
    for (const [name, over, re] of bads) {
      const item = await s.candidate({ source: "pf_integrated_info", target: "finance_case_entry", fields: { ...fields, ...over } });
      const a = await s.approve(item.id);
      assert.equal(a.ok, false, name);
      assert.match(a.message, re, name);
    }
    const good = await s.candidate({ source: "pf_integrated_info", target: "finance_case_entry", fields, itemId: "CASE-1", hash: sha("case-1") });
    assert.equal((await s.approve(good.id)).ok, true);
    const res = await s.publish(good.id);
    assert.equal(res.ok, true, res.message);
    const row = await s.h.one("select * from public.finance_case_entries where source_item_id = 'CASE-1'");
    assert.deepEqual([row.status, row.license_type, row.companies], ["draft", "kogl_1", ["시험용 주식회사"]]);
    const view = "select slug, source_name, license_type from public.public_finance_case_entries where slug = 'fixture-collected'";
    assert.equal((await s.client.query(view)).rowCount, 0, "승인만으로는 공개되지 않는다");

    const early = await s.h.attempt("update public.finance_case_entries set status = 'public' where id = $1", [row.id]);
    assert.equal(early.ok, false);
    assert.match(early.message, /반론 요청일과 답변 상태/);
    await s.client.query("update public.finance_case_entries set status = 'public', rebuttal_requested_on = $2, rebuttal_status = 'answered' where id = $1", [row.id, daysAgo(2)]);
    const shown = (await s.client.query(view)).rows;
    assert.equal(shown.length, 1);
    assert.deepEqual([shown[0].source_name, shown[0].license_type], ["PF 통합정보 공개분", "kogl_1"]);
  }));

test("가격 칸 검사 - 대상 표와 공개 뷰에 가격 사전 낱말이 든 칸·칸 설명 0 (새 원천 칸 포함)", async () => {
  const r = await scanPriceFields(s.client);
  for (const rel of ["project_events", "supply_notices", "public_supply_notices"]) assert.ok(r.relations.includes(rel), rel);
  assert.deepEqual(r.hits, []);
  const cols = (await s.client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'supply_notices'")).rows.map((x) => x.column_name);
  for (const c of ["source_key", "source_item_id", "source_value_hash"]) assert.ok(cols.includes(c), c);
});

test("본문 해시 함수 - 같은 글자는 같은 해시, 대상별 공개 본문(지표 정의·사례 결과+쟁점)이 정해진 규칙으로 만들어진다", async () => {
  const one = (sql, p) => s.h.one(sql, p).then((r) => r.v);
  assert.equal(await one("select public.field_body_hash('가나다') v"), sha("가나다"));
  assert.equal(await one("select public.field_body_hash('가나다') v"), await one("select public.field_body_hash('가나다') v"));
  assert.equal(await one("select public.field_body_text($1::jsonb) v", [JSON.stringify({ target: "finance_indicator", fields: { definition: "  정의  " } })]), "정의");
  assert.equal(await one("select public.field_body_text($1::jsonb) v", [JSON.stringify({ target: "finance_case_entry", fields: { outcome: "결과", issues: ["쟁점1", "쟁점2"] } })]), "결과\n쟁점1\n쟁점2");
  assert.equal(await one("select public.field_body_text($1::jsonb) v", [JSON.stringify({ target: "supply_notice", fields: { name: "사업" } })]), null);
});
