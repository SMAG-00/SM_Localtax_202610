// W11-e DB - 자치법규 tier·조례 연결·요약 숫자 검사·정비 현황 뷰·확인일 경고 (마이그레이션 20261025000127~129, docs/dev/W11-e_설계.md)
//  · laws tier ordinance는 지역 코드가 있어야 하고 다른 tier는 지역 코드가 없다, 법령 뷰어에는 조례가 안 나온다
//  · 요약 숫자가 원문에 없으면 저장 거부(토큰 일치 - 5가 15에 걸리지 않음), 원문에 있으면 저장
//  · 출처·시행일·확인일 없으면 공개 거부, 서명은 요약이 바뀌면 무효, 서명 전 요약은 공개 뷰에 안 나온다
//  · 기능 키 꺼짐이면 공개 뷰 0행, redevelopment_zones는 표가 아니라 뷰
//  · 확인일 경고 - 90일째 경고 없음, 91일째 경고 (시각 주입), 한도 설정이 없으면 경고 0
//  · 이용 조건 unchecked인 ordinance_api는 수집 가능 아님
// 모든 시험은 거래 안에서 돌고 되돌린다 (남는 행 0). 조례 이름·원문·숫자는 시험용 가짜.
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
const rejects = async (sql, params, pattern) => {
  await client.query("savepoint s");
  try {
    await assert.rejects(client.query(sql, params), pattern);
  } finally {
    await client.query("rollback to savepoint s");
  }
};

async function regions() {
  const sigungu = (await client.query("select code, parent_code from public.regions where level = 'sigungu' limit 1")).rows[0];
  assert.ok(sigungu, "시군구 지역 시드가 있어야 한다");
  return { sigungu: sigungu.code, sido: sigungu.parent_code };
}

let seq = 0;
// 시험용 조례 + 개정판 + 조문 1개 (원문은 숫자 7, 1,200, 2.5가 있는 지어낸 문장)
async function fixture(regionCode, { body = "시험용 조례 본문 감면 7 한도 1,200 기간 2.5" } = {}) {
  seq += 1;
  const law = (await client.query("insert into public.laws (name, tier, scope, region_code) values ($1, 'ordinance', 'local', $2) returning id", [`시험용 조례 ${seq}-${Date.now()}`, regionCode])).rows[0].id;
  const snap = (await client.query("insert into public.raw_snapshots (source, url, content_hash, payload) values ('w11e-test', $1, $2, '{}') returning id", [`https://example.test/w11e/${seq}`, `hash-${seq}-${Date.now()}`])).rows[0].id;
  const ver = (await client.query("insert into public.law_versions (law_id, promulgation_no, promulgated_on, effective_on, body_hash, snapshot_id) values ($1, $2, '2026-01-01', '2026-02-01', $3, $4) returning id", [law, `시험용-${seq}`, `bh-${seq}`, snap])).rows[0].id;
  await client.query("insert into public.law_articles (version_id, article_no, body) values ($1, 3, $2)", [ver, body]);
  return { law, ver };
}
const link = (r, f, over = {}) =>
  client.query(
    `insert into public.ordinance_links (region_code, kind, law_id, version_id, summary, effective_from, verified_at, source_url, status, registered_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'w11e-test') returning id`,
    [over.region ?? r, over.kind ?? "tax_reduction", f.law, f.ver, over.summary === undefined ? null : over.summary, over.effective ?? "2026-02-01", over.verified === undefined ? "2026-03-01T12:00:00+09:00" : over.verified, over.url === undefined ? "https://example.test/w11e/ord" : over.url, over.status ?? "draft"],
  );
const setFlags = (patch) => client.query("update public.settings set value = value || $1::jsonb where key = 'feature_flags'", [JSON.stringify(patch)]);

test("laws - tier ordinance는 지역 코드 필수, 다른 tier는 지역 코드 거부", () =>
  tx(async () => {
    const r = await regions();
    await rejects("insert into public.laws (name, tier, scope) values ('시험용 조례 지역없음', 'ordinance', 'local')", [], /laws_ordinance_region/);
    await rejects("insert into public.laws (name, tier, scope, region_code) values ('시험용 법률 지역있음', 'statute', 'local', $1)", [r.sigungu], /laws_ordinance_region/);
    const ok = await client.query("insert into public.laws (name, tier, scope, region_code) values ('시험용 조례 정상', 'ordinance', 'local', $1) returning tier", [r.sigungu]);
    assert.equal(ok.rows[0].tier, "ordinance");
  }));

test("법령 뷰어 public_laws에는 조례가 나오지 않는다", () =>
  tx(async () => {
    const r = await regions();
    const f = await fixture(r.sigungu);
    await setFlags({ law_viewer: true });
    const rows = (await client.query("select id from public.public_laws where id = $1", [f.law])).rows;
    assert.deepEqual(rows, []);
  }));

test("요약 숫자 검사 - 원문에 없는 숫자는 저장 거부, 원문 숫자(쉼표 포함)는 저장", () =>
  tx(async () => {
    const r = await regions();
    const f = await fixture(r.sigungu);
    await rejects("insert into public.ordinance_links (region_code, kind, law_id, version_id, summary, registered_by) values ($1, 'tax_reduction', $2, $3, '시험용 요약 9', 'w11e-test')", [r.sigungu, f.law, f.ver], /ordinance_summary_number_mismatch/);
    const ok = await link(r.sigungu, f, { summary: "시험용 요약 7 과 1200 과 2.5" });
    assert.equal(ok.rows.length, 1);
  }));

test("요약 숫자 검사 - 부분 문자열이 아니라 토큰 일치 (요약 5는 원문 15·2.5로 통과하지 않음)", () =>
  tx(async () => {
    const r = await regions();
    const f = await fixture(r.sigungu, { body: "시험용 원문 15 와 2.5" });
    await rejects("insert into public.ordinance_links (region_code, kind, law_id, version_id, summary, registered_by) values ($1, 'tax_reduction', $2, $3, '시험용 5', 'w11e-test')", [r.sigungu, f.law, f.ver], /ordinance_summary_number_mismatch/);
    const same = await client.query("select public.ordinance_summary_numbers_ok('시험용 15', '시험용 15 와 2.5') as ok, public.ordinance_summary_numbers_ok('숫자 없음', '') as none");
    assert.deepEqual(same.rows[0], { ok: true, none: true });
  }));

test("공개 조건 - 출처·시행일·확인일 중 하나라도 없으면 공개 저장 거부", () =>
  tx(async () => {
    const r = await regions();
    const f = await fixture(r.sigungu);
    await rejects("insert into public.ordinance_links (region_code, kind, law_id, version_id, status, effective_from, verified_at, registered_by) values ($1, 'tax_reduction', $2, $3, 'public', '2026-02-01', now(), 'w11e-test')", [r.sigungu, f.law, f.ver], /ordinance_links_public_evidence/);
    await rejects("insert into public.ordinance_links (region_code, kind, law_id, version_id, status, source_url, verified_at, registered_by) values ($1, 'tax_reduction', $2, $3, 'public', 'https://example.test/x', now(), 'w11e-test')", [r.sigungu, f.law, f.ver], /ordinance_links_public_evidence/);
    await rejects("insert into public.ordinance_links (region_code, kind, law_id, version_id, status, source_url, effective_from, registered_by) values ($1, 'tax_reduction', $2, $3, 'public', 'https://example.test/x', '2026-02-01', 'w11e-test')", [r.sigungu, f.law, f.ver], /ordinance_links_public_evidence/);
  }));

test("종류와 지역 수준 - 도시정비는 시·도, 감면·세율은 시·군·구만", () =>
  tx(async () => {
    const r = await regions();
    const f = await fixture(r.sigungu);
    await rejects("insert into public.ordinance_links (region_code, kind, law_id, version_id, registered_by) values ($1, 'urban_redevelopment', $2, $3, 'w11e-test')", [r.sigungu, f.law, f.ver], /ordinance_link_kind_level/);
    const g = await fixture(r.sido);
    await rejects("insert into public.ordinance_links (region_code, kind, law_id, version_id, registered_by) values ($1, 'tax_rate', $2, $3, 'w11e-test')", [r.sido, g.law, g.ver], /ordinance_link_kind_level/);
    const ok = await link(r.sido, g, { kind: "urban_redevelopment" });
    assert.equal(ok.rows.length, 1);
  }));

test("서명 - 요약이 바뀌면 이전 서명은 무효, 같은 갱신에서 새로 서명하면 유지", () =>
  tx(async () => {
    const r = await regions();
    const f = await fixture(r.sigungu);
    const id = (await link(r.sigungu, f, { summary: "시험용 요약 7" })).rows[0].id;
    await client.query("update public.ordinance_links set summary_signed_by = 'w11e-reviewer', summary_signed_at = now() where id = $1", [id]);
    let row = (await client.query("select summary_signed_by, summary_signed_at from public.ordinance_links where id = $1", [id])).rows[0];
    assert.equal(row.summary_signed_by, "w11e-reviewer");
    await client.query("update public.ordinance_links set summary = '시험용 고친 요약 7' where id = $1", [id]);
    row = (await client.query("select summary_signed_by, summary_signed_at from public.ordinance_links where id = $1", [id])).rows[0];
    assert.deepEqual(row, { summary_signed_by: null, summary_signed_at: null });
    await client.query("update public.ordinance_links set summary = '시험용 다시 7', summary_signed_by = 'w11e-reviewer', summary_signed_at = now() where id = $1", [id]);
    row = (await client.query("select summary_signed_by from public.ordinance_links where id = $1", [id])).rows[0];
    assert.equal(row.summary_signed_by, "w11e-reviewer");
  }));

test("공개 뷰 - 기능 키 꺼짐이면 0행, 켜면 서명된 요약만 나오고 서명 전 요약은 null", () =>
  tx(async () => {
    const r = await regions();
    const f = await fixture(r.sigungu);
    const id = (await link(r.sigungu, f, { summary: "시험용 요약 7", status: "public" })).rows[0].id;
    await setFlags({ ordinance_texts: false });
    assert.deepEqual((await client.query("select id from public.public_ordinance_links where id = $1", [id])).rows, []);
    await setFlags({ ordinance_texts: true });
    let row = (await client.query("select summary, summary_signed from public.public_ordinance_links where id = $1", [id])).rows[0];
    assert.deepEqual(row, { summary: null, summary_signed: false });
    await client.query("update public.ordinance_links set summary_signed_by = 'w11e-reviewer', summary_signed_at = now() where id = $1", [id]);
    row = (await client.query("select summary, summary_signed from public.public_ordinance_links where id = $1", [id])).rows[0];
    assert.deepEqual(row, { summary: "시험용 요약 7", summary_signed: true });
    const arts = (await client.query("select article_no from public.public_ordinance_articles where link_id = $1", [id])).rows;
    assert.deepEqual(arts, [{ article_no: 3 }]);
  }));

test("확인일 경고 - 조례 90일째 경고 없음, 91일째 경고 (시각 주입), 한도 설정이 없으면 경고 0", () =>
  tx(async () => {
    const r = await regions();
    const f = await fixture(r.sigungu);
    const id = (await link(r.sigungu, f, { status: "public" })).rows[0].id;
    const warn = async (now) => (await client.query("select target, target_id::int as target_id, days from public.stale_check_warnings($1::timestamptz) where target = 'ordinance' and target_id = $2", [now, id])).rows;
    await client.query("update public.settings set value = '{\"zone_days\": 90, \"ordinance_days\": 90}'::jsonb where key = 'stale_check_policy'");
    assert.equal((await client.query("select public.stale_days('2026-03-01T12:00:00+09:00', '2026-05-30T23:00:00+09:00') as d")).rows[0].d, 90);
    assert.deepEqual(await warn("2026-05-30T23:00:00+09:00"), []);
    assert.deepEqual(await warn("2026-05-31T00:00:00+09:00"), [{ target: "ordinance", target_id: Number(id), days: 91 }]);
    await client.query("update public.settings set value = '{}'::jsonb where key = 'stale_check_policy'");
    assert.deepEqual(await warn("2027-05-31T00:00:00+09:00"), []);
  }));

test("redevelopment_zones - 표가 아니라 뷰이고 새 구역 표가 없다, 기능 키 꺼짐이면 0행", () =>
  tx(async () => {
    const kinds = (await client.query("select relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'redevelopment_zones'")).rows;
    assert.deepEqual(kinds, [{ relkind: "v" }]);
    const zoneTables = (await client.query("select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname ~ '(zone|redevelopment)'")).rows;
    assert.deepEqual(zoneTables, []);
    await setFlags({ redevelopment_status: false });
    assert.deepEqual((await client.query("select project_id from public.redevelopment_zones")).rows, []);
  }));

test("ordinance_api 원천은 unchecked라 수집 가능 아님, 룰셋으로 가는 외래키 없음", () =>
  tx(async () => {
    const src = (await client.query("select terms_status, public.data_source_runnable('ordinance_api') as runnable from public.data_sources where key = 'ordinance_api'")).rows[0];
    assert.deepEqual(src, { terms_status: "unchecked", runnable: false });
    const fks = (await client.query("select confrelid::regclass::text as target from pg_constraint where conrelid = 'public.ordinance_links'::regclass and contype = 'f'")).rows.map((x) => x.target).sort();
    assert.deepEqual(fks, ["laws", "law_versions", "regions"].sort());
  }));
