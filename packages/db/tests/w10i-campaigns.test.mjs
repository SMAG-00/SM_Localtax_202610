// W10-i 마이그레이션 20261025000105 (바로가기·캠페인 랜딩 · 이번 주 재테크 포인트)
//  · 설정 씨앗·저장 검사(shortcut_order 3키 한 번씩 · home_shortcut_copy 30자 · campaign_utm_values 등록 값 모양) · 기능 키 3개 꺼짐 · 이벤트 4개 허용
//  · 캠페인: 직접 UPDATE로 승인 불가 · 도착 키·보조 규칙 · 승인 거부 코드마다 감사 1행 · 해시가 다른 검토 거부 · 승인 뒤 수정은 초안으로 · 추가만 표
//  · 공개 뷰: 승인 + 기간 · 끝난 행 문구 null · 키 꺼짐 0행
//  · 재테크 포인트: 3건 미만·초과 발행 거부 · 가격 칸 0(스키마) · 발행 뒤 주·항목 고정
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
const flag = (k, v) => client.query("update public.settings set value = value || $1::jsonb where key = 'feature_flags'", [JSON.stringify({ [k]: v })]);
const setSetting = (key, value) => attempt("update public.settings set value = $2::jsonb where key = $1", [key, JSON.stringify(value)]);
const landing = async (over = {}) => {
  const v = { key: "w10i-test", title: "시험용 제목", body: "시험용 본문", primary: "calc", secondary: null, tool: null, starts: "2020-01-01", ends: "2099-01-01", by: "writer", ...over };
  const r = await client.query(
    `insert into public.campaign_landings (campaign_key, title, body, primary_target, secondary_target, primary_tool, starts_at, ends_at, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id, content_hash`,
    [v.key, v.title, v.body, v.primary, v.secondary, v.tool, v.starts, v.ends, v.by],
  );
  return r.rows[0];
};
const fn = async (sql, params) => (await client.query(sql, params)).rows[0].r;
const codes = async (id) => (await client.query("select action, code from public.campaign_audit where landing_id = $1 order by id", [id])).rows;
async function readyToApprove(id) {
  await fn("select public.submit_campaign_landing($1, 'writer') r", [id]);
  await fn("select public.record_campaign_ad_review($1, '검토자', '문서 위치', array['표시광고법'], 'approved') r", [id]);
  await client.query("update public.campaign_landings set copy_check_hash = content_hash where id = $1", [id]);
}

test("씨앗 - 기능 키 3개는 꺼짐, shortcut_order 기본 순서, 설명은 비어 있음, 등록 값은 빈 목록", async () => {
  const ff = (await client.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  for (const k of ["shortcuts", "realestate_weekly", "campaign_landings"]) assert.equal(ff[k], false, k);
  const get = async (k) => (await client.query("select value from public.settings where key = $1", [k])).rows[0].value;
  assert.deepEqual(await get("shortcut_order"), ["calc", "realestate_weekly", "brief_weekly"]);
  assert.deepEqual(await get("home_shortcut_copy"), {});
  assert.deepEqual(await get("campaign_utm_values"), { source: [], medium: [], content: [] });
});

test("shortcut_order 저장 검사 - 3키를 한 번씩이면 통과, 누락·중복·상담 요청 포함·객체는 거부", async () => {
  await tx(async () => {
    assert.equal((await setSetting("shortcut_order", ["brief_weekly", "calc", "realestate_weekly"])).ok, true);
    for (const bad of [["calc", "realestate_weekly"], ["calc", "calc", "realestate_weekly"], ["calc", "realestate_weekly", "expert_request"], ["calc", "realestate_weekly", "brief_weekly", "expert_request"], { calc: 1 }]) {
      const r = await setSetting("shortcut_order", bad);
      assert.equal(r.ok, false, JSON.stringify(bad));
      assert.equal(r.code, "23514");
    }
  });
});

test("home_shortcut_copy·campaign_utm_values 저장 검사 - 경계와 모양", async () => {
  await tx(async () => {
    assert.equal((await setSetting("home_shortcut_copy", { calc: "가".repeat(30) })).ok, true);
    assert.equal((await setSetting("home_shortcut_copy", { calc: "가".repeat(31) })).ok, false, "31자");
    assert.equal((await setSetting("home_shortcut_copy", { nope: "x" })).ok, false, "모르는 키");
    assert.equal((await setSetting("home_shortcut_copy", { calc: "a\nb" })).ok, false, "줄바꿈");
    assert.equal((await setSetting("campaign_utm_values", { source: ["naver", "kakao"], medium: ["cpc"], content: [] })).ok, true);
    assert.equal((await setSetting("campaign_utm_values", { source: ["Naver"] })).ok, false, "대문자");
    assert.equal((await setSetting("campaign_utm_values", { source: ["other"] })).ok, false, "other 등록");
    assert.equal((await setSetting("campaign_utm_values", { source: Array.from({ length: 21 }, (_, i) => `s${i}`) })).ok, false, "21개");
    assert.equal((await setSetting("campaign_utm_values", { term: ["x"] })).ok, false, "utm_term 칸 없음");
  });
});

test("측정 이벤트 4개 허용, 세션 진입 경로 campaign 허용, 모르는 이름은 거부", async () => {
  await tx(async () => {
    const ins = (name, entry = "direct") =>
      attempt(
        `insert into public.analytics_events (name, session_id, first_visit, stage, entry, is_bot, props) values ($1, gen_random_uuid(), true, 2, $2, false, '{}'::jsonb)`,
        [name, entry],
      );
    for (const n of ["shortcut_clicked", "realestate_weekly_viewed", "campaign_landing_viewed", "campaign_cta_clicked"]) assert.equal((await ins(n)).ok, true, n);
    assert.equal((await ins("campaign_landing_viewed", "campaign")).ok, true, "entry campaign");
    assert.equal((await ins("campaign_gclid_seen")).ok, false);
    assert.equal((await ins("shortcut_clicked", "gclid")).ok, false);
  });
});

test("캠페인 표 제약 - 도착 4개 밖·보조 같음·도구는 계산기만·예약 키·글자 수·기간·채널", async () => {
  await tx(async () => {
    const tryLanding = (over) => attempt(
      `insert into public.campaign_landings (campaign_key, title, body, primary_target, secondary_target, primary_tool, channel, starts_at, ends_at, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,'2020-01-01','2099-01-01','w')`,
      [over.key ?? "w10i-c", over.title ?? "제목", over.body ?? "본문", over.primary ?? "calc", over.secondary ?? null, over.tool ?? null, over.channel ?? "other"],
    );
    assert.equal((await tryLanding({})).ok, true);
    assert.equal((await tryLanding({ key: "w10i-d", primary: "https://x.test" })).ok, false, "외부 주소");
    assert.equal((await tryLanding({ key: "w10i-e", primary: "/admin" })).ok, false, "관리 주소");
    assert.equal((await tryLanding({ key: "w10i-f", secondary: "calc" })).ok, false, "보조가 주와 같음");
    assert.equal((await tryLanding({ key: "w10i-g", primary: "brief_weekly", tool: "acquisition" })).ok, false, "도구는 계산기만");
    for (const k of ["admin", "api", "go", "A", "a"]) assert.equal((await tryLanding({ key: k })).ok, false, `키 ${k}`);
    assert.equal((await tryLanding({ key: "w10i-h", title: "가".repeat(30) })).ok, true, "제목 30자");
    assert.equal((await tryLanding({ key: "w10i-i", title: "가".repeat(31) })).ok, false, "제목 31자");
    assert.equal((await tryLanding({ key: "w10i-j", body: "가".repeat(120) })).ok, true, "본문 120자");
    assert.equal((await tryLanding({ key: "w10i-k", body: "가".repeat(121) })).ok, false, "본문 121자");
    assert.equal((await tryLanding({ key: "w10i-l", channel: "youtube" })).ok, false, "채널");
    assert.equal((await attempt("insert into public.campaign_landings (campaign_key,title,body,primary_target,starts_at,ends_at,created_by) values ('w10i-m','t','b','calc','2030-01-01','2030-01-01','w')")).ok, false, "시작 = 끝");
  });
});

test("직접 UPDATE·INSERT로 승인 불가, 주소 칸 없음", async () => {
  await tx(async () => {
    const { id } = await landing();
    assert.equal((await attempt("update public.campaign_landings set status = 'approved', approved_by = 'x', approved_at = now() where id = $1", [id])).ok, false);
    assert.equal((await attempt("update public.campaign_landings set status = 'submitted' where id = $1", [id])).ok, false);
    assert.equal((await attempt("insert into public.campaign_landings (campaign_key,title,body,primary_target,starts_at,ends_at,created_by,status) values ('w10i-n','t','b','calc','2020-01-01','2099-01-01','w','approved')")).ok, false);
    const cols = (await client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'campaign_landings'")).rows.map((r) => r.column_name);
    assert.ok(!cols.some((c) => /url|href|link/.test(c)), "주소 칸 0");
  });
});

test("승인 함수 - 거부 코드마다 감사 1행, 예외 없이 {ok, code} 반환", async () => {
  await tx(async () => {
    assert.deepEqual(await fn("select public.approve_campaign_landing(999999, 'boss') r").then((r) => [r.ok, r.code]), [false, "not_found"]);
    const { id } = await landing();
    assert.equal((await fn("select public.approve_campaign_landing($1, 'boss') r", [id])).code, "not_submitted");
    await fn("select public.submit_campaign_landing($1, 'writer') r", [id]);
    assert.equal((await fn("select public.approve_campaign_landing($1, '  ') r", [id])).code, "approver_invalid");
    assert.equal((await fn("select public.approve_campaign_landing($1, 'Writer') r", [id])).code, "same_person", "작성자 본인(대소문자 무시)");
    assert.equal((await fn("select public.approve_campaign_landing($1, 'boss') r", [id])).code, "review_missing");
    await fn("select public.record_campaign_ad_review($1, '검토자', '문서', array['표시광고법'], 'rejected') r", [id]);
    assert.equal((await fn("select public.approve_campaign_landing($1, 'boss') r", [id])).code, "review_rejected");
    await fn("select public.record_campaign_ad_review($1, '검토자', '문서', array['표시광고법'], 'approved') r", [id]);
    assert.equal((await fn("select public.approve_campaign_landing($1, 'boss') r", [id])).code, "copy_check_stale", "문구 검사 해시 없음");
    await client.query("update public.campaign_landings set copy_check_hash = content_hash where id = $1", [id]);
    const ok = await fn("select public.approve_campaign_landing($1, 'boss') r", [id]);
    assert.deepEqual([ok.ok, ok.code], [true, "ok"]);
    const approve = (await codes(id)).filter((r) => r.action === "approve").map((r) => r.code);
    assert.deepEqual(approve, ["not_submitted", "approver_invalid", "same_person", "review_missing", "review_rejected", "copy_check_stale", "ok"], "시도마다 감사 1행");
  });
});

test("검토 기록 해시가 지금 문구와 다르면 review_stale, 승인 뒤 문구·도착·기간을 고치면 초안으로", async () => {
  await tx(async () => {
    const { id } = await landing();
    await readyToApprove(id);
    await client.query("update public.campaign_landings set title = '바뀐 제목' where id = $1", [id]);
    const row = (await client.query("select status, submitted_at from public.campaign_landings where id = $1", [id])).rows[0];
    assert.equal(row.status, "draft", "제출 뒤 문구 수정 -> 초안");
    assert.equal(row.submitted_at, null);
    await fn("select public.submit_campaign_landing($1, 'writer') r", [id]);
    await client.query("update public.campaign_landings set copy_check_hash = content_hash where id = $1", [id]);
    assert.equal((await fn("select public.approve_campaign_landing($1, 'boss') r", [id])).code, "review_stale", "검토 해시 != 지금 해시");
    await fn("select public.record_campaign_ad_review($1, '검토자', '문서', array['표시광고법'], 'approved') r", [id]);
    assert.equal((await fn("select public.approve_campaign_landing($1, 'boss') r", [id])).ok, true);
    for (const sql of ["update public.campaign_landings set primary_target = 'expert_request' where id = $1", "update public.campaign_landings set ends_at = '2098-01-01' where id = $1"]) {
      await client.query(sql, [id]);
      const s = (await client.query("select status, approved_by, approved_at from public.campaign_landings where id = $1", [id])).rows[0];
      assert.deepEqual([s.status, s.approved_by, s.approved_at], ["draft", null, null], sql);
      // 다시 제출 -> 문구 검사 -> 검토 -> 승인 (다음 수정을 승인 상태에서 시험하기 위해)
      await fn("select public.submit_campaign_landing($1, 'writer') r", [id]);
      await client.query("update public.campaign_landings set copy_check_hash = content_hash where id = $1", [id]);
      await fn("select public.record_campaign_ad_review($1, '검토자', '문서', array['표시광고법'], 'approved') r", [id]);
      assert.equal((await fn("select public.approve_campaign_landing($1, 'boss') r", [id])).ok, true, `${sql} 뒤 재승인`);
    }
  });
});

test("검토 기록 범위는 3개 법 안의 값만, 감사·검토 표는 추가만", async () => {
  await tx(async () => {
    const { id } = await landing();
    assert.equal((await fn("select public.record_campaign_ad_review($1, '검토자', '문서', array['형법'], 'approved') r", [id])).code, "scope_invalid");
    assert.equal((await fn("select public.record_campaign_ad_review($1, '', '문서', array['표시광고법'], 'approved') r", [id])).code, "review_incomplete");
    await fn("select public.record_campaign_ad_review($1, '검토자', '문서', array['표시광고법'], 'approved') r", [id]);
    assert.equal((await attempt("update public.campaign_ad_reviews set note = 'x' where landing_id = $1", [id])).ok, false);
    assert.equal((await attempt("delete from public.campaign_ad_reviews where landing_id = $1", [id])).ok, false);
    assert.equal((await attempt("update public.campaign_audit set code = 'x' where landing_id = $1", [id])).ok, false);
    assert.equal((await attempt("delete from public.campaign_audit where landing_id = $1", [id])).ok, false);
  });
});

test("함수와 표는 anon·authenticated가 부를 수 없다", async () => {
  await tx(async () => {
    for (const role of ["anon", "authenticated"]) {
      assert.equal((await attempt("select public.approve_campaign_landing(1, 'x')", [], role)).ok, false, `${role} 승인 함수`);
      assert.equal((await attempt("select public.publish_realestate_weekly(1, 'x')", [], role)).ok, false, `${role} 발행 함수`);
      assert.equal((await attempt("select * from public.campaign_landings", [], role)).ok, false, `${role} 캠페인 표`);
      assert.equal((await attempt("select * from public.realestate_weekly_issues", [], role)).ok, false, `${role} 호 표`);
    }
  });
});

test("공개 뷰 - 승인+기간 안만 live, 끝난 행은 ended+문구 null, 초안·철회·미래 시작은 0행, 키 꺼짐이면 0행", async () => {
  await tx(async () => {
    const a = await landing({ key: "w10i-live", secondary: "expert_request" });
    const b = await landing({ key: "w10i-ended", starts: "2020-01-01", ends: "2020-02-01" });
    const c = await landing({ key: "w10i-future", starts: "2098-01-01", ends: "2099-01-01" });
    await landing({ key: "w10i-draft" });
    for (const x of [a, b, c]) await readyToApprove(x.id).then(() => fn("select public.approve_campaign_landing($1, 'boss') r", [x.id]));
    await flag("campaign_landings", false);
    assert.equal((await client.query("select count(*)::int n from public.public_campaign_landings where campaign_key like 'w10i-%'")).rows[0].n, 0, "키 꺼짐 0행");
    await flag("campaign_landings", true);
    const rows = (await client.query("select * from public.public_campaign_landings where campaign_key like 'w10i-%' order by campaign_key")).rows;
    assert.deepEqual(rows.map((r) => [r.campaign_key, r.state]), [["w10i-ended", "ended"], ["w10i-live", "live"]]);
    const ended = rows[0];
    assert.deepEqual([ended.title, ended.body, ended.secondary_target], [null, null, null], "끝난 행 문구 null");
    assert.equal(rows[1].title, "시험용 제목");
    const asAnon = await attempt("select campaign_key from public.public_campaign_landings", [], "anon");
    assert.equal(asAnon.ok, true, "anon 읽기");
    await fn("select public.withdraw_campaign_landing($1, 'boss') r", [a.id]);
    assert.equal((await client.query("select count(*)::int n from public.public_campaign_landings where campaign_key = 'w10i-live'")).rows[0].n, 0, "철회 0행");
  });
});

test("재테크 포인트 - 스키마에 가격·수익률 칸 0, 3건 미만·초과 발행 거부, 발행 뒤 주 고정", async () => {
  await tx(async () => {
    const cols = (await client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name in ('realestate_weekly_items','realestate_weekly_issues')")).rows.map((r) => r.column_name);
    assert.ok(!cols.some((c) => /price|yield|profit|return|premium|rate|amount|cost/.test(c)), `가격·수익률 칸 0: ${cols.join(",")}`);
    const issue = (await client.query("insert into public.realestate_weekly_issues (week, edited_by) values ('9998-01', 'editor') returning id")).rows[0].id;
    assert.equal((await fn("select public.publish_realestate_weekly($1, 'editor') r", [issue])).code, "items_too_few", "0건");
    assert.equal((await attempt("insert into public.realestate_weekly_items (issue_id, article_id, rank, tax_items, point) values ($1, 1, 8, array['취득세'], 'x')", [issue])).ok, false, "순서 8");
    assert.equal((await attempt("insert into public.realestate_weekly_items (issue_id, article_id, rank, tax_items, point) values ($1, 1, 1, '{}', 'x')", [issue])).ok, false, "세목 0개");
    assert.equal((await attempt("insert into public.realestate_weekly_items (issue_id, article_id, rank, tax_items, point) values ($1, 1, 1, array['취득세'], $2)", [issue, "가".repeat(61)])).ok, false, "61자");
    assert.equal((await attempt("update public.realestate_weekly_issues set status = 'published', approved_by = 'x', published_at = now() where id = $1", [issue])).ok, false, "직접 발행 불가");
    assert.equal((await fn("select public.publish_realestate_weekly(999999, 'editor') r")).code, "not_found");
    const audit = await client.query("select code from public.realestate_weekly_audit where issue_id = $1 order by id", [issue]);
    assert.deepEqual(audit.rows.map((r) => r.code), ["items_too_few"]);
  });
});

test("재테크 포인트 - 공개 기사가 아닌 기사는 발행 거부(article_not_public), 같은 주 호는 하나", async () => {
  await tx(async () => {
    const art = (await client.query("select id from public.articles where status <> 'published' order by id limit 3")).rows;
    if (art.length < 3) return; // 초안 기사 3건이 없는 빈 DB에서는 건너뛴다 (E2E가 기사 생성 흐름을 본다)
    const issue = (await client.query("insert into public.realestate_weekly_issues (week, edited_by) values ('9998-02', 'editor') returning id")).rows[0].id;
    for (const [i, a] of art.entries()) await client.query("insert into public.realestate_weekly_items (issue_id, article_id, rank, tax_items, point) values ($1,$2,$3,array['취득세'],'시험용 한 줄')", [issue, a.id, i + 1]);
    assert.equal((await fn("select public.publish_realestate_weekly($1, 'editor') r", [issue])).code, "article_not_public");
    assert.equal((await attempt("insert into public.realestate_weekly_issues (week, edited_by) values ('9998-02', 'editor')")).ok, false, "같은 주 중복");
  });
});

test("공개 재테크 포인트 뷰 - 키 꺼짐·발행 전은 0행", async () => {
  await tx(async () => {
    await client.query("insert into public.realestate_weekly_issues (week, edited_by) values ('9998-03', 'editor')");
    await flag("realestate_weekly", true);
    assert.equal((await client.query("select count(*)::int n from public.public_realestate_weekly where week = '9998-03'")).rows[0].n, 0, "초안은 0행");
    await flag("realestate_weekly", false);
    assert.equal((await client.query("select count(*)::int n from public.public_realestate_weekly")).rows[0].n, 0, "키 꺼짐 0행");
  });
});

test("하위 분야 주소 weekly는 예약 - 분야 표에 넣을 수 없고 비슷한 주소는 가능", async () => {
  await tx(async () => {
    const ins = (slug) => attempt("insert into public.categories (section, slug, name, sort, visible, needs_disclaimer, needs_tax_lens) values ('realestate', $1, '시험용', 900, false, false, false)", [slug]);
    const bad = await ins("weekly");
    assert.equal(bad.ok, false);
    assert.equal(bad.code, "23514");
    assert.equal((await ins("weekly-news")).ok, true);
  });
});
