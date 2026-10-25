// W10-e e2 DB - 브리핑·구독·알림 (마이그레이션 92, PRD-02 BRIEF-01~04 · HOME-09 · TX-12)
//  · 발행: 승인 전 0 / 발행 시각 09:59:59 KST 0, 10:00:00 KST 발행 / 재발행 'already' / 승인 조건(보고서·차단 0·경고 확인·AI 검수) / 승인 뒤 본문 고치기 거부 / 공개 뷰
//  · 구독: 이중 확인 전 수신자 0 / 철회 뒤 0 / 재확인 기한 당일 포함·다음 날 제외 / 재확인 안내 전날 0·당일 1·다음 날 0 / 확인 시 기한 자동 채움
//  · 알림: 수신자당 1통(자리 잡기 유일, 실패는 3회까지 재시도) / 개정안 번호 일치만 / 비공개 개정안·미확인·철회 0 / 브리핑과 알림은 따로 해지
//  · 사전 알림 안내: 이중 확인한 신청자만, 구독 동의 행 자동 생성 0
// 값은 모두 시험용이고 거래 안에서 돌고 되돌린다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { open, helpers } from "./_w10c_helpers.mjs";

let client;
let h;
let seq = 0;
before(async () => {
  client = await open();
  h = helpers(client);
});
after(async () => client?.end());

const email = (p) => `${p}-${process.pid}-${++seq}@example.test`;
const REPORT_OK = JSON.stringify({ blocking: 0, warnings: 0, findings: [] });

async function consent({ kind = "brief", confirmed = true, revoked = false, due = null, confirmedAt = "2026-11-01T00:00:00Z" } = {}) {
  const r = await h.one("insert into public.consents (email, kind, channel, confirmed_at, revoked_at) values ($1, $2, 'web_brief', $3, $4) returning id", [email("w10e"), kind, confirmed ? confirmedAt : null, revoked ? "2026-11-02T00:00:00Z" : null]);
  if (due) await client.query("update public.consents set reconfirm_due = $2 where id = $1", [r.id, due]);
  return Number(r.id);
}
async function issue({ publishAt = "2026-11-02T10:00:00+09:00", corners = "[]", hasAd = false } = {}) {
  const r = await h.one("insert into public.brief_issues (issue_no, title, publish_at, corners, has_ad, created_by) values ($1, '시험용 브리핑', $2, $3::jsonb, $4, 'w10e-test') returning id", [900 + ++seq, publishAt, corners, hasAd]);
  return Number(r.id);
}
async function publishedIssue() {
  const id = await issue();
  await client.query("update public.brief_issues set check_report = $2::jsonb where id = $1", [id, REPORT_OK]);
  await client.query("select public.brief_issue_approve($1, 'w10e-test')", [id]);
  await client.query("select public.brief_issue_publish($1, '2026-11-02T10:00:00+09:00')", [id]);
  return id;
}
const recipients = async (id, today) => (await client.query("select consent_id from public.brief_recipients($1, $2::date)", [id, today])).rows.map((r) => Number(r.consent_id));

test("발행 시각 경계 - 09:59:59 KST는 not_due, 10:00:00 KST에 published, 다시 부르면 already", () =>
  h.tx(async () => {
    const id = await issue();
    assert.equal((await h.one("select public.brief_issue_publish($1, '2026-11-02T10:00:00+09:00') as r", [id])).r, "not_approved");
    await client.query("update public.brief_issues set check_report = $2::jsonb where id = $1", [id, REPORT_OK]);
    await client.query("select public.brief_issue_approve($1, 'w10e-test')", [id]);
    assert.equal((await h.one("select public.brief_issue_publish($1, '2026-11-02T09:59:59+09:00') as r", [id])).r, "not_due");
    assert.equal((await h.one("select public.brief_issue_publish($1, '2026-11-02T01:00:00Z') as r", [id])).r, "published", "UTC 01:00 = KST 10:00");
    assert.equal((await h.one("select public.brief_issue_publish($1, '2026-11-02T10:05:00+09:00') as r", [id])).r, "already");
    const due = await client.query("select id from public.brief_issues_due('2026-11-02T10:00:00+09:00') where id = $1", [id]);
    assert.equal(due.rowCount, 0, "발행된 호는 대상이 아니다");
  }));

test("발행 대상 목록 - 승인된 호만, 발행 시각 이후만", () =>
  h.tx(async () => {
    const draft = await issue({ publishAt: "2026-11-09T10:00:00+09:00" });
    const approved = await issue({ publishAt: "2026-11-16T10:00:00+09:00" });
    await client.query("update public.brief_issues set check_report = $2::jsonb where id = $1", [approved, REPORT_OK]);
    await client.query("select public.brief_issue_approve($1, 'w10e-test')", [approved]);
    const at = async (t) => (await client.query("select id from public.brief_issues_due($1::timestamptz) where id = any($2::bigint[])", [t, [draft, approved]])).rows.map((r) => Number(r.id));
    assert.deepEqual(await at("2026-11-16T09:59:59+09:00"), []);
    assert.deepEqual(await at("2026-11-16T10:00:00+09:00"), [approved]);
  }));

test("승인 조건 - 보고서 없음·차단 있음 거부, 경고는 확인자 필요, AI 항목은 검수 완료여야 한다", () =>
  h.tx(async () => {
    const id = await issue();
    assert.match((await h.attempt("select public.brief_issue_approve($1, 'w10e-test')", [id])).message, /검사기 8종/);
    await client.query("update public.brief_issues set check_report = '{\"blocking\":2,\"warnings\":0}'::jsonb where id = $1", [id]);
    assert.match((await h.attempt("select public.brief_issue_approve($1, 'w10e-test')", [id])).message, /차단 항목 2건/);
    await client.query("update public.brief_issues set check_report = '{\"blocking\":0,\"warnings\":3}'::jsonb where id = $1", [id]);
    assert.match((await h.attempt("select public.brief_issue_approve($1, 'w10e-test')", [id])).message, /경고 3건/);
    assert.ok((await h.attempt("select public.brief_issue_approve($1, 'w10e-test', '시험용 검수자')", [id])).ok);

    const ai = await issue({ publishAt: "2026-11-09T10:00:00+09:00", corners: JSON.stringify([{ key: "k", title: "t", items: [{ id: "x", text: "시험용", origin: "ai", reviewed: false }] }]) });
    await client.query("update public.brief_issues set check_report = $2::jsonb where id = $1", [ai, REPORT_OK]);
    assert.match((await h.attempt("select public.brief_issue_approve($1, 'w10e-test')", [ai])).message, /AI가 쓴 항목/);
    await client.query("update public.brief_issues set corners = $2::jsonb where id = $1", [ai, JSON.stringify([{ key: "k", title: "t", items: [{ id: "x", text: "시험용", origin: "ai", reviewed: true }] }])]);
    // 본문이 바뀌면 보고서가 비워져서 다시 검사해야 한다
    assert.equal((await h.one("select check_report from public.brief_issues where id = $1", [ai])).check_report, null);
    await client.query("update public.brief_issues set check_report = $2::jsonb where id = $1", [ai, REPORT_OK]);
    assert.ok((await h.attempt("select public.brief_issue_approve($1, 'w10e-test')", [ai])).ok);
  }));

test("상태는 함수로만 바뀌고, 승인된 호의 본문은 고칠 수 없으며, 승인 취소하면 다시 고칠 수 있다", () =>
  h.tx(async () => {
    const id = await issue();
    assert.match((await h.attempt("update public.brief_issues set status = 'published', published_at = now() where id = $1", [id])).message, /승인·발행 함수로만/);
    await client.query("update public.brief_issues set check_report = $2::jsonb where id = $1", [id, REPORT_OK]);
    await client.query("select public.brief_issue_approve($1, 'w10e-test')", [id]);
    assert.match((await h.attempt("update public.brief_issues set title = '바꾼 제목' where id = $1", [id])).message, /본문은 고칠 수 없습니다/);
    await client.query("select public.brief_issue_unapprove($1, 'w10e-test')", [id]);
    assert.ok((await h.attempt("update public.brief_issues set title = '바꾼 제목' where id = $1", [id])).ok);
    assert.match((await h.attempt("delete from public.brief_issues where id = $1", [id])).message, /지울 수 없습니다/);
  }));

test("공개 뷰 - 발행된 일반 호만, 초안·승인 대기는 0, 원문 발췌 칸은 읽을 수 없다", () =>
  h.tx(async () => {
    const draft = await issue({ publishAt: "2026-11-09T10:00:00+09:00" });
    const pub = await publishedIssue();
    const seen = (await client.query("select issue_no from public.public_brief_issues where issue_no = any($1::int[])", [[(await h.one("select issue_no from public.brief_issues where id = $1", [draft])).issue_no, (await h.one("select issue_no from public.brief_issues where id = $1", [pub])).issue_no]])).rows;
    assert.equal(seen.length, 1);
    assert.equal(seen[0].issue_no, (await h.one("select issue_no from public.brief_issues where id = $1", [pub])).issue_no);
    assert.ok((await h.attempt("select issue_no, title, corners from public.public_brief_issues limit 1", [], "anon")).ok);
    const leak = await h.attempt("select source_excerpts from public.public_brief_issues limit 1", [], "anon");
    assert.equal(leak.ok, false);
    const direct = await h.attempt("select * from public.brief_issues limit 1", [], "anon");
    assert.equal(direct.ok, false);
  }));

test("수신자 - 이중 확인 전·철회 0, 확인된 미철회만, 재확인 기한은 당일까지 포함하고 다음 날부터 제외", () =>
  h.tx(async () => {
    const id = await publishedIssue();
    const ok = await consent();
    await consent({ confirmed: false });
    await consent({ revoked: true });
    const dueToday = await consent({ due: "2026-11-10" });
    const lapsed = await consent({ due: "2026-11-09" });
    await consent({ kind: "amendment_alert" });
    await consent({ kind: "brief_prereg" });
    const set = new Set(await recipients(id, "2026-11-10"));
    assert.ok(set.has(ok) && set.has(dueToday), "확인된 구독자와 기한 당일 구독자");
    assert.ok(!set.has(lapsed), "기한이 하루 지난 구독자는 발송 중지");
    const unconfirmedOrRevoked = (await client.query("select id from public.consents where kind = 'brief' and (confirmed_at is null or revoked_at is not null)")).rows.map((r) => Number(r.id));
    assert.ok(unconfirmedOrRevoked.every((x) => !set.has(x)), "이중 확인 전·철회 행은 수신자가 아니다");
    // 발송 완료 기록이 있으면 제외 (수신자당 1통)
    await client.query("select public.alert_delivery_claim($1, 'brief_issue', $2)", [ok, String(id)]);
    await client.query("select public.alert_delivery_mark($1, 'brief_issue', $2, true)", [ok, String(id)]);
    assert.ok(!(await recipients(id, "2026-11-10")).includes(ok));
  }));

test("발행 전 호의 수신자는 0", () =>
  h.tx(async () => {
    const id = await issue();
    await consent();
    assert.deepEqual(await recipients(id, "2026-11-10"), []);
  }));

test("확인할 때 재확인 기한이 한국 날짜 + 24개월로 채워지고, 사전 알림에는 채워지지 않는다", () =>
  h.tx(async () => {
    const b = await consent({ confirmedAt: "2026-10-31T15:30:00Z" }); // KST 2026-11-01 00:30
    assert.equal((await h.one("select reconfirm_due::text as d from public.consents where id = $1", [b])).d, "2028-11-01");
    const p = await consent({ kind: "brief_prereg" });
    assert.equal((await h.one("select reconfirm_due from public.consents where id = $1", [p])).reconfirm_due, null);
    const u = await consent({ confirmed: false });
    await client.query("update public.consents set confirmed_at = '2026-08-31T00:00:00Z' where id = $1", [u]);
    assert.equal((await h.one("select reconfirm_due::text as d from public.consents where id = $1", [u])).d, "2028-08-31");
    assert.equal((await h.attempt("update public.consents set reconfirm_due = '2030-01-01' where id = $1", [p])).ok, false, "사전 알림에는 재확인 기한을 둘 수 없다");
  }));

test("재확인 안내 대상 - 전날 0, 당일 1, 안내를 보낸 뒤·다음 날 0, 재확인하면 기한이 미뤄진다", () =>
  h.tx(async () => {
    const c = await consent({ due: "2028-11-01" });
    const at = async (d) => (await client.query("select consent_id from public.reconfirm_due_today($1::date) where consent_id = $2", [d, c])).rowCount;
    assert.equal(await at("2028-10-31"), 0);
    assert.equal(await at("2028-11-01"), 1);
    assert.equal((await h.one("select public.alert_delivery_claim($1, 'reconfirm', '2028-11-01') as ok", [c])).ok, true);
    await client.query("select public.alert_delivery_mark($1, 'reconfirm', '2028-11-01', true)", [c]);
    assert.equal(await at("2028-11-01"), 0, "같은 날 중복 안내 0");
    assert.equal(await at("2028-11-02"), 0, "다음 날 안내 0");
    const due = (await h.one("select public.consent_reconfirm($1, '2028-11-01') as d", [c])).d;
    assert.equal(new Date(due).getUTCFullYear(), 2030);
    const un = await consent({ confirmed: false });
    assert.equal((await h.attempt("select public.consent_reconfirm($1, '2028-11-01')", [un])).ok, false, "확인 전 구독은 재확인 대상이 아니다");
  }));

test("발송 자리 잡기 - 처음 true, 두 번째 false, 실패는 3회까지 다시 true, 성공 뒤 false", () =>
  h.tx(async () => {
    const c = await consent({ kind: "amendment_alert" });
    const claim = async () => (await h.one("select public.alert_delivery_claim($1, 'amendment_alert', '77') as ok", [c])).ok;
    assert.equal(await claim(), true);
    assert.equal(await claim(), false, "아직 진행 중");
    await client.query("select public.alert_delivery_mark($1, 'amendment_alert', '77', false)", [c]);
    for (let n = 1; n <= 3; n++) {
      assert.equal(await claim(), true, `재시도 ${n}`);
      await client.query("select public.alert_delivery_mark($1, 'amendment_alert', '77', false)", [c]);
    }
    assert.equal(await claim(), false, "4번째 재시도 거부");
    const c2 = await consent({ kind: "amendment_alert" });
    assert.equal((await h.one("select public.alert_delivery_claim($1, 'amendment_alert', '78') as ok", [c2])).ok, true);
    await client.query("select public.alert_delivery_mark($1, 'amendment_alert', '78', true)", [c2]);
    assert.equal((await h.one("select public.alert_delivery_claim($1, 'amendment_alert', '78') as ok", [c2])).ok, false);
    assert.equal(Number((await h.one("select count(*) from public.alert_deliveries where consent_id = $1", [c2])).count), 1);
  }));

async function stageEvent(status = "public") {
  const am = await h.one("insert into public.amendments (slug, title, status) values ($1, '시험용 개정안', $2) returning id", [h.uniq("w10e-al"), status]);
  const snap = await h.snapshot();
  const ev = await h.one("insert into public.amendment_events (amendment_id, stage, occurred_on, source_url, snapshot_id, recorded_by) values ($1, 'announced', '2099-01-01', 'https://example.test/s', $2, 't') returning id", [am.id, snap]);
  return { amendmentId: Number(am.id), eventId: Number(ev.id) };
}
async function alertSub(amendmentIds, over = {}) {
  const c = await consent({ kind: "amendment_alert", ...over });
  await client.query("insert into public.subscriber_prefs (consent_id, amendment_ids) values ($1, $2::bigint[])", [c, amendmentIds]);
  return c;
}
const alertTargets = async (eventId, today = "2026-11-10") => (await client.query("select consent_id from public.amendment_alert_recipients($1, $2::date)", [eventId, today])).rows.map((r) => Number(r.consent_id));

test("개정 알림 수신자 - 고른 개정안과 일치하는 확인된 구독자만, 미확인·철회·다른 개정안·비공개 개정안은 0", () =>
  h.tx(async () => {
    const { amendmentId, eventId } = await stageEvent();
    const other = await stageEvent();
    const hit = await alertSub([amendmentId]);
    await alertSub([amendmentId], { confirmed: false });
    await alertSub([amendmentId], { revoked: true });
    await alertSub([other.amendmentId]);
    assert.deepEqual(await alertTargets(eventId), [hit]);
    const priv = await stageEvent("draft");
    await alertSub([priv.amendmentId]);
    assert.deepEqual(await alertTargets(priv.eventId), [], "공개 전 개정안의 단계 변경은 알리지 않는다");
    await client.query("select public.alert_delivery_claim($1, 'amendment_alert', $2)", [hit, String(eventId)]);
    await client.query("select public.alert_delivery_mark($1, 'amendment_alert', $2, true)", [hit, String(eventId)]);
    assert.deepEqual(await alertTargets(eventId), [], "보낸 알림은 다시 대상이 되지 않는다 (멱등)");
  }));

test("브리핑과 알림은 따로 해지된다 - 한쪽을 철회해도 다른 쪽 수신자 자격은 그대로", () =>
  h.tx(async () => {
    const em = email("both");
    const brief = Number((await h.one("insert into public.consents (email, kind, channel, confirmed_at) values ($1, 'brief', 'web_brief', now()) returning id", [em])).id);
    const alert = Number((await h.one("insert into public.consents (email, kind, channel, confirmed_at) values ($1, 'amendment_alert', 'web_brief', now()) returning id", [em])).id);
    await client.query("update public.consents set revoked_at = now() where id = $1", [alert]);
    const id = await publishedIssue();
    assert.ok((await recipients(id, "2026-11-10")).includes(brief));
    assert.equal((await h.one("select revoked_at from public.consents where id = $1", [brief])).revoked_at, null);
  }));

test("관심 설정은 알림 구독에만 둘 수 있고, 세목 12개·개정안 50개 상한", () =>
  h.tx(async () => {
    const brief = await consent({ kind: "brief" });
    assert.match((await h.attempt("insert into public.subscriber_prefs (consent_id) values ($1)", [brief])).message, /알림 구독에만/);
    const a = await consent({ kind: "amendment_alert" });
    const kinds = (n) => Array.from({ length: n }, (_, i) => `kind-${i}`);
    assert.ok((await h.attempt("insert into public.subscriber_prefs (consent_id, tax_kinds) values ($1, $2::text[])", [a, kinds(12)])).ok);
    const b = await consent({ kind: "amendment_alert" });
    assert.equal((await h.attempt("insert into public.subscriber_prefs (consent_id, tax_kinds) values ($1, $2::text[])", [b, kinds(13)])).ok, false);
    const c = await consent({ kind: "amendment_alert" });
    assert.equal((await h.attempt("insert into public.subscriber_prefs (consent_id, tax_kinds) values ($1, $2::text[])", [c, ["Bad Slug"]])).ok, false);
  }));

test("사전 알림 안내 대상 - 이중 확인한 신청자만, 안내 뒤 0, 구독 동의 행은 자동으로 생기지 않는다", () =>
  h.tx(async () => {
    const ok = await consent({ kind: "brief_prereg" });
    const unconfirmed = await consent({ kind: "brief_prereg", confirmed: false });
    const revoked = await consent({ kind: "brief_prereg", revoked: true });
    const briefBefore = Number((await h.one("select count(*) from public.consents where kind = 'brief'")).count);
    const ids = async () => (await client.query("select consent_id from public.prereg_notice_recipients()")).rows.map((r) => Number(r.consent_id));
    const first = await ids();
    assert.ok(first.includes(ok) && !first.includes(unconfirmed) && !first.includes(revoked));
    await client.query("select public.alert_delivery_claim($1, 'prereg_notice', 'first_issue')", [ok]);
    await client.query("select public.alert_delivery_mark($1, 'prereg_notice', 'first_issue', true)", [ok]);
    assert.ok(!(await ids()).includes(ok), "1회 발송");
    assert.equal(Number((await h.one("select count(*) from public.consents where kind = 'brief'")).count), briefBefore);
  }));

test("동의 종류·이메일 칸 - 새 종류도 이메일을 허용하고, 가입 동의에는 이메일을 둘 수 없다", () =>
  h.tx(async () => {
    for (const kind of ["brief", "amendment_alert"]) assert.ok((await h.attempt("insert into public.consents (email, kind, channel) values ($1, $2, 'web_brief')", [email(kind), kind])).ok, kind);
    const bad = await h.attempt("insert into public.consents (email, kind, channel) values ($1, 'signup', 'web_signup')", [email("signup")]);
    assert.equal(bad.ok, false);
    assert.match(bad.message, /consents_email_only_prereg/);
    const dup = email("dup");
    await client.query("insert into public.consents (email, kind, channel) values ($1, 'brief', 'web_brief')", [dup]);
    assert.equal((await h.attempt("insert into public.consents (email, kind, channel) values ($1, 'brief', 'web_brief')", [dup])).ok, false, "같은 주소로 다시 신청하면 중복 행 0");
  }));

test("개인정보 정리 - 새 종류의 미확인 신청·철회 동의도 같은 기한에 지워진다", () =>
  h.tx(async () => {
    const old = "2020-01-01T00:00:00Z";
    const a = await consent({ kind: "brief", confirmed: false });
    const b = await consent({ kind: "amendment_alert", confirmed: false });
    const fresh = await consent({ kind: "brief", confirmed: false });
    const r = await consent({ kind: "brief", revoked: true });
    await client.query("update public.consents set created_at = $2 where id = any($1::bigint[])", [[a, b], old]);
    await client.query("update public.consents set revoked_at = $2 where id = $1", [r, old]);
    const out = (await h.one("select public.privacy_purge_rows('2026-11-10T00:00:00Z', 30, 30, 365) as j")).j;
    assert.ok(out.unconfirmed_prereg >= 2 && out.revoked_consents >= 1);
    const left = (await client.query("select id from public.consents where id = any($1::bigint[])", [[a, b, fresh, r]])).rows.map((x) => Number(x.id));
    assert.deepEqual(left, [fresh]);
  }));

test("새 함수·표는 anon·authenticated가 쓸 수 없다", () =>
  h.tx(async () => {
    for (const sql of ["select * from public.brief_recipients(1, '2026-11-10'::date)", "select public.brief_issue_publish(1)", "select public.alert_delivery_claim(1, 'reconfirm', 'x')", "select * from public.prereg_notice_recipients()", "select * from public.alert_deliveries", "select * from public.subscriber_prefs"]) {
      for (const role of ["anon", "authenticated"]) {
        const res = await h.attempt(sql, [], role);
        assert.equal(res.ok, false, `${role}: ${sql}`);
        assert.match(res.message, /permission denied/);
      }
    }
  }));
