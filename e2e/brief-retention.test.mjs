// 브리핑 사전 알림 · 보존 기한 배치 E2E (W2-e 6단계 — docs/dev/W2-e_설계.md 1장 6단계 · 7.5 · 9.3)
//  a) brief 기능 키 꺼짐이면 /brief·/brief/confirm·/brief/unsubscribe 와 API가 404, 켜지면 폼(동의 체크 칸·숨은 칸·열림 토큰)이 열리고 홈에는 신청 폼이 없다
//  b) 동의 없이 제출 불가 · 형식 오류 · 숨은 칸(봇) 거부 — 거부된 제출은 consents 행 0 · 메일 0
//  c) 정상 신청 → 확인 메일 → 확인 전 미확정(링크를 열어도 확정 안 됨) → 버튼(POST)으로 확정 · 토큰은 해시로만 저장 · subscribers 자동 편입 0 · 측정 이벤트에 이메일 0
//  d) 같은 이메일: 확정된 신청은 "이미 신청하셨습니다"(행 1개 · 메일 추가 0) · 확인 전 신청은 확인 메일을 다시 보내고 이전 링크는 못 쓴다
//  e) 철회 링크: 열기만 하면 철회 안 됨 · 버튼으로 철회 · 다시 눌러도 성공 · 모르는 토큰 410 · 철회 뒤 같은 이메일로 다시 신청 가능
//  f) 보존 기한 배치(POST /api/jobs/privacy-retention, CRON_SECRET): 인증 없이 401 · 경계(하루 전·당일) —
//     미확인 가입 7일 · 미확인 사전 알림 7일 · 철회 동의 30일 · 문의 연락처 365일(완료만) · 문의 첨부 365일(저장소 파일까지) · 시도 기록 24시간 · 결과는 지운 수뿐
// 시험 자료(동의·문의·첨부 파일·계정·시도 기록·정책 게시본)는 끝나면 지운다 (staff.cleanup() 앞에서 지운다 — cleanup은 DB 연결을 닫는다).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { inboxFor, mailEnv, waitForMail } from "./lib/mail.mjs";
import { publishPolicies } from "./lib/policy-fixture.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const SITE = "https://e2e.example.test";
const SECRET = crypto.randomBytes(24).toString("hex");
const CRON = crypto.randomBytes(16).toString("hex");
const BUCKET = "inquiry-attachments";
const DAY = 86_400_000;

let sb, server, staff, db, base, removePolicies, runMark, idMark, run;
const createdUsers = [];
const storedPaths = [];
let ipSeq = 0;
const nextIp = () => `10.88.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;
const mailTo = (n) => `brief-e2e-${process.pid}-${n}@example.test`;
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

const fillToken = (ageMs = 10_000) => {
  const opened = Date.now() - ageMs;
  return `${opened}.${crypto.createHmac("sha256", SECRET).update(`signup_fill:${opened}`).digest("hex").slice(0, 32)}`;
};
async function apply(fields, { ip = nextIp(), fill = fillToken() } = {}) {
  const res = await fetch(`${base}/api/brief`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, "x-forwarded-for": ip },
    body: JSON.stringify({ fill, website: "", ...fields }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const post = async (path, token, { form = false } = {}) => {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": form ? "application/x-www-form-urlencoded" : "application/json", origin: base },
    body: form ? new URLSearchParams({ token }).toString() : JSON.stringify({ token }),
    redirect: "manual",
  });
  return { status: res.status, location: res.headers.get("location") ?? "" };
};
const setFlag = (patch) => db.query("update public.settings set value = value || $1::jsonb where key = 'feature_flags'", [JSON.stringify(patch)]);
const consentOf = async (email) => (await db.query("select * from public.consents where kind = 'brief_prereg' and email = $1 order by id", [email])).rows;
const tokensIn = (mail) => ({
  confirm: /\/brief\/confirm\?token=([A-Za-z0-9_-]+)/.exec(mail.Text)?.[1],
  revoke: /\/brief\/unsubscribe\?token=([A-Za-z0-9_-]+)/.exec(mail.Text)?.[1],
});
async function newSignedUp(email, n) {
  const r = await apply({ email, agree: "on" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const mails = await waitForMail(email, n);
  return tokensIn(mails[0]);
}
const runJob = async (secret = CRON) => {
  const res = await fetch(`${base}/api/jobs/privacy-retention`, { method: "POST", headers: secret ? { authorization: `Bearer ${secret}` } : {} });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const objectStatus = async (path) =>
  (await fetch(`${sb.url}/storage/v1/object/authenticated/${BUCKET}/${path}`, { headers: { authorization: `Bearer ${sb.serviceRoleKey}`, apikey: sb.serviceRoleKey } })).status;

before(async () => {
  sb = localSupabase();
  buildWeb();
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    GUARD_SECRET: SECRET,
    CRON_SECRET: CRON,
    NEXT_PUBLIC_SITE_URL: SITE,
    ...mailEnv(),
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  run = staff.run;
  await staff.snapshotOperations();
  runMark = Number((await db.query("select coalesce(max(id), 0) m from public.agent_runs")).rows[0].m);
  idMark = Number((await db.query("select coalesce(max(id), 0) m from public.inquiries")).rows[0].m);
  removePolicies = await publishPolicies(db, run, ["privacy"]);
  await setFlag({ brief: false });
  // 신청 횟수 제한이 이 시험의 연속 제출을 막지 않도록 넉넉히 둔다(제한 자체는 5단계 폼과 같은 함수 — 3단계 시험)
  await db.query("update public.settings set value = value || jsonb_build_object('brief_ip', jsonb_build_object('window', 3600, 'limit', 1000), 'brief_email', jsonb_build_object('window', 3600, 'limit', 1000)) where key = 'auth_limits'");
});

after(async () => {
  try {
    if (storedPaths.length) {
      await fetch(`${sb.url}/storage/v1/object/${BUCKET}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${sb.serviceRoleKey}`, apikey: sb.serviceRoleKey, "content-type": "application/json" },
        body: JSON.stringify({ prefixes: storedPaths }),
      }).catch(() => {});
    }
    await db.query("delete from public.consents where email like $1", [`brief-e2e-${process.pid}-%`]);
    await db.query("delete from public.request_throttles where key_hash like 'e2eb%'");
    await db.query("delete from public.agent_runs where id > $1 and job = 'privacy-retention'", [runMark]);
    await db.query("begin");
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.inquiries where id > $1", [idMark]);
    await db.query("commit");
    for (const id of createdUsers) {
      await fetch(`${sb.url}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${sb.serviceRoleKey}`, apikey: sb.serviceRoleKey } }).catch(() => {});
    }
    await removePolicies?.();
    await staff?.cleanup();
  } finally {
    server?.stop();
  }
});

test("a) brief 꺼짐이면 화면 3개와 API 3개가 404, 켜지면 폼이 열리고 홈에는 신청 폼이 없다", async () => {
  for (const p of ["/brief", "/brief/confirm?token=" + "a".repeat(43), "/brief/unsubscribe?token=" + "a".repeat(43)]) {
    assert.equal((await fetch(`${base}${p}`)).status, 404, p);
  }
  assert.equal((await apply({ email: mailTo("off"), agree: "on" })).status, 404);
  assert.equal((await post("/api/brief/confirm", "a".repeat(43))).status, 404);
  assert.equal((await post("/api/brief/unsubscribe", "a".repeat(43))).status, 404);
  assert.equal((await consentOf(mailTo("off"))).length, 0);

  await setFlag({ brief: true });
  const page = await fetch(`${base}/brief`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /action="\/api\/brief"/);
  // 동의 칸 — React가 속성 순서를 바꿔 그리므로(type·required·class·name) 순서와 상관없이 본다
  const agree = html.match(/<input[^>]*\bname="agree"[^>]*>/)?.[0] ?? "";
  assert.match(agree, /\btype="checkbox"/, "동의 칸은 체크박스");
  assert.match(agree, /\brequired\b/, "동의 칸은 필수 — 체크 없이 제출 불가");
  assert.match(html, /name="website"/);
  assert.match(html, /name="fill"/);
  const home = await (await fetch(`${base}/`)).text();
  assert.doesNotMatch(home, /api\/brief|name="agree"/, "홈에는 사전 알림 폼이 없다");
});

test("b) 동의 없음·형식 오류·숨은 칸은 422이고 행 0·메일 0", async () => {
  const email = mailTo("b");
  const noConsent = await apply({ email });
  assert.equal(noConsent.status, 422);
  assert.equal(noConsent.body.code, "consent");
  assert.equal((await apply({ email, agree: "" })).body.code, "consent");
  for (const bad of ["plain", "a@b", "a b@example.com", ""]) {
    const r = await apply({ email: bad, agree: "on" });
    assert.equal(r.status, 422, bad);
    assert.equal(r.body.code, "email", bad);
  }
  const bot = await apply({ email, agree: "on", website: "http://spam.example" });
  assert.equal(bot.status, 422);
  assert.equal(bot.body.code, "bot");
  assert.equal((await apply({ email, agree: "on" }, { fill: fillToken(500) })).body.code, "bot", "너무 빠른 제출");
  assert.equal((await apply({ email, agree: "on" }, { fill: "0.bad" })).body.code, "bot", "열림 토큰 없음");
  assert.equal((await consentOf(email)).length, 0);
  assert.equal((await inboxFor(email)).length, 0);
});

test("c) 신청 → 확인 메일 → 링크를 열기만 하면 미확정 → 버튼으로 확정, 토큰은 해시로만 저장, subscribers·이벤트에 이메일 0", async () => {
  const email = mailTo("c");
  const subscribersBefore = (await db.query("select to_regclass('public.subscribers') t")).rows[0].t
    ? Number((await db.query("select count(*) c from public.subscribers")).rows[0].c)
    : null;
  const r = await apply({ email: ` ${email.toUpperCase()} `, agree: "on" });
  assert.equal(r.status, 200);
  assert.equal(r.body.code, "sent");

  const [mail] = await waitForMail(email, 1);
  const { confirm, revoke } = tokensIn(mail);
  assert.ok(confirm && revoke, mail.Text);
  assert.notEqual(confirm, revoke);

  let rows = await consentOf(email);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].channel, "web_brief");
  assert.equal(rows[0].confirmed_at, null, "확인 전에는 미확정");
  assert.equal(rows[0].revoked_at, null);
  assert.equal(rows[0].confirm_token_hash, sha256(confirm));
  assert.equal(rows[0].revoke_token_hash, sha256(revoke));
  assert.ok(rows[0].version_ref.length >= 1, "동의한 처리방침 버전이 남는다");
  const rawDump = JSON.stringify(rows[0]);
  assert.ok(!rawDump.includes(confirm) && !rawDump.includes(revoke), "토큰 원문은 저장되지 않는다");

  // 링크를 열기만 하면(메일 보안 검사기) 확정되지 않는다
  const view = await fetch(`${base}/brief/confirm?token=${confirm}`);
  assert.equal(view.status, 200);
  assert.match(await view.text(), /신청 확정하기/);
  assert.equal((await consentOf(email))[0].confirmed_at, null);

  const ok = await post("/api/brief/confirm", confirm, { form: true });
  assert.equal(ok.status, 303);
  assert.equal(ok.location, "/brief/confirm?done=1");
  rows = await consentOf(email);
  assert.ok(rows[0].confirmed_at, "버튼을 누르면 확정");
  assert.match(await (await fetch(`${base}/brief/confirm?done=1`)).text(), /신청이 확정되었습니다/);
  assert.equal((await post("/api/brief/confirm", confirm)).status, 200, "같은 링크를 다시 눌러도 성공");

  if (subscribersBefore !== null) assert.equal(Number((await db.query("select count(*) c from public.subscribers")).rows[0].c), subscribersBefore, "구독자 표 자동 편입 0");
  const leaked = Number((await db.query("select count(*) c from public.analytics_events where to_jsonb(analytics_events)::text ilike $1", [`%${email.split("@")[0]}%`])).rows[0].c);
  assert.equal(leaked, 0, "측정 이벤트에 이메일 0");
});

test("d) 확정된 신청은 '이미 신청하셨습니다'(행·메일 그대로), 확인 전 재신청은 메일을 다시 보내고 이전 링크는 못 쓴다", async () => {
  const done = mailTo("d1");
  const t1 = await newSignedUp(done, 1);
  assert.equal((await post("/api/brief/confirm", t1.confirm)).status, 200);
  const again = await apply({ email: done, agree: "on" });
  assert.equal(again.status, 200);
  assert.equal(again.body.code, "already");
  assert.equal(again.body.message, "이미 신청하셨습니다");
  assert.equal((await consentOf(done)).length, 1);
  assert.equal((await inboxFor(done)).length, 1, "이미 신청한 이메일에는 메일을 더 보내지 않는다");
  const formRes = await fetch(`${base}/api/brief`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: base, "x-forwarded-for": nextIp() },
    body: new URLSearchParams({ email: done, agree: "on", website: "", fill: fillToken() }).toString(),
    redirect: "manual",
  });
  assert.equal(formRes.status, 303);
  assert.equal(formRes.headers.get("location"), "/brief?done=already");

  const pending = mailTo("d2");
  const first = await newSignedUp(pending, 1);
  const r2 = await apply({ email: pending, agree: "on" });
  assert.equal(r2.body.code, "sent");
  const mails = await waitForMail(pending, 2);
  assert.equal(mails.length, 2);
  assert.equal((await consentOf(pending)).length, 1, "행은 하나");
  assert.equal((await post("/api/brief/confirm", first.confirm)).status, 410, "이전 확인 링크는 못 쓴다");
  assert.equal((await consentOf(pending))[0].confirmed_at, null);
  const second = mails.map(tokensIn).find((t) => t.confirm !== first.confirm);
  assert.equal((await post("/api/brief/confirm", second.confirm)).status, 200);
  assert.ok((await consentOf(pending))[0].confirmed_at);
});

test("e) 철회: 열기만 하면 그대로, 버튼으로 철회, 다시 눌러도 성공, 모르는 토큰 410, 철회 뒤 다시 신청 가능", async () => {
  const email = mailTo("e");
  const t = await newSignedUp(email, 1);
  assert.equal((await post("/api/brief/confirm", t.confirm)).status, 200);

  assert.match(await (await fetch(`${base}/brief/unsubscribe?token=${t.revoke}`)).text(), /신청 철회하기/);
  assert.equal((await consentOf(email))[0].revoked_at, null, "링크를 열기만 하면 철회되지 않는다");

  const out = await post("/api/brief/unsubscribe", t.revoke, { form: true });
  assert.equal(out.status, 303);
  assert.equal(out.location, "/brief/unsubscribe?done=1");
  const revokedAt = (await consentOf(email))[0].revoked_at;
  assert.ok(revokedAt);
  assert.equal((await post("/api/brief/unsubscribe", t.revoke)).status, 200);
  assert.equal(String((await consentOf(email))[0].revoked_at), String(revokedAt), "다시 눌러도 철회 시각은 그대로");
  assert.equal((await post("/api/brief/unsubscribe", crypto.randomBytes(32).toString("base64url"))).status, 410);
  assert.equal((await post("/api/brief/unsubscribe", "short")).status, 410);

  const resub = await apply({ email, agree: "on" });
  assert.equal(resub.body.code, "sent");
  const rows = await consentOf(email);
  assert.equal(rows.length, 2, "철회된 행은 그대로 두고 새 신청 행이 생긴다");
  assert.ok(rows[0].revoked_at && rows[1].revoked_at === null && rows[1].confirmed_at === null);
});

test("f) privacy-retention: 인증 없이 401, 경계 하루 전은 남고 당일은 지운다 — 가입 7일·사전 알림 7일·철회 30일·연락처 365일·첨부 365일·시도 기록 24시간", async () => {
  assert.equal((await runJob("")).status, 401);
  assert.equal((await runJob("wrong")).status, 401);

  // 미확인 가입 7일 — created_at이 7일 전보다 1분 늦은 계정은 남고 1분 이른 계정은 지운다
  const mkUser = async (label, ageMs) => {
    const email = `brief-e2e-${process.pid}-user-${label}@example.test`;
    const res = await fetch(`${sb.url}/auth/v1/admin/users`, {
      method: "POST",
      headers: { authorization: `Bearer ${sb.serviceRoleKey}`, apikey: sb.serviceRoleKey, "content-type": "application/json" },
      body: JSON.stringify({ email, password: crypto.randomBytes(12).toString("hex") + "Aa1!", email_confirm: false }),
    });
    const user = await res.json();
    assert.ok(user.id, JSON.stringify(user));
    createdUsers.push(user.id);
    await db.query("update auth.users set created_at = $2 where id = $1", [user.id, ago(ageMs)]);
    return user.id;
  };
  const MIN = 60_000;
  const userKeep = await mkUser("keep", 7 * DAY - 5 * MIN);
  const userDrop = await mkUser("drop", 7 * DAY + 5 * MIN);

  // 사전 알림: 미확인 7일 · 철회 30일
  const seedConsent = async (label, { created = 0, revokedAgo = null, confirmed = false }) => {
    const email = mailTo(`ret-${label}`);
    await db.query(
      `insert into public.consents (email, kind, channel, created_at, confirmed_at, revoked_at) values ($1, 'brief_prereg', 'web_brief', $2, $3, $4)`,
      [email, ago(created), confirmed ? ago(created) : null, revokedAgo === null ? null : ago(revokedAgo)],
    );
    return email;
  };
  const preKeep = await seedConsent("pre-keep", { created: 7 * DAY - 5 * MIN });
  const preDrop = await seedConsent("pre-drop", { created: 7 * DAY + 5 * MIN });
  const preOldConfirmed = await seedConsent("pre-confirmed", { created: 40 * DAY, confirmed: true });
  const revKeep = await seedConsent("rev-keep", { created: 90 * DAY, confirmed: true, revokedAgo: 30 * DAY - 5 * MIN });
  const revDrop = await seedConsent("rev-drop", { created: 90 * DAY, confirmed: true, revokedAgo: 30 * DAY + 5 * MIN });

  // 문의: 완료 365일 — 연락처·첨부
  const privacyId = Number((await db.query("select id from public.policy_versions where doc_key = 'privacy' and status = 'published' order by id desc limit 1")).rows[0].id);
  const upload = async (name) => {
    const path = `brief-e2e/${run}-${name}.pdf`;
    const res = await fetch(`${sb.url}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${sb.serviceRoleKey}`, apikey: sb.serviceRoleKey, "content-type": "application/pdf" },
      body: Buffer.from("%PDF-1.4\n보존 기한 시험 파일"),
    });
    assert.equal(res.status, 200, await res.text());
    storedPaths.push(path);
    return path;
  };
  const seedInquiry = async (label, { status = "done", doneAgo = null, withFile = false }) => {
    const path = withFile ? await upload(label) : null;
    const r = await db.query(
      `insert into public.inquiries (kind, body, status, done_at, contact_name, organization, contact_email, privacy_version_id, attachments)
       values ('tip', $1, $2, $3, '시험 담당', '시험 회사', $4, $5, $6::jsonb) returning id`,
      [`보존 기한 시험 ${label}`, status, doneAgo === null ? null : ago(doneAgo), `brief-e2e-${process.pid}-inq-${label}@example.test`, privacyId, JSON.stringify(path ? [{ path, name: "t.pdf" }] : [])],
    );
    return { id: Number(r.rows[0].id), path };
  };
  const inqKeep = await seedInquiry("keep", { doneAgo: 365 * DAY - 5 * MIN, withFile: true });
  const inqDrop = await seedInquiry("drop", { doneAgo: 365 * DAY + 5 * MIN, withFile: true });
  const inqOpen = await seedInquiry("open", { status: "received", withFile: true });
  const inquiryRow = async (id) => (await db.query("select * from public.inquiries where id = $1", [id])).rows[0];
  assert.equal((await inquiryRow(inqOpen.id)).done_at, null, "완료가 아니면 done_at이 비어 있다");

  // 시도 기록 24시간
  const keepHash = "e2eb" + crypto.randomBytes(14).toString("hex");
  const dropHash = "e2eb" + crypto.randomBytes(14).toString("hex");
  await db.query("insert into public.request_throttles (scope, key_hash, window_start, count) values ('form_ip', $1, $2, 1), ('form_ip', $3, $4, 1)", [keepHash, ago(24 * 3600_000 - 5 * MIN), dropHash, ago(24 * 3600_000 + 5 * MIN)]);

  const result = await runJob();
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.status, "succeeded");

  const userExists = async (id) => (await fetch(`${sb.url}/auth/v1/admin/users/${id}`, { headers: { authorization: `Bearer ${sb.serviceRoleKey}`, apikey: sb.serviceRoleKey } })).status === 200;
  assert.equal(await userExists(userKeep), true, "미확인 가입 7일 하루 전: 남음");
  assert.equal(await userExists(userDrop), false, "미확인 가입 7일 당일: 지움");

  assert.equal((await consentOf(preKeep)).length, 1, "미확인 사전 알림 기한 전: 남음");
  assert.equal((await consentOf(preDrop)).length, 0, "미확인 사전 알림 7일: 지움");
  assert.equal((await consentOf(preOldConfirmed)).length, 1, "확정된 신청은 오래돼도 남음");
  assert.equal((await consentOf(revKeep)).length, 1, "철회 30일 하루 전: 남음");
  assert.equal((await consentOf(revDrop)).length, 0, "철회 30일 당일: 지움");

  const keep = await inquiryRow(inqKeep.id);
  assert.equal(keep.contact_email, `brief-e2e-${process.pid}-inq-keep@example.test`);
  assert.equal(keep.contact_cleared_at, null);
  assert.equal(keep.attachments.length, 1);
  assert.equal(await objectStatus(inqKeep.path), 200, "첨부 365일 하루 전: 파일 남음");
  const drop = await inquiryRow(inqDrop.id);
  assert.deepEqual([drop.contact_name, drop.organization, drop.contact_email], [null, null, null]);
  assert.ok(drop.contact_cleared_at);
  assert.equal(drop.body, "보존 기한 시험 drop", "본문은 남긴다");
  assert.deepEqual(drop.attachments, []);
  assert.ok(drop.attachments_cleared_at);
  assert.notEqual(await objectStatus(inqDrop.path), 200, "첨부 365일 당일: 저장소 파일까지 지움");
  const open = await inquiryRow(inqOpen.id);
  assert.equal(open.contact_name, "시험 담당", "완료가 아닌 문의는 오래돼도 그대로");
  assert.equal(await objectStatus(inqOpen.path), 200);

  const throttleLeft = (await db.query("select key_hash from public.request_throttles where key_hash = any($1)", [[keepHash, dropHash]])).rows.map((r) => r.key_hash);
  assert.deepEqual(throttleLeft, [keepHash], "시도 기록 24시간: 하루 전 남음 · 당일 지움");

  // 실행 기록 — 지운 수만 있고 개인정보는 없다
  const record = (await db.query("select status, detail from public.agent_runs where id = $1", [result.body.runId])).rows[0];
  assert.equal(record.status, "succeeded");
  for (const key of ["unconfirmedSignups", "unconfirmedPrereg", "revokedConsents", "contactsCleared", "attachmentInquiries", "attachmentFiles", "attachmentFailed", "throttleRows"]) {
    assert.equal(typeof record.detail[key], "number", key);
  }
  assert.ok(record.detail.unconfirmedSignups >= 1 && record.detail.unconfirmedPrereg >= 1 && record.detail.revokedConsents >= 1);
  assert.ok(record.detail.contactsCleared >= 1 && record.detail.attachmentFiles >= 1 && record.detail.throttleRows >= 1);
  assert.equal(record.detail.attachmentFailed, 0);
  assert.doesNotMatch(JSON.stringify(record.detail), /@|brief-e2e/, "실행 기록에 이메일·경로 0");

  // 두 번째 실행은 이미 지운 것을 다시 세지 않는다
  const second = await runJob();
  assert.equal(second.status, 200);
  const record2 = (await db.query("select detail from public.agent_runs where id = $1", [second.body.runId])).rows[0].detail;
  assert.equal(record2.attachmentFiles, 0, "비운 첨부는 다시 지우지 않는다");
  assert.equal((await inquiryRow(inqKeep.id)).contact_email !== null, true);
});
