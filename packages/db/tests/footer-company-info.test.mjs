// 바닥글 이전 (마이그레이션 20261025000103 - PO 요청 2026-10-25)
//  · 씨앗: 옛 사이트 매체 정보·연락처·두 안내 문구 (PO 제공 값 그대로, 문구 안 {제호} 자리표시자)
//  · 저장 검사(트리거 company_info_guard): 객체 · 아는 칸만 · 글자만 · 한 줄 · 칸별 상한 (apps/web/lib/policy/docs.ts companyInfoErrors와 같다)
//  · 기능 키 page_youth_protection · page_copyright_policy는 꺼짐으로 시작 / 정책 문서 2종은 본문 씨앗 0행
//  · anon은 company_info 한 줄을 읽는다 (W2-e settings_public_company_info)
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
async function attempt(sql, params = [], role = null) {
  await client.query("savepoint t");
  try {
    if (role) await client.query(`set local role ${role}`);
    const res = await client.query(sql, params);
    if (role) await client.query("reset role");
    await client.query("release savepoint t");
    return { ok: true, rows: res.rows };
  } catch (err) {
    await client.query("rollback to savepoint t");
    return { ok: false, message: err.message, code: err.code };
  }
}
const setInfo = (value) => attempt("update public.settings set value = $1::jsonb where key = 'company_info'", [JSON.stringify(value)]);

test("씨앗 - 옛 사이트 값이 PO가 준 그대로 들어 있고 제호는 {제호} 자리표시자로만 쓴다", async () => {
  const v = (await client.query("select value from public.settings where key = 'company_info'")).rows[0].value;
  assert.deepEqual(v, {
    registered_on: "2009-04-06",
    registration_no: "성동 라 00032",
    publisher_editor: "김의효",
    youth_officer: "원연성",
    corporation: "한국지방세연구회(주)",
    address: "서울특별시 성동구 자동차시장1길 18 (화성개발장한평), 504호",
    phone: "02-2246-2233",
    fax: "02-2246-5885",
    copyright_notice: "{제호} 모든 콘텐츠(영상, 기사, 사진)는 저작권법의 보호를 받은바, 무단 전재와 복사, 배포 등을 금합니다.",
    open_reporting_notice: "「열린보도원칙」 당 매체는 독자와 취재원 등 뉴스이용자의 권리 보장을 위해 반론이나 정정보도, 추후보도를 요청할 수 있는 창구를 열어두고 있음을 알려드립니다.",
  });
});

test("저장 검사 - 아는 칸의 한 줄 글자와 빈 글자는 통과, 칸을 지운 빈 객체도 통과", async () => {
  await tx(async () => {
    assert.equal((await setInfo({ phone: "02-1", fax: "" })).ok, true);
    assert.equal((await setInfo({})).ok, true);
  });
});

test("저장 검사 - 객체 아님 / 모르는 칸 / 글자 아님 / 줄바꿈 각각 check_violation", async () => {
  await tx(async () => {
    for (const bad of [[], "글자", { nickname: "x" }, { phone: 3 }, { phone: null }, { address: "가\n나" }]) {
      const r = await setInfo(bad);
      assert.equal(r.ok, false, JSON.stringify(bad));
      assert.equal(r.code, "23514", JSON.stringify(bad));
    }
  });
});

test("저장 검사 - 글자 수 상한 경계: 전화 60자 통과 / 61자 거부, 문구 400자 통과 / 401자 거부", async () => {
  await tx(async () => {
    assert.equal((await setInfo({ phone: "1".repeat(60) })).ok, true);
    assert.equal((await setInfo({ phone: "1".repeat(61) })).code, "23514");
    assert.equal((await setInfo({ copyright_notice: "가".repeat(400) })).ok, true);
    assert.equal((await setInfo({ copyright_notice: "가".repeat(401) })).code, "23514");
  });
});

test("anon은 company_info 한 줄을 읽고 다른 설정 키는 company_info 정책으로는 읽지 못한다", async () => {
  await tx(async () => {
    const r = await attempt("select value from public.settings where key = 'company_info'", [], "anon");
    assert.equal(r.ok, true);
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].value.fax, "02-2246-5885");
  });
});

test("기능 키 두 개는 꺼짐으로 있고, 정책 문서 2종은 doc_key로 받으며 본문 씨앗은 0행", async () => {
  const flags = (await client.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  assert.equal(flags.page_youth_protection, false);
  assert.equal(flags.page_copyright_policy, false);
  const seeded = await client.query("select count(*)::int as n from public.policy_versions where doc_key in ('youth-protection', 'copyright-policy')");
  assert.equal(seeded.rows[0].n, 0);
  await tx(async () => {
    for (const k of ["youth-protection", "copyright-policy"]) {
      const r = await attempt("insert into public.policy_versions (doc_key, version) values ($1, 1)", [k]);
      assert.equal(r.ok, true, k);
    }
    assert.equal((await attempt("insert into public.policy_versions (doc_key, version) values ('cookies', 1)")).code, "23514");
  });
});
