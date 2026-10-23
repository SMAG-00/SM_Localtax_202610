// 행정구역 regions (PRD-01B REG1-01) · 기사 지역 태그 (PRD-01A CAT-03) — docs/dev/W2-b_설계.md 3장
// ① 씨앗 = 시·도 17곳(시·군·구 0) ② 자기 자신·자기 하위를 부모로 둔 행 거부 ③ 시·군·구의 부모는 시·도
// ④ (parent_code, slug) unique — 시·도끼리도 ⑤ 코드 형식 ⑥ 하위가 있는 행의 단계 변경 거부
// ⑦ 기사 지역 태그: 없는 코드 거부, 폐지·시작 전 코드는 새로 못 단다, 이미 단 코드는 폐지돼도 남는다, 쓰는 코드는 못 지운다
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

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
    return { ok: false, message: err.message, code: err.code };
  }
}

let seq = 0;
const uniq = (p) => `${p}-${process.pid}-${++seq}`;
function insertSql(table, cols) {
  const keys = Object.keys(cols);
  return { sql: `insert into public.${table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, params: keys.map((k) => cols[k]) };
}
const insert = async (table, cols) => {
  const { sql, params } = insertSql(table, cols);
  return (await client.query(sql, params)).rows[0];
};
const tryInsert = (table, cols) => {
  const { sql, params } = insertSql(table, cols);
  return attempt(sql, params);
};

const SEOUL = "1100000000";
const BUSAN = "2600000000";
const gu = (code, over = {}) => ({ code, parent_code: SEOUL, level: "sigungu", name: "시험구", slug: uniq("gu"), ...over });
/** 한국 날짜 YYYY-MM-DD (오늘 + days) */
const kstDay = (days = 0) => new Date(Date.now() + 9 * 3600_000 + days * 86_400_000).toISOString().slice(0, 10);
const article = (over = {}) => insert("articles", { slug: uniq("a"), title: "지역 기사", section: "local", content_type: "explainer", ...over });

test("씨앗 — 시·도 17곳(+ W4 2단계 통합 신설 1곳), 코드·slug가 서로 다르고 모두 부모 없는 시·도 단계다", async () => {
  const { rows } = await client.query("select code, parent_code, level, name, slug, aliases from public.regions where code !~ '^9' order by code");
  const sido = rows.filter((r) => r.level === "sido");
  assert.equal(sido.length, 18, JSON.stringify(sido.map((r) => r.name)));
  assert.ok(sido.some((r) => r.code === "1200000000" && r.name === "전남광주통합특별시"), "W4 2단계 전국 적재가 더한 통합 신설 시·도(마이그레이션 20261024000062)");
  // 시·군·구는 W4 전국 적재(…62)가 넣는다 — 씨앗(…09)에는 없다. 여기서는 모두 시·도 아래인지만 본다
  assert.ok(rows.filter((r) => r.level === "sigungu").every((r) => sido.some((s) => s.code === r.parent_code)));
  assert.ok(sido.every((r) => r.parent_code === null && /^\d{2}0{8}$/.test(r.code)));
  assert.equal(new Set(sido.map((r) => r.slug)).size, 18);
  assert.equal(new Set(sido.map((r) => r.name)).size, 18);
  const byName = Object.fromEntries(sido.map((r) => [r.name, r]));
  assert.equal(byName["서울특별시"].code, "1100000000");
  assert.equal(byName["강원특별자치도"].code, "5100000000", "강원특별자치도 — 옛 강원도(42) 아님");
  assert.equal(byName["전북특별자치도"].code, "5200000000", "전북특별자치도 — 옛 전라북도(45) 아님");
  assert.ok(byName["강원특별자치도"].aliases.includes("강원도"), "옛 공식 이름도 별칭으로 찾는다");
  assert.ok(!sido.some((r) => r.aliases.includes("광주시")), "경기도 광주시와 겹치는 별칭은 넣지 않는다");
});

test("시·군·구는 시·도 아래에만 — 부모 없음·없는 부모·시·군·구 부모 거부, 앞 2자리가 다른 코드 거부", () =>
  tx(async () => {
    const ok = await insert("regions", gu("1199000000"));
    assert.equal(ok.parent_code, SEOUL);
    const noParent = await tryInsert("regions", gu("1199100000", { parent_code: null }));
    assert.equal(noParent.ok, false);
    assert.equal(noParent.code, "23514", noParent.message);
    const missing = await tryInsert("regions", gu("1199200000", { parent_code: "1300000000" }));
    assert.equal(missing.ok, false, "없는 부모");
    assert.match(missing.message, /부모는 시·도/);
    const underGu = await tryInsert("regions", gu("1199300000", { parent_code: ok.code }));
    assert.equal(underGu.ok, false);
    assert.match(underGu.message, /부모는 시·도/);
    const otherPrefix = await tryInsert("regions", gu("2699000000"));
    assert.equal(otherPrefix.ok, false, "서울 아래에 부산(26) 코드");
    assert.equal(otherPrefix.code, "23514");
    const sidoWithParent = await tryInsert("regions", { code: "9700000000", parent_code: SEOUL, level: "sido", name: "x", slug: uniq("s") });
    assert.equal(sidoWithParent.ok, false, "시·도는 부모가 없다");
    for (const code of ["11000", "11000000000", "ab00000000"]) {
      const r = await tryInsert("regions", gu(code));
      assert.equal(r.ok, false, `코드 형식 ${code}`);
    }
  }));

test("자기 자신이나 자기 하위를 부모로 두면 거부 (순환 0)", () =>
  tx(async () => {
    const child = await insert("regions", gu("1199000000"));
    const self = await attempt("update public.regions set parent_code = code where code = $1", [child.code]);
    assert.equal(self.ok, false);
    assert.match(self.message, /자기 자신/);
    // 시·도를 자기 하위(시·군·구) 아래로 — 단계를 바꾸며 부모를 하위로
    const cycle = await attempt("update public.regions set level = 'sigungu', parent_code = $2 where code = $1", [SEOUL, child.code]);
    assert.equal(cycle.ok, false);
    assert.match(cycle.message, /하위 지역|단계는 바꿀 수 없습니다|순환/);
    const { rows } = await client.query("select level, parent_code from public.regions where code = $1", [SEOUL]);
    assert.deepEqual(rows[0], { level: "sido", parent_code: null });
  }));

test("하위가 있는 행의 단계는 못 바꾸고, 하위가 없으면 바꿀 수 있다", () =>
  tx(async () => {
    await insert("regions", gu("1199000000"));
    const r = await attempt("update public.regions set level = 'sigungu', parent_code = $2 where code = $1", [SEOUL, BUSAN]);
    assert.equal(r.ok, false);
    const lone = await insert("regions", { code: "9600000000", level: "sido", name: "외톨이 시·도", slug: uniq("lone") });
    // 시·도 → 시·군·구로 바꾸려면 코드 앞자리가 부모와 같아야 한다 — 같은 앞자리의 시·도를 만들어 부모로
    const parent = await insert("regions", { code: "9500000000", level: "sido", name: "부모 시·도", slug: uniq("p") });
    const changed = await attempt("update public.regions set code = '9512300000', level = 'sigungu', parent_code = $2 where code = $1 returning level", [lone.code, parent.code]);
    assert.ok(changed.ok, changed.message);
  }));

test("(parent_code, slug) unique — 같은 시·도 안 slug 중복 거부, 시·도끼리도 중복 거부, 다른 시·도면 같은 slug 허용", () =>
  tx(async () => {
    const same = uniq("jung-gu"); // 서울 중구(jung-gu)는 전국 적재가 이미 넣었다 — 시험용 slug로
    await insert("regions", gu("1199000000", { slug: same }));
    const dup = await tryInsert("regions", gu("1199100000", { slug: same }));
    assert.equal(dup.ok, false);
    assert.equal(dup.code, "23505");
    const other = await tryInsert("regions", { code: "2699000000", parent_code: BUSAN, level: "sigungu", name: "중구", slug: same });
    assert.ok(other.ok, other.message);
    const sidoDup = await tryInsert("regions", { code: "9900000000", level: "sido", name: "또 서울", slug: "seoul" });
    assert.equal(sidoDup.ok, false, "부모가 없는 시·도끼리도 slug가 겹치면 안 된다 (nulls not distinct)");
    assert.equal(sidoDup.code, "23505");
  }));

test("유효 기간 — valid_to < valid_from 거부, 같은 날은 허용", () =>
  tx(async () => {
    const bad = await tryInsert("regions", gu("1199000000", { valid_from: "2026-01-02", valid_to: "2026-01-01" }));
    assert.equal(bad.ok, false);
    assert.equal(bad.code, "23514");
    assert.ok((await tryInsert("regions", gu("1199100000", { valid_from: "2026-01-01", valid_to: "2026-01-01" }))).ok);
  }));

test("기사 지역 태그 — 없는 코드 거부, 유효한 시·도·시·군·구 코드는 저장", () =>
  tx(async () => {
    await insert("regions", gu("1199000000"));
    assert.deepEqual((await article({ region_codes: [SEOUL, "1199000000"] })).region_codes, [SEOUL, "1199000000"]);
    const unknown = await tryInsert("articles", { slug: uniq("a"), title: "t", section: "local", content_type: "explainer", region_codes: ["1300000000"] });
    assert.equal(unknown.ok, false);
    assert.match(unknown.message, /없는 행정구역 코드/);
    const legacy2 = await tryInsert("articles", { slug: uniq("a"), title: "t", section: "local", content_type: "explainer", region_codes: ["11"] });
    assert.equal(legacy2.ok, false, "앞 2자리만 쓴 옛 형식은 거부");
  }));

test("기사 지역 태그 — 폐지된 코드(valid_to 지남)·시작 전 코드는 새로 못 달고, 오늘까지 유효한 코드는 단다 (한국 날짜 경계)", () =>
  tx(async () => {
    await insert("regions", gu("1199000000", { valid_to: kstDay(-1) }));
    await insert("regions", gu("1199100000", { valid_to: kstDay(0) }));
    await insert("regions", gu("1199200000", { valid_from: kstDay(1) }));
    const expired = await tryInsert("articles", { slug: uniq("a"), title: "t", section: "local", content_type: "explainer", region_codes: ["1199000000"] });
    assert.equal(expired.ok, false, "어제 폐지된 코드");
    assert.match(expired.message, /폐지되었거나 시작 전/);
    assert.ok((await tryInsert("articles", { slug: uniq("a"), title: "t", section: "local", content_type: "explainer", region_codes: ["1199100000"] })).ok, "오늘까지 유효");
    const future = await tryInsert("articles", { slug: uniq("a"), title: "t", section: "local", content_type: "explainer", region_codes: ["1199200000"] });
    assert.equal(future.ok, false, "내일 시작하는 코드");
    // 이미 붙은 기사에 다른 코드를 더하는 수정도 같은 규칙
    const a = await article({ region_codes: [SEOUL] });
    const add = await attempt("update public.articles set region_codes = array[$2, '1199000000'] where id = $1", [a.id, SEOUL]);
    assert.equal(add.ok, false);
  }));

test("기사 지역 태그 — 이미 단 코드는 나중에 폐지돼도 남고 다른 칸을 고칠 수 있다, 쓰는 코드는 지울 수 없다", () =>
  tx(async () => {
    await insert("regions", gu("1199000000"));
    const a = await article({ region_codes: ["1199000000"] });
    await client.query("update public.regions set valid_to = $2 where code = $1", ["1199000000", kstDay(-30)]);
    const edit = await attempt("update public.articles set title = '고친 제목' where id = $1 returning region_codes", [a.id]);
    assert.ok(edit.ok, edit.message);
    assert.deepEqual(edit.rows[0].region_codes, ["1199000000"]);
    const keep = await attempt("update public.articles set region_codes = array['1199000000', $2] where id = $1", [a.id, SEOUL]);
    assert.ok(keep.ok, `이미 있던 폐지 코드는 그대로 두고 유효한 코드를 더한다: ${keep.message}`);
    const del = await attempt("delete from public.regions where code = $1", ["1199000000"]);
    assert.equal(del.ok, false);
    assert.match(del.message, /지울 수 없습니다/);
    await insert("regions", gu("1199100000"));
    assert.ok((await attempt("delete from public.regions where code = '1199100000'")).ok, "아무 기사도 쓰지 않는 코드는 지울 수 있다");
  }));
