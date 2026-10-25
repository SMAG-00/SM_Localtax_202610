// W10-h DB - 분야 데이터 후보 -> 승인 -> 공개 반영 (마이그레이션 100·102, PRD-02 PR-06 · LG-15 · DF-06)
//  · 후보 생성 - 이용 조건 미확인 원천 거부, 허용만(견본 계약 없음) 거부, 스냅샷 없이 거부
//  · 승인 전 공개 0 - 검수 중인 후보는 반영 거부, 공개 표 행 0
//  · 승인 거부 - 가격류 칸, 유형 없음, 필수 칸 빈 값, 고시 번호·원문 링크 없음, 행사 공식 URL 없음/단축 주소, 주민번호 모양, 값 해시 모양
//  · 공개 반영 - 분양(생성 -> 값 변경 갱신 -> 같은 값 unchanged), 두 번 호출해도 1행(멱등), 반영 기록 1행, 검수 항목 published
//  · 단계 - 생성, 값 변경은 정정 기록, 프로젝트 연결
//  · 행사 - 이미지 권리 미확인이면 이미지 칸 0, 확인되면 보임, 취소 후보 반영 -> 상태 지정 + 이력 + 공개 뷰 상태 cancelled
//  · 제4유형 - 통과 기록 없음/글자 바뀜/차단 기록은 거부, 일치하는 통과 기록이면 반영, 본문 없는 대상은 기록 없이 반영
//  · 유형 없는 승인 항목(검사 우회) 반영 거부, 원천 이용 조건이 허용 아니게 바뀌면 반영 거부
//  · 권한 - anon·authenticated 는 새 표 접근 0
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup, sha } from "./_w10h_helpers.mjs";

let s;
before(async () => {
  s = await setup();
});
after(async () => s?.client?.end());

const count = async (sql, params) => Number((await s.h.one(sql, params)).n);

test("후보 생성 - 이용 조건 미확인 원천·견본 계약 없는 원천·스냅샷 없는 후보는 거부", () =>
  s.h.tx(async () => {
    const fields = await s.supplyFields();
    await s.client.query("savepoint a");
    await assert.rejects(s.candidate({ target: "supply_notice", fields }), /허용되고 견본 계약이 확인된 원천/);
    await s.client.query("rollback to savepoint a");
    await s.client.query("update public.data_sources set terms_status = 'allowed', terms_checked_by = 'u', terms_checked_at = now() where key = 'applyhome_supply'");
    await assert.rejects(s.candidate({ target: "supply_notice", fields }), /허용되고 견본 계약이 확인된 원천/);
    await s.client.query("rollback to savepoint a");
    await s.client.query("update public.data_sources set terms_status = 'allowed', terms_checked_by = 'u', terms_checked_at = now() where key = 'applyhome_supply'");
    await s.allowSource("applyhome_supply");
    await assert.rejects(s.candidate({ target: "supply_notice", fields, noSnapshot: true }), /원본 스냅샷/);
    await s.client.query("rollback to savepoint a");
    await s.allowSource("applyhome_supply");
    const ok = await s.candidate({ target: "supply_notice", fields });
    assert.equal(ok.status, "drafted");
  }));

test("원천 씨앗 7행은 모두 unchecked 이고 수집 불가", () =>
  s.h.tx(async () => {
    const rows = (await s.client.query("select key, terms_status, public.data_source_runnable(key) as r from public.data_sources where kind = 'field_data' order by key")).rows;
    assert.deepEqual(rows.map((r) => r.key), ["applyhome_supply", "buildinghub_permit", "dart_disclosure", "festival_data", "fin_authority_release", "pf_integrated_info", "seoul_cleanup"]);
    assert.ok(rows.every((r) => r.terms_status === "unchecked" && r.r === false));
  }));

test("승인 전 공개 0 - 검수 중 후보는 반영 거부이고 공개 표에 행이 없다", () =>
  s.h.tx(async () => {
    await s.allowSource("applyhome_supply");
    const item = await s.candidate({ target: "supply_notice", fields: await s.supplyFields(), itemId: "BEFORE-1" });
    let r = await s.publish(item.id);
    assert.equal(r.ok, false);
    assert.match(r.message, /승인된 후보만/);
    await s.go(item.id, "in_review");
    r = await s.publish(item.id);
    assert.equal(r.ok, false);
    assert.equal(await count("select count(*) n from public.supply_notices where source_key = 'applyhome_supply'"), 0);
    assert.equal(await count("select count(*) n from public.field_publications"), 0);
  }));

test("승인 거부 - 가격류 칸·허용 밖 칸은 후보에 실리면 승인할 수 없다 (가격·분담금·수익률 저장 0)", () =>
  s.h.tx(async () => {
    await s.allowSource("applyhome_supply");
    for (const extra of [{ sale_price: "시험용" }, { 분담금: "시험용" }, { profit_rate: 0.1 }]) {
      const item = await s.candidate({ target: "supply_notice", fields: await s.supplyFields(extra) });
      const a = await s.approve(item.id);
      assert.equal(a.ok, false, JSON.stringify(extra));
      assert.match(a.message, /허용되지 않은 칸/);
      assert.equal(await s.status(item.id), "in_review");
    }
    const top = await s.candidate({ target: "supply_notice", fields: await s.supplyFields(), payloadOver: { price: "시험용" } });
    const a = await s.approve(top.id);
    assert.equal(a.ok, false);
    assert.match(a.message, /허용되지 않은 칸 'price'/);
  }));

test("승인 거부 - 공공누리 유형 없음, 필수 칸 빈 값, 값 해시 모양, 주민번호 모양", () =>
  s.h.tx(async () => {
    await s.allowSource("applyhome_supply");
    const cases = [
      ["유형 없음", { kogl: null }, /공공누리 유형이 없습니다/],
      ["공급 규모 빈 값", { fields: await s.supplyFields({ supply_scale: "" }) }, /필수 칸 'supply_scale'/],
      ["해시 모양", { hash: "abc" }, /값 해시/],
      ["주민번호 모양", { fields: await s.supplyFields({ name: "시험용 900101-1234567" }) }, /주민등록번호/],
      ["가격 표현", { fields: await s.supplyFields({ name: "시험용 분양가 3억" }) }, /금액·가격 표현/],
      ["청약 마감이 시작보다 앞", { fields: await s.supplyFields({ apply_end: "2026-10-01" }) }, /마감일/],
    ];
    for (const [name, over, re] of cases) {
      const item = await s.candidate({ target: "supply_notice", fields: await s.supplyFields(), ...over });
      const a = await s.approve(item.id);
      assert.equal(a.ok, false, name);
      assert.match(a.message, re, name);
      assert.equal(await s.status(item.id), "in_review", name);
    }
  }));

test("분양 후보 승인 -> 공개 반영 -> 두 번 호출해도 1행, 값이 바뀌면 갱신, 같은 값은 unchanged (원천 ID 멱등)", () =>
  s.h.tx(async () => {
    await s.allowSource("applyhome_supply");
    const hash1 = sha("v1");
    const a = await s.candidate({ target: "supply_notice", fields: await s.supplyFields(), itemId: "SUP-1", hash: hash1 });
    assert.equal((await s.approve(a.id)).ok, true);
    let r = await s.publish(a.id);
    assert.equal(r.ok, true, r.message);
    assert.equal(r.rows[0].r.action, "created");
    const row = await s.h.one("select * from public.supply_notices where source_key = 'applyhome_supply' and source_item_id = 'SUP-1'");
    assert.equal(row.status, "public");
    assert.equal(row.license_type, "kogl_1");
    assert.equal(row.source_value_hash, hash1);
    assert.ok(row.verified_at);
    assert.equal(await s.status(a.id), "published");

    r = await s.publish(a.id);
    assert.equal(r.rows[0].r.action, "already_published");
    assert.equal(await count("select count(*) n from public.supply_notices where source_item_id = 'SUP-1'"), 1);
    assert.equal(await count("select count(*) n from public.field_publications where review_item_id = $1", [a.id]), 1);

    // 값이 바뀐 새 후보 -> 승인 -> 같은 행이 갱신된다
    const hash2 = sha("v2");
    const b = await s.candidate({ target: "supply_notice", fields: await s.supplyFields({ supply_scale: "120세대" }), itemId: "SUP-1", hash: hash2 });
    assert.equal((await s.approve(b.id)).ok, true);
    r = await s.publish(b.id);
    assert.equal(r.rows[0].r.action, "updated");
    const after = await s.h.one("select supply_scale, source_value_hash from public.supply_notices where source_item_id = 'SUP-1'");
    assert.deepEqual([after.supply_scale, after.source_value_hash], ["120세대", hash2]);
    assert.equal(await count("select count(*) n from public.supply_notices where source_item_id = 'SUP-1'"), 1);

    // 같은 값, 다른 공공누리 유형으로 다시 온 후보 -> 변화 없음
    const c = await s.candidate({ target: "supply_notice", fields: await s.supplyFields({ supply_scale: "120세대" }), itemId: "SUP-1", hash: hash2, kogl: "kogl_2" });
    assert.equal((await s.approve(c.id)).ok, true);
    assert.equal((await s.publish(c.id)).rows[0].r.action, "unchanged");
    assert.equal(await count("select count(*) n from public.supply_notices where source_item_id = 'SUP-1'"), 1);
  }));

test("같은 검수 키(같은 원천·항목·값·유형)의 후보는 두 번 만들 수 없다", () =>
  s.h.tx(async () => {
    await s.allowSource("applyhome_supply");
    const snap = await s.h.snapshot();
    const key = s.h.uniq("dup");
    const ins = () => s.h.attempt(
      "insert into public.review_items (kind, source_key, title, data_source_key, snapshot_id, payload) values ('field_data', $1, 't', 'applyhome_supply', $2, '{}'::jsonb)",
      [key, snap],
    );
    assert.equal((await ins()).ok, true);
    const again = await ins();
    assert.equal(again.ok, false);
    assert.equal(again.code, "23505");
  }));

test("단계 후보 - 고시 번호·원문 링크가 없으면 승인 불가, 승인하면 단계 기록, 값이 바뀌면 정정 기록", () =>
  s.h.tx(async () => {
    await s.allowSource("seoul_cleanup");
    await s.client.query("set local session_replication_role = replica");
    await s.client.query(
      `update public.settings set value = case key when 'project_types' then '{"fixture": {"label": "시험용 유형"}}'::jsonb
         else '{"fixture": [{"key": "step_one", "label": "시험용 일"}, {"key": "step_two", "label": "시험용 이"}]}'::jsonb end
       where key in ('project_types', 'project_stage_lists')`,
    );
    await s.client.query("set local session_replication_role = origin");
    const code = await s.regionCode();
    const project = await s.h.one("insert into public.projects (slug, name, region_code, project_type, created_by) values ('fixture-project', '시험용 프로젝트', $1, 'fixture', 'user:w10h') returning id", [code]);
    const base = { project_slug: "fixture-project", stage: "step_one", notice_no: "시험용 제1호", notice_date: "2026-10-01", issuer: "시험용 기관", source_url: "https://example.test/g/1" };

    for (const [name, over, re] of [["고시 번호 없음", { notice_no: "" }, /notice_no/], ["원문 링크 없음", { source_url: "" }, /source_url/], ["목록 밖 단계", { stage: "step_zero" }, /단계 목록에 없습니다/], ["없는 프로젝트", { project_slug: "없는-프로젝트" }, /프로젝트/]]) {
      const bad = await s.candidate({ source: "seoul_cleanup", target: "project_stage", fields: { ...base, ...over } });
      const a = await s.approve(bad.id);
      assert.equal(a.ok, false, name);
      assert.match(a.message, re, name);
    }

    const h1 = sha("stage-1");
    const first = await s.candidate({ source: "seoul_cleanup", target: "project_stage", fields: base, itemId: "PRJ-1", hash: h1, kogl: "kogl_3" });
    assert.equal((await s.approve(first.id)).ok, true);
    assert.equal((await s.publish(first.id)).rows[0].r.action, "created");
    const ev = await s.h.one("select * from public.project_events where source_item_id = 'PRJ-1'");
    assert.deepEqual([ev.kind, ev.stage, ev.license_type, ev.project_id, ev.source_value_hash], ["stage", "step_one", "kogl_3", project.id, h1]);
    assert.ok(ev.snapshot_id);

    const h2 = sha("stage-2");
    const second = await s.candidate({ source: "seoul_cleanup", target: "project_stage", fields: { ...base, notice_no: "시험용 제2호" }, itemId: "PRJ-1", hash: h2, kogl: "kogl_3" });
    assert.equal((await s.approve(second.id)).ok, true);
    assert.equal((await s.publish(second.id)).rows[0].r.action, "corrected");
    const fix = await s.h.one("select * from public.project_events where source_value_hash = $1", [h2]);
    assert.deepEqual([fix.kind, fix.correction_of, fix.notice_no], ["correction", ev.id, "시험용 제2호"]);
    assert.equal(await count("select count(*) n from public.project_events where source_item_id = 'PRJ-1'"), 2);
  }));

test("행사 후보 - 공식 URL 없음·단축 주소·상업 행사 sponsored 아님은 승인 불가", () =>
  s.h.tx(async () => {
    await s.allowSource("festival_data");
    const base = await eventFields();
    for (const [name, over, re] of [["공식 URL 없음", { official_url: "" }, /official_url/], ["단축 주소", { official_url: "https://bit.ly/abc" }, /단축 주소/], ["필수 칸 venue 없음", { venue: "" }, /venue/],
      ["상업 행사 sponsored 아님", { organizer_type: "commercial", sponsored: false }, /sponsored/], ["종료가 시작보다 앞", { ends_at: "2098-12-31T00:00:00+09:00" }, /종료가 시작보다 앞/]]) {
      const bad = await s.candidate({ source: "festival_data", target: "local_event", fields: { ...base, ...over } });
      const a = await s.approve(bad.id);
      assert.equal(a.ok, false, name);
      assert.match(a.message, re, name);
    }
  }));

async function eventFields(over = {}) {
  return {
    slug: "fixture-event-1", series_key: "fixture-series", title: "시험용 행사", category: "festival", organizer: "시험용 기관", organizer_type: "government", venue: "시험용 장소",
    region_code: await s.regionCode(), starts_at: "2099-01-01T00:00:00+09:00", ends_at: "2099-01-02T00:00:00+09:00", official_url: "https://example.test/e/1", sponsored: false, ...over,
  };
}

test("행사 반영 - 이미지 권리 미확인이면 이미지 주소 0, 확인되면 저장, 취소 후보를 승인하면 상태·이력·공개 뷰가 함께 바뀐다", () =>
  s.h.tx(async () => {
    await s.allowSource("festival_data");
    await s.setFlags({ local_events: true });
    const img = "https://example.test/img/1.png";
    const a = await s.candidate({ source: "festival_data", target: "local_event", fields: await eventFields({ image_url: img, image_rights: "unconfirmed" }), itemId: "EVT-1", hash: sha("e1") });
    assert.equal((await s.approve(a.id)).ok, true);
    assert.equal((await s.publish(a.id)).rows[0].r.action, "created");
    let ev = await s.h.one("select * from public.local_events where source_item_id = 'EVT-1'");
    assert.deepEqual([ev.image_url, ev.image_rights, ev.published, ev.license_type], [null, "unconfirmed", true, "kogl_1"]);
    let pub = await s.h.one("select status, image_url, license_type from public.public_local_events where slug = 'fixture-event-1'");
    assert.deepEqual([pub.status, pub.image_url, pub.license_type], ["upcoming", null, "kogl_1"]);

    const b = await s.candidate({ source: "festival_data", target: "local_event", fields: await eventFields({ image_url: img, image_rights: "confirmed" }), itemId: "EVT-1", hash: sha("e2") });
    assert.equal((await s.approve(b.id)).ok, true);
    assert.equal((await s.publish(b.id)).rows[0].r.action, "updated");
    pub = await s.h.one("select image_url from public.public_local_events where slug = 'fixture-event-1'");
    assert.equal(pub.image_url, img);

    const c = await s.candidate({ source: "festival_data", target: "local_event", fields: await eventFields({ image_url: img, image_rights: "confirmed", status: "cancelled" }), itemId: "EVT-1", hash: sha("e3") });
    assert.equal((await s.approve(c.id)).ok, true);
    assert.equal((await s.publish(c.id)).rows[0].r.action, "updated");
    ev = await s.h.one("select * from public.local_events where source_item_id = 'EVT-1'");
    assert.equal(ev.status_override, "cancelled");
    assert.ok(ev.status_source_url && ev.status_confirmed_at);
    pub = await s.h.one("select status from public.public_local_events where slug = 'fixture-event-1'");
    assert.equal(pub.status, "cancelled");
    assert.equal(await count("select count(*) n from public.event_status_history where event_id = $1 and to_state = 'cancelled'", [ev.id]), 1);
    assert.equal(await count("select count(*) n from public.local_events where source_item_id = 'EVT-1'"), 1);
  }));

test("제4유형 - 본문이 있는 후보는 유사도 통과 기록(같은 글자 해시)이 있어야 반영된다", () =>
  s.h.tx(async () => {
    await s.allowSource("dart_disclosure");
    const item = await s.candidate({ source: "dart_disclosure", target: "finance_indicator", fields: s.indicatorFields(), kogl: "kogl_4", itemId: "IDX-1" });
    assert.equal((await s.approve(item.id)).ok, true);

    let r = await s.publish(item.id);
    assert.equal(r.ok, false);
    assert.match(r.message, /제4유형/);
    const body = await s.h.one("select public.field_candidate_body($1) as b", [item.id]);
    assert.equal(body.b.text, "시험용 정의 문장입니다.");
    assert.equal(body.b.hash, sha("시험용 정의 문장입니다."));

    const addCheck = (status, hash) => s.client.query(
      "insert into public.field_candidate_checks (review_item_id, kind, status, text_hash, rules_version, checked_by) values ($1, 'similarity', $2, $3, '시험용', 'user:w10h')", [item.id, status, hash]);
    await addCheck("pass", sha("검사 뒤 글자가 바뀐 본문"));
    r = await s.publish(item.id);
    assert.equal(r.ok, false, "글자 해시가 다른 통과 기록은 소용없다");
    await addCheck("blocked", body.b.hash);
    r = await s.publish(item.id);
    assert.equal(r.ok, false, "차단 기록은 통과가 아니다");
    assert.equal(await count("select count(*) n from public.finance_indicators where source_key = 'dart_disclosure'"), 0);

    await addCheck("pass", body.b.hash);
    r = await s.publish(item.id);
    assert.equal(r.ok, true, r.message);
    const ind = await s.h.one("select value, definition, license_type, released_on::text as released_on from public.finance_indicators where source_item_id = 'IDX-1'");
    assert.deepEqual([Number(ind.value), ind.definition, ind.license_type, ind.released_on], [1.5, "시험용 정의 문장입니다.", "kogl_4", "2026-10-01"]);
  }));

test("제4유형이라도 본문 글자가 없는 대상(분양)은 구조화 칸만 공개하므로 통과 기록 없이 반영된다", () =>
  s.h.tx(async () => {
    await s.allowSource("applyhome_supply");
    const item = await s.candidate({ target: "supply_notice", fields: await s.supplyFields(), kogl: "kogl_4" });
    assert.equal((await s.approve(item.id)).ok, true);
    assert.equal((await s.publish(item.id)).ok, true);
  }));

test("통계 지표 - 같은 원천 항목의 같은 값은 유형만 달라도 1행, 값이 바뀌면 시계열에 새 행", () =>
  s.h.tx(async () => {
    await s.allowSource("dart_disclosure");
    const h1 = sha("idx-v1");
    const a = await s.candidate({ source: "dart_disclosure", target: "finance_indicator", fields: s.indicatorFields(), kogl: "kogl_1", itemId: "IDX-2", hash: h1 });
    assert.equal((await s.approve(a.id)).ok, true);
    assert.equal((await s.publish(a.id)).rows[0].r.action, "created");
    const dup = await s.candidate({ source: "dart_disclosure", target: "finance_indicator", fields: s.indicatorFields(), kogl: "unmarked", itemId: "IDX-2", hash: h1 });
    assert.equal((await s.approve(dup.id)).ok, true);
    assert.equal((await s.publish(dup.id)).rows[0].r.action, "unchanged");
    const next = await s.candidate({ source: "dart_disclosure", target: "finance_indicator", fields: s.indicatorFields({ value: 2.5 }), kogl: "kogl_1", itemId: "IDX-2", hash: sha("idx-v2") });
    assert.equal((await s.approve(next.id)).ok, true);
    assert.equal((await s.publish(next.id)).rows[0].r.action, "created");
    assert.equal(await count("select count(*) n from public.finance_indicators where source_item_id = 'IDX-2'"), 2);
    assert.equal(Number((await s.h.one("select value from public.finance_indicators where source_value_hash = $1", [h1])).value), 1.5, "수치는 원자료 값 그대로");
  }));

test("DF-06 - 발표일·기준일·원문 주소 빠짐, 금지 표현, 미래 기준일은 승인 불가", () =>
  s.h.tx(async () => {
    await s.allowSource("dart_disclosure");
    const cases = [
      ["발표일 없음", { released_on: "" }, /released_on/],
      ["기준일 없음", { as_of: "" }, /as_of/],
      ["원문 주소 없음", { source_url: "" }, /source_url/],
      ["미래 기준일", { as_of: "2999-01-01" }, /오늘보다 뒤/],
      ["금지 표현", { definition: "지금 가입하세요" }, /금지 표현/],
    ];
    for (const [name, over, re] of cases) {
      const item = await s.candidate({ source: "dart_disclosure", target: "finance_indicator", fields: s.indicatorFields(over) });
      const a = await s.approve(item.id);
      assert.equal(a.ok, false, name);
      assert.match(a.message, re, name);
    }
  }));

test("유형 없는 항목 공개 0 - 승인 검사를 우회해 approved 로 만든 항목도 반영 함수가 거부한다", () =>
  s.h.tx(async () => {
    await s.allowSource("applyhome_supply");
    const item = await s.candidate({ target: "supply_notice", fields: await s.supplyFields(), kogl: null });
    await s.client.query("set local session_replication_role = replica");
    assert.equal((await s.approve(item.id)).ok, true, "우회 승인(트리거 건너뜀)");
    await s.client.query("set local session_replication_role = origin");
    const r = await s.publish(item.id);
    assert.equal(r.ok, false);
    assert.match(r.message, /공공누리 유형이 없습니다/);
    assert.equal(await count("select count(*) n from public.supply_notices where source_key = 'applyhome_supply'"), 0);
  }));

test("원천 이용 조건이 허용이 아니게 바뀌면 이미 승인된 후보도 반영하지 않는다", () =>
  s.h.tx(async () => {
    await s.allowSource("applyhome_supply");
    const item = await s.candidate({ target: "supply_notice", fields: await s.supplyFields() });
    assert.equal((await s.approve(item.id)).ok, true);
    await s.client.query("update public.data_sources set terms_status = 'denied' where key = 'applyhome_supply'");
    const r = await s.publish(item.id);
    assert.equal(r.ok, false);
    assert.match(r.message, /이용 조건/);
    assert.equal(await s.status(item.id), "approved");
  }));

test("추가만 표 - 반영 기록·유사도 기록은 고치거나 지울 수 없다", () =>
  s.h.tx(async () => {
    await s.allowSource("applyhome_supply");
    const item = await s.candidate({ target: "supply_notice", fields: await s.supplyFields() });
    await s.approve(item.id);
    await s.publish(item.id);
    for (const sql of ["update public.field_publications set published_by = 'x'", "delete from public.field_publications"]) {
      assert.equal((await s.h.attempt(sql)).ok, false, sql);
    }
  }));

test("anon·authenticated 는 새 표와 함수에 접근할 수 없다", () =>
  s.h.tx(async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const sql of ["select * from public.field_publications", "select * from public.field_candidate_checks", "select * from public.project_source_links", "select public.field_publish(1, 'x')", "select public.field_candidate_body(1)"]) {
        const r = await s.h.attempt(sql, [], role);
        assert.equal(r.ok, false, `${role}: ${sql}`);
      }
    }
  }));
