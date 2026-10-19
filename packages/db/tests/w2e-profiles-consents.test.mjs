// W2-e 1단계 회원 표 — profiles · consents (docs/dev/W2-e_설계.md 2.1 · 2.2 · 3.2 · 3.3, PRD-01A ACC-02 · 6.1)
//  profiles — 칸 목록(이메일·전화·주소·관리자 권한 칸 0) · 기본값 · 표시 이름 30글자·이메일 모양 거부(전각 ＠ 포함) ·
//    관심 분야 모양·공개 하위 분야·local 하위 분야 없음·중복·상한(설정 member.interest_max) · 관심 지역 상한+1번째 거부(설정 member.interest_region_limit)·
//    없는 코드·폐지·시작 전 거부(한국 날짜 경계 — 오늘 포함, 어제·내일 거부) · 이미 고른 코드는 나중에 폐지돼도 남는다 · 설정이 없으면 닫힌다 · 계정이 지워지면 함께 지워진다
//  consents — user_id 또는 email 정확히 하나 · email은 brief_prereg만 · 이메일 모양(소문자·앞뒤 공백 정리) · 철회되지 않은 같은 (종류, 주체)는 하나 ·
//    철회하면 다시 신청 가능 · 토큰 해시 모양·중복 · 관심 지역 저장은 동의 행을 만들지 않는다 · 구독자 표 없음
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

const DESIGN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "dev", "W2-e_설계.md");
const MD = fs.readFileSync(DESIGN, "utf8");
const sec2 = MD.split(/^## /m).find((s) => s.startsWith("2. 값 목록"));
const MEMBER = JSON.parse(sec2.match(/^#### `member`[^\n]*\n+```json\n([\s\S]*?)\n```/m)[1]);

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
const newUser = async () => (await client.query("insert into auth.users (id, aud, role, email) values (gen_random_uuid(), 'authenticated', 'authenticated', $1) returning id", [`p-${process.pid}-${++seq}@profiles.example.test`])).rows[0].id;
const putProfile = (id, cols = {}) => {
  const keys = ["id", ...Object.keys(cols)];
  return attempt(`insert into public.profiles (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, [id, ...Object.values(cols)]);
};
const setProfile = (id, col, value) => attempt(`update public.profiles set ${col} = $2 where id = $1 returning *`, [id, value]);
const SIDO = ["1100000000", "2600000000", "2700000000", "2800000000", "2900000000", "3000000000", "3100000000", "3600000000"];
const HASH = (c) => c.repeat(64);

test("설계 2.2 member 블록을 읽었다 — 관심 분야 20 · 관심 지역 3 · 표시 이름 30", () => {
  assert.equal(MEMBER.interest_max, 20);
  assert.equal(MEMBER.interest_region_limit, 3);
  assert.equal(MEMBER.display_name_chars, 30);
});

test("profiles 칸 — id·display_name·tier·interests·interest_region_codes·mode_pref·created_at·updated_at뿐 (이메일·전화·주소·관리자 권한 칸 0)", async () => {
  const { rows } = await client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'profiles' order by ordinal_position");
  assert.deepEqual(rows.map((r) => r.column_name), ["id", "display_name", "tier", "interests", "interest_region_codes", "mode_pref", "created_at", "updated_at"]);
});

test("profiles 기본값 — 등급 basic · 모드 general · 관심 분야·지역 빈 목록 · 표시 이름 없음", () =>
  tx(async () => {
    const r = await putProfile(await newUser());
    assert.ok(r.ok, r.message);
    assert.deepEqual(
      { tier: r.rows[0].tier, mode: r.rows[0].mode_pref, interests: r.rows[0].interests, regions: r.rows[0].interest_region_codes, name: r.rows[0].display_name },
      { tier: "basic", mode: "general", interests: [], regions: [], name: null },
    );
  }));

test("계정 하나에 프로필 하나 — 같은 계정에 두 번째 프로필은 23505, 없는 계정은 외래 키 23503", () =>
  tx(async () => {
    const id = await newUser();
    assert.ok((await putProfile(id)).ok);
    assert.equal((await putProfile(id)).code, "23505");
    assert.equal((await putProfile("00000000-0000-4000-8000-000000000000")).code, "23503");
  }));

test("표시 이름 — 30글자까지 받고 31글자·빈 글자·앞뒤 공백은 거부, 이메일 모양(전각 ＠·대문자 포함)은 거부, 이메일이 아닌 @ 글자는 받는다", () =>
  tx(async () => {
    const ok = async (name) => (await putProfile(await newUser(), { display_name: name })).ok;
    const code = async (name) => (await putProfile(await newUser(), { display_name: name })).code;
    assert.equal(await ok("가".repeat(30)), true, "30글자");
    assert.equal(await code("가".repeat(31)), "23514", "31글자");
    assert.equal(await code(""), "23514", "빈 글자 — 이름 없음은 null");
    assert.equal(await code(" 홍길동"), "23514", "앞 공백");
    assert.equal(await code("홍길동 "), "23514", "뒤 공백");
    for (const email of ["hong@example.com", "HONG.GIL-dong+x@Mail.Example.co.kr", "hong＠example.com", "문의 a@b.kr"]) {
      assert.equal(await code(email), "23514", `이메일 모양 '${email}'`);
    }
    for (const fine of ["홍길동", "x@y", "회계 담당 @팀", "Gil-dong 2"]) assert.equal(await ok(fine), true, `이메일 모양이 아닌 '${fine}'`);
  }));

test("관심 분야 — 4대 분야와 공개 하위 분야(tax:amendments)는 받고, local의 하위 분야·없는 하위 분야·대문자·빈 값·중복은 거부", () =>
  tx(async () => {
    const id = await newUser();
    assert.ok((await putProfile(id, { interests: ["tax", "realestate", "finance", "local", "tax:amendments", "realestate:projects", "finance:trust-pf"] })).ok);
    const bad = async (interests, why) => {
      const r = await setProfile(id, "interests", interests);
      assert.equal(r.ok, false, why);
      assert.equal(r.code, "23514", `${why}: ${r.message}`);
    };
    await bad(["local:weekly"], "local은 하위 분야가 없다 (categories에 local/weekly가 있어도)");
    await bad(["tax:nothing"], "없는 하위 분야");
    await bad(["realestate:amendments"], "분야가 맞지 않는 하위 분야 (amendments는 tax 것)");
    await bad(["TAX"], "대문자");
    await bad(["tax:"], "하위 분야 비어 있음");
    await bad([""], "빈 값");
    await bad(["tax", "tax"], "중복");
    await bad(["energy"], "목록 밖 분야");
  }));

test("관심 분야 — 공개가 아닌(visible=false) 하위 분야는 새로 고를 수 없다", () =>
  tx(async () => {
    const id = await newUser();
    await client.query("update public.categories set visible = false where section = 'tax' and slug = 'amendments'");
    const r = await putProfile(id, { interests: ["tax:amendments"] });
    assert.equal(r.code, "23514", r.message);
    assert.ok((await putProfile(id, { interests: ["tax:interpretations"] })).ok, "공개 하위 분야는 된다");
  }));

test("관심 분야 상한 — 설정 member.interest_max 개까지 받고 +1번째는 거부 (설정을 바꾸면 바로 적용), 시드 20은 기본 한도", () =>
  tx(async () => {
    const all = ["tax", "realestate", "finance", "local", "tax:amendments", "tax:interpretations", "tax:columns", "realestate:regional-hubs"];
    await client.query("update public.settings set value = jsonb_set(value, '{interest_max}', '5') where key = 'member'");
    const id = await newUser();
    assert.ok((await putProfile(id, { interests: all.slice(0, 5) })).ok, "5개 허용");
    const over = await setProfile(id, "interests", all.slice(0, 6));
    assert.equal(over.code, "23514", "6개째 거부");
    assert.match(over.message, /5개까지/);
    await client.query("update public.settings set value = jsonb_set(value, '{interest_max}', '7') where key = 'member'");
    assert.ok((await setProfile(id, "interests", all.slice(0, 6))).ok, "상한을 7로 올리면 6개 허용");
  }));

test("관심 분야 시드 상한(20) — 21개짜리 목록은 값이 무엇이든 상한 문장으로 거부된다 (20개 경계는 설정 변경으로 위에서 본다)", () =>
  tx(async () => {
    const r = await putProfile(await newUser(), { interests: Array.from({ length: MEMBER.interest_max + 1 }, () => "tax") });
    assert.equal(r.code, "23514");
    assert.match(r.message, new RegExp(`${MEMBER.interest_max}개까지`));
  }));

test("관심 지역 상한 — 3곳까지 받고 4번째(상한+1)는 거부, 설정을 5로 올리면 5곳까지", () =>
  tx(async () => {
    const id = await newUser();
    assert.ok((await putProfile(id, { interest_region_codes: SIDO.slice(0, MEMBER.interest_region_limit) })).ok, "3곳");
    const over = await setProfile(id, "interest_region_codes", SIDO.slice(0, MEMBER.interest_region_limit + 1));
    assert.equal(over.code, "23514", over.message);
    assert.match(over.message, /3곳까지/);
    await client.query("update public.settings set value = jsonb_set(value, '{interest_region_limit}', '5') where key = 'member'");
    assert.ok((await setProfile(id, "interest_region_codes", SIDO.slice(0, 5))).ok, "5곳");
    assert.equal((await setProfile(id, "interest_region_codes", SIDO.slice(0, 6))).code, "23514", "6곳 거부");
  }));

test("관심 지역 코드 — 없는 코드·형식이 틀린 코드·중복·빈 값은 거부, 시·도와 시·군·구 코드는 받는다", () =>
  tx(async () => {
    await client.query("insert into public.regions (code, parent_code, level, name, slug) values ('1199900000', '1100000000', 'sigungu', '시험구', 'e2e-test-gu')");
    const id = await newUser();
    assert.ok((await putProfile(id, { interest_region_codes: ["1100000000", "1199900000"] })).ok, "시·도 + 시·군·구");
    for (const [codes, why] of [
      [["9999999999"], "regions에 없는 코드"],
      [["1100"], "10자리가 아닌 코드"],
      [["서울"], "이름은 코드가 아니다"],
      [["1100000000", "1100000000"], "중복"],
      [[""], "빈 값"],
    ]) {
      const r = await setProfile(id, "interest_region_codes", codes);
      assert.equal(r.code, "23514", `${why}: ${r.message}`);
    }
  }));

test("관심 지역 유효 기간(한국 날짜) — 오늘이 마지막 날인 코드·오늘이 시작일인 코드는 받고, 어제 폐지·내일 시작은 새로 고를 수 없다", () =>
  tx(async () => {
    const region = (code, from, to) =>
      client.query(
        `insert into public.regions (code, parent_code, level, name, slug, valid_from, valid_to)
         values ($1, '1100000000', 'sigungu', $2, $2, ${from}, ${to})`,
        [code, `e2e-${code}`],
      );
    const today = "(now() at time zone 'Asia/Seoul')::date";
    await region("1100100000", "null", today); // 오늘까지 유효
    await region("1100200000", today, "null"); // 오늘부터 유효
    await region("1100300000", "null", `${today} - 1`); // 어제 폐지
    await region("1100400000", `${today} + 1`, "null"); // 내일 시작
    const put = async (code) => (await putProfile(await newUser(), { interest_region_codes: [code] }));
    assert.ok((await put("1100100000")).ok, "오늘이 valid_to — 아직 유효");
    assert.ok((await put("1100200000")).ok, "오늘이 valid_from — 이미 유효");
    const old = await put("1100300000");
    assert.equal(old.code, "23514");
    assert.match(old.message, /폐지되었거나 시작 전/);
    assert.equal((await put("1100400000")).code, "23514", "내일 시작 — 시작 전");
  }));

test("이미 고른 관심 지역은 나중에 폐지돼도 남는다 — 폐지된 코드를 그대로 두고 다른 지역을 더하는 저장은 되고, 폐지 코드를 새로 더하는 저장은 거부", () =>
  tx(async () => {
    await client.query("insert into public.regions (code, parent_code, level, name, slug) values ('1100500000', '1100000000', 'sigungu', '곧 폐지구', 'e2e-soon-gone')");
    await client.query("insert into public.regions (code, parent_code, level, name, slug) values ('1100600000', '1100000000', 'sigungu', '이미 폐지구', 'e2e-gone')");
    const id = await newUser();
    assert.ok((await putProfile(id, { interest_region_codes: ["1100500000"] })).ok);
    await client.query("update public.regions set valid_to = (now() at time zone 'Asia/Seoul')::date - 1 where code in ('1100500000', '1100600000')");
    const keep = await setProfile(id, "interest_region_codes", ["1100500000", "1100000000"]);
    assert.ok(keep.ok, `이미 고른 폐지 코드는 남고 새 유효 코드를 더할 수 있다: ${keep.message}`);
    const add = await setProfile(id, "interest_region_codes", ["1100500000", "1100000000", "1100600000"]);
    assert.equal(add.code, "23514", "폐지된 코드를 새로 더하는 것은 거부");
  }));

test("관심 분야·지역 저장은 consents에 행을 만들지 않는다 (ACC-02 — 0행)", () =>
  tx(async () => {
    const id = await newUser();
    assert.ok((await putProfile(id, { interests: ["tax", "local"], interest_region_codes: SIDO.slice(0, 3) })).ok);
    assert.ok((await setProfile(id, "interests", ["finance"])).ok);
    const { rows } = await client.query("select count(*)::int n from public.consents where user_id = $1", [id]);
    assert.equal(rows[0].n, 0);
  }));

test("설정 member가 없거나 모양이 틀리면 프로필 저장은 닫힌다(22023) — 한도를 모르는 채로 받지 않는다", () =>
  tx(async () => {
    const id = await newUser();
    await client.query("delete from public.settings where key = 'member'");
    const r = await putProfile(id, { interests: ["tax"] });
    assert.equal(r.code, "22023", r.message);
    await client.query("insert into public.settings (key, value) values ('member', '{\"interest_max\":\"many\"}'::jsonb)");
    assert.equal((await putProfile(id, { interests: ["tax"] })).code, "22023", "숫자가 아닌 상한");
  }));

test("tier·mode 같은 다른 칸만 고치는 저장은 관심 분야 검사를 다시 하지 않는다 (공개가 아니게 된 분야가 남아 있어도 저장 가능)", () =>
  tx(async () => {
    const id = await newUser();
    assert.ok((await putProfile(id, { interests: ["tax:amendments"] })).ok);
    await client.query("update public.categories set visible = false where section = 'tax' and slug = 'amendments'");
    const r = await setProfile(id, "mode_pref", "expert");
    assert.ok(r.ok, r.message);
    assert.equal(r.rows[0].mode_pref, "expert");
  }));

test("계정(auth.users)이 지워지면 프로필·동의 행도 함께 지워진다", () =>
  tx(async () => {
    const id = await newUser();
    assert.ok((await putProfile(id, { interests: ["tax"] })).ok);
    assert.ok((await attempt("insert into public.consents (user_id, kind, channel) values ($1, 'signup', 'web_signup')", [id])).ok);
    await client.query("delete from auth.users where id = $1", [id]);
    assert.equal((await client.query("select count(*)::int n from public.profiles where id = $1", [id])).rows[0].n, 0);
    assert.equal((await client.query("select count(*)::int n from public.consents where user_id = $1", [id])).rows[0].n, 0);
  }));

// ── consents ──

const putConsent = (cols) => {
  const keys = Object.keys(cols);
  return attempt(`insert into public.consents (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, Object.values(cols));
};

test("consents 칸 — PRD 6.1 칸(user_id·email·kind·channel·agreed_at·confirmed_at·revoked_at)과 설계 3.3 칸(version_ref·토큰 해시 둘)", async () => {
  const { rows } = await client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'consents' order by ordinal_position");
  assert.deepEqual(rows.map((r) => r.column_name), [
    "id", "user_id", "email", "kind", "channel", "version_ref", "agreed_at", "confirmed_at", "revoked_at", "confirm_token_hash", "revoke_token_hash", "created_at",
  ]);
});

test("consents 주체 — user_id와 email 중 정확히 하나: 둘 다 없음·둘 다 있음은 거부, 회원 행·사전 알림 행은 받는다", () =>
  tx(async () => {
    const id = await newUser();
    assert.ok((await putConsent({ user_id: id, kind: "signup", channel: "web_signup" })).ok, "회원");
    assert.ok((await putConsent({ email: "guest@example.test", kind: "brief_prereg", channel: "web_brief" })).ok, "비회원 사전 알림");
    assert.equal((await putConsent({ kind: "brief_prereg", channel: "web_brief" })).code, "23514", "둘 다 없음");
    assert.equal((await putConsent({ user_id: id, email: "both@example.test", kind: "brief_prereg", channel: "web_brief" })).code, "23514", "둘 다 있음");
  }));

test("consents 이메일 — brief_prereg 종류에서만, 소문자·앞뒤 공백 없음·이메일 모양만 (평문이 허용된 칸이라 모양을 엄격히)", () =>
  tx(async () => {
    const put = (email, kind = "brief_prereg") => putConsent({ email, kind, channel: "web_brief" });
    assert.equal((await put("signup@example.test", "signup")).code, "23514", "가입 동의에는 이메일 칸을 쓰지 않는다");
    assert.equal((await put("marketing@example.test", "marketing")).code, "23514");
    for (const bad of ["Guest@Example.test", " guest@example.test", "guest@example.test ", "guest", "guest@example", "@example.test", `${"a".repeat(310)}@example.test`]) {
      assert.equal((await put(bad)).code, "23514", `'${bad.slice(0, 40)}'`);
    }
    for (const good of ["guest@example.test", "first.last+tag@mail.example.co.kr", "a_b%c@x-y.example.test"]) assert.ok((await put(good)).ok, good);
  }));

test("consents 중복 — 철회되지 않은 같은 (종류, 회원)·(종류, 이메일)은 하나: 두 번째는 23505, 철회하면 다시 신청할 수 있고 다른 종류·다른 주체는 따로", () =>
  tx(async () => {
    const id = await newUser();
    const other = await newUser();
    assert.ok((await putConsent({ user_id: id, kind: "receive", channel: "web_my" })).ok);
    assert.equal((await putConsent({ user_id: id, kind: "receive", channel: "web_my" })).code, "23505", "같은 회원·같은 종류");
    assert.ok((await putConsent({ user_id: id, kind: "marketing", channel: "web_my" })).ok, "다른 종류");
    assert.ok((await putConsent({ user_id: other, kind: "receive", channel: "web_my" })).ok, "다른 회원");
    await client.query("update public.consents set revoked_at = now() where user_id = $1 and kind = 'receive'", [id]);
    assert.ok((await putConsent({ user_id: id, kind: "receive", channel: "web_my" })).ok, "철회 뒤 다시 동의");

    const mail = (e) => putConsent({ email: e, kind: "brief_prereg", channel: "web_brief" });
    assert.ok((await mail("dup@example.test")).ok);
    assert.equal((await mail("dup@example.test")).code, "23505", "같은 이메일 다시 신청 — 중복 저장 0");
    assert.ok((await mail("other@example.test")).ok);
    await client.query("update public.consents set revoked_at = now() where email = 'dup@example.test'");
    assert.ok((await mail("dup@example.test")).ok, "철회 뒤 다시 신청");
    assert.equal((await client.query("select count(*)::int n from public.consents where email = 'dup@example.test'")).rows[0].n, 2, "철회된 이력은 남는다");
  }));

test("consents 토큰 해시 — SHA-256 16진수 64글자만(원문 저장 0), 같은 해시는 두 행에 못 쓴다", () =>
  tx(async () => {
    const put = (cols) => putConsent({ kind: "brief_prereg", channel: "web_brief", ...cols });
    for (const bad of ["abc", "A".repeat(64), "g".repeat(64), "a".repeat(63), "a".repeat(65), "token-원문"]) {
      assert.equal((await put({ email: "t1@example.test", confirm_token_hash: bad })).code, "23514", `확인 토큰 '${bad.slice(0, 20)}'`);
      assert.equal((await put({ email: "t2@example.test", revoke_token_hash: bad })).code, "23514", `철회 토큰 '${bad.slice(0, 20)}'`);
    }
    assert.ok((await put({ email: "t3@example.test", confirm_token_hash: HASH("a"), revoke_token_hash: HASH("b") })).ok);
    assert.equal((await put({ email: "t4@example.test", confirm_token_hash: HASH("a") })).code, "23505", "확인 토큰 중복");
    assert.equal((await put({ email: "t5@example.test", revoke_token_hash: HASH("b") })).code, "23505", "철회 토큰 중복");
    assert.ok((await put({ email: "t6@example.test", confirm_token_hash: HASH("c") })).ok);
  }));

test("consents 기본값 — version_ref 빈 목록 · 동의 시각 자동 · 확인·철회 시각 비어 있음, version_ref는 문서 번호 목록을 담는다", () =>
  tx(async () => {
    const id = await newUser();
    const r = await putConsent({ user_id: id, kind: "signup", channel: "web_signup" });
    assert.deepEqual(r.rows[0].version_ref, []);
    assert.ok(r.rows[0].agreed_at instanceof Date);
    assert.equal(r.rows[0].confirmed_at, null);
    assert.equal(r.rows[0].revoked_at, null);
    const withRefs = await putConsent({ user_id: await newUser(), kind: "signup", channel: "web_signup", version_ref: [3, 7] });
    assert.deepEqual(withRefs.rows[0].version_ref, ["3", "7"], "bigint[] — 약관 번호와 처리방침 번호");
  }));

test("구독자(subscribers) 표는 만들지 않았다 — 사전 알림 신청은 consents에만 있다 (HOME-06 · 설계 3.3)", async () => {
  const { rows } = await client.query("select table_name from information_schema.tables where table_schema = 'public' and table_name in ('subscribers', 'orders', 'expert_requests')");
  assert.deepEqual(rows, []);
});
