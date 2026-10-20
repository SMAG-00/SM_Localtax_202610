// 고객센터·문의함·감사 기록 403 E2E (W2-e 5단계 — docs/dev/W2-e_설계.md 1장 5단계 · 2.8 · 7장 · 10장)
//  a) 기능 키: page_help 꺼짐이면 /help/* 와 제출 API가 404, 켜지면 폼 4종 화면(숨은 칸·열림 토큰)
//  b) 폼 5종 제출 → 문의함 종류(tip·subscription·advertising·reader_submission·correction) · 접수 번호 · 접수 확인 메일(본문·연락처 되풀이 0)
//  c) 본문 가림: 이메일·전화번호·긴 숫자는 가려져 저장 · 연락 이메일은 연락처 칸에만
//  d) 입력 검사 거부(필수 칸·글자 수·구분)
//  e) 첨부: .exe · 이름만 바꾼 실행 파일 · 개수 · 합계 상한 거부, 정상 파일은 비공개 저장소 + 직원 서명 주소로 내려받기
//  f) 봇 차단: 숨은 칸 · 열림 토큰 없음/너무 빠름/만료 · IP 빈도(n번째 허용·n+1번째 429), 거부된 제출은 행 0
//  g) 정정·반론 완료는 처리 결과·사유 없이 422, 변경은 감사 로그 inquiry.update(본문·연락처 0)
//  h) [연락처 보기]는 누를 때마다 감사 로그 1건(연락처 값 0)
//  i) 종류별 열람 역할: 역할 밖은 403(+거부 감사 로그), 담당자는 그 종류를 다룰 역할이 있어야 한다
//  j) ADM-04: PO 아닌 관리자(·편집국)의 감사 기록 수정·삭제는 403 + 감사 로그 audit.amend.denied 정확히 1건, 기록은 그대로, PO는 성공(변경 기록 남음)
// 정책 게시본·문의·감사 행은 시험 자료이고 끝나면 지운다 (staff.cleanup() 앞에서 지운다 — cleanup은 DB 연결을 닫는다).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { mailEnv, waitForMail } from "./lib/mail.mjs";
import { publishSignupPolicies } from "./lib/policy-fixture.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const SITE = "https://e2e.example.test";
const SECRET = crypto.randomBytes(24).toString("hex");
const ADMIN_EMAIL = "help-e2e-admin@example.test";
const PO_EMAIL = "help-e2e-po@example.test";
const BODY = "기사 본문에 오류가 있어 알려 드립니다. 확인 부탁드립니다.";

let sb, server, staff, db, base, removePolicies, idMark, auditMark, run;
const u = {};
const storedPaths = [];
const seededAuditIds = [];
let ipSeq = 0;
const nextIp = () => `10.77.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;
const mailTo = (n) => `help-e2e-${process.pid}-${n}@example.test`;

const fillToken = (ageMs) => {
  const opened = Date.now() - ageMs;
  return `${opened}.${crypto.createHmac("sha256", SECRET).update(`help_fill:${opened}`).digest("hex").slice(0, 32)}`;
};
/** JSON 제출 */
async function submit(slug, fields, { ip = nextIp(), fill = fillToken(10_000), website = "" } = {}) {
  const res = await fetch(`${base}/api/help/${slug}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, "x-forwarded-for": ip },
    body: JSON.stringify({ fill, website, agreePrivacy: "on", ...fields }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
/** 폼(multipart) 제출 — 303의 location을 돌려준다 */
async function submitForm(slug, fields, files, { ip = nextIp() } = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries({ fill: fillToken(10_000), website: "", agreePrivacy: "on", ...fields })) form.append(k, v);
  for (const f of files) form.append("files", new Blob([f.data]), f.name);
  const res = await fetch(`${base}/api/help/${slug}`, { method: "POST", headers: { origin: base, "x-forwarded-for": ip }, body: form, redirect: "manual" });
  return { status: res.status, location: res.headers.get("location") ?? "" };
}
const admin = async (method, path, user, body) => {
  const res = await fetch(`${base}/api/admin${path}`, {
    method,
    headers: { ...(user ? { authorization: `Bearer ${user.token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  return { status: res.status, body: await res.json().catch(() => ({})), location: res.headers.get("location") ?? "" };
};
const rowOf = async (ref) => (await db.query("select * from public.inquiries where ref_code = $1", [ref])).rows[0];
const inquiryCount = async () => Number((await db.query("select count(*) c from public.inquiries where id > $1", [idMark])).rows[0].c);
const auditCount = async () => Number((await db.query("select count(*) c from public.audit_logs where id > $1", [auditMark])).rows[0].c);
const auditRows = async (action) => (await db.query("select * from public.audit_logs where id > $1 and action = $2 order by id", [auditMark, action])).rows;
const setFlag = (patch) => db.query("update public.settings set value = value || $1::jsonb where key = 'feature_flags'", [JSON.stringify(patch)]);
const setFormIp = (limit) => db.query("update public.settings set value = jsonb_set(value, '{form_ip}', $1::jsonb) where key = 'auth_limits'", [JSON.stringify({ window: 3600, limit })]);
const pdf = (size) => Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(Math.max(0, size - 9), 0x20)]);
async function create(slug, fields, n) {
  const r = await submit(slug, { contactEmail: mailTo(n), ...fields });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { ref: r.body.ref, row: await rowOf(r.body.ref) };
}

before(async () => {
  sb = localSupabase();
  buildWeb();
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    ADMIN_EMAILS: `${ADMIN_EMAIL},${PO_EMAIL}`,
    AUDIT_ADMIN_EMAILS: PO_EMAIL,
    GUARD_SECRET: SECRET,
    NEXT_PUBLIC_SITE_URL: SITE,
    ...mailEnv(),
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  run = staff.run;
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.removeLeftover(PO_EMAIL);
  await staff.snapshotOperations();
  idMark = Number((await db.query("select coalesce(max(id), 0) m from public.inquiries")).rows[0].m);
  auditMark = Number((await db.query("select coalesce(max(id), 0) m from public.audit_logs")).rows[0].m);
  removePolicies = await publishSignupPolicies(db, run);
  u.admin = await staff.createUser({ label: "help-admin", email: ADMIN_EMAIL });
  u.po = await staff.createUser({ label: "help-po", email: PO_EMAIL });
  u.reporter = await staff.createUser({ label: "help-reporter", roles: ["reporter"], person: { name: "문의시험 기자", roles: ["reporter"] } });
  u.editor = await staff.createUser({ label: "help-editor", roles: ["editor"], person: { name: "문의시험 편집자", roles: ["editor"] } });
  u.adOps = await staff.createUser({ label: "help-adops", roles: ["ad_ops"] });
  u.storeOps = await staff.createUser({ label: "help-storeops", roles: ["store_ops"] });
  await setFlag({ page_help: false });
  await setFormIp(1000);
});

after(async () => {
  try {
    // 첨부 파일은 저장소 API로 지운다
    if (storedPaths.length) {
      await fetch(`${sb.url}/storage/v1/object/inquiry-attachments`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${sb.serviceRoleKey}`, apikey: sb.serviceRoleKey, "content-type": "application/json" },
        body: JSON.stringify({ prefixes: storedPaths }),
      }).catch(() => {});
    }
    await db.query("begin");
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.inquiries where id > $1", [idMark]);
    await db.query("delete from public.audit_log_changes where log_id = any($1::bigint[]) or actor = $2", [seededAuditIds, `admin:${PO_EMAIL}`]);
    await db.query("delete from public.audit_logs where id > $1 and (actor like 'e2e-help-%' or action like 'inquiry.%' or action like 'audit.amend%')", [auditMark]);
    await db.query("commit");
    await removePolicies?.();
    await staff?.cleanup();
  } finally {
    server?.stop();
  }
});

test("a) page_help 꺼짐이면 /help/* 와 제출 API가 404, 켜지면 폼 4종 화면이 열린다(숨은 칸·열림 토큰 포함)", async () => {
  for (const slug of ["report", "subscribe", "ad", "contribute"]) assert.equal((await fetch(`${base}/help/${slug}`)).status, 404, slug);
  assert.equal((await submit("report", { body: BODY })).status, 404);
  // 운영 설정 API로 켠다 — 공개 데이터 캐시가 바로 갱신되고, 처리방침 게시본이 없으면 켜기가 거부되는 의존 규칙도 지난다
  const flags = (await db.query("select value from public.settings where key = $1", ["feature_flags"])).rows[0].value;
  const on = await admin("PATCH", "/settings/feature_flags", u.admin, { value: { ...flags, page_help: true } });
  assert.equal(on.status, 200, JSON.stringify(on.body));
  for (const slug of ["report", "subscribe", "ad", "contribute"]) {
    const res = await fetch(`${base}/help/${slug}`);
    assert.equal(res.status, 200, slug);
    const html = await res.text();
    assert.match(html, /name="website"/, `${slug} 숨은 칸`);
    assert.match(html, /name="fill" value="\d+\.[0-9a-f]{32}"/, `${slug} 열림 토큰`);
    assert.match(html, /name="body"/);
  }
  assert.equal((await fetch(`${base}/help/faq`)).status, 404);
  assert.equal((await fetch(`${base}/help/corrections`)).status, 404);
});

test("b) 폼 5종 제출 → 문의함에 종류별로 쌓이고 접수 확인 메일에는 접수 번호만 있다", async () => {
  const cases = [
    ["report", "tip", { body: BODY, relatedArticleUrl: undefined }],
    ["subscribe", "subscription", { body: BODY, contactName: "홍길동" }],
    ["ad", "advertising", { body: BODY, organization: "시험회사", contactName: "담당자" }],
    ["contribute", "reader_submission", { body: BODY, title: "투고 제목", contactName: "필명" }],
    ["corrections", "correction", { body: BODY, requestType: "rebuttal", articleUrl: "/news/e2e-no-such-slug" }],
  ];
  let n = 0;
  for (const [slug, kind, fields] of cases) {
    n++;
    const { ref, row } = await create(slug, fields, `b${n}`);
    assert.match(ref, /^[A-HJ-NP-Z2-9]{8}$/);
    assert.equal(row.kind, kind, slug);
    assert.equal(row.contact_email, mailTo(`b${n}`));
    assert.equal(row.status, "received");
    assert.notEqual(row.privacy_version_id, null);
    assert.equal(row.mail_status, "sent", `${slug} 메일 상태`);
    const [mail] = await waitForMail(mailTo(`b${n}`), 1);
    const text = JSON.stringify(mail);
    assert.ok(text.includes(ref), "메일에 접수 번호");
    assert.ok(!text.includes("확인 부탁드립니다"), "메일에 문의 본문 되풀이 0");
  }
  const cor = await db.query("select request_type, body, related_article_id from public.inquiries where kind = 'correction' and id > $1", [idMark]);
  assert.equal(cor.rows[0].request_type, "rebuttal");
  assert.equal(cor.rows[0].related_article_id, null);
  assert.match(cor.rows[0].body, /관련 기사 주소: \/news\/e2e-no-such-slug/);
  const kinds = (await db.query("select distinct kind from public.inquiries where id > $1", [idMark])).rows.map((r) => r.kind).sort();
  assert.ok(!kinds.some((k) => /expert/.test(k)), "전문가 연락 요청 0");
});

test("c) 본문의 이메일·전화번호·긴 숫자는 가려져 저장되고 날짜·법 조문은 그대로다, 기사 제보는 익명도 된다", async () => {
  const r = await submit("report", { body: "답장은 hong@example.com 으로 주세요. 제 번호는 010-1234-5678 입니다. 계좌 110-123-456789 입니다. 날짜는 2026-10-19 기사 오류, 지방세법 제111조." });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const row = await rowOf(r.body.ref);
  assert.equal(row.body, "답장은 [이메일] 으로 주세요. 제 번호는 [전화번호] 입니다. 계좌 [번호] 입니다. 날짜는 2026-10-19 기사 오류, 지방세법 제111조.");
  assert.equal(row.contact_email, null);
  assert.equal(row.mail_status, "none");
  assert.equal(row.privacy_version_id, null);
});

test("d) 입력 검사 — 필수 칸·글자 수 경계·구분 값 거부 (행 0)", async () => {
  const before = await inquiryCount();
  const email = mailTo("d");
  const cases = [
    ["subscribe", { body: BODY }, "email"],
    ["subscribe", { body: BODY, contactEmail: "x@y" }, "email"],
    ["subscribe", { body: BODY, contactEmail: email, agreePrivacy: "" }, "privacy"],
    ["report", { body: BODY, contactEmail: email, agreePrivacy: "" }, "privacy"],
    ["subscribe", { body: "가나다라마바사아자", contactEmail: email }, "body"],
    ["subscribe", { body: "가".repeat(5001), contactEmail: email }, "body"],
    ["contribute", { body: BODY, contactEmail: email }, "title"],
    ["corrections", { body: BODY, contactEmail: email, articleUrl: "/news/x" }, "request_type"],
    ["corrections", { body: BODY, contactEmail: email, requestType: "rebuttal" }, "article_url"],
  ];
  for (const [slug, fields, code] of cases) {
    const r = await submit(slug, fields);
    assert.equal(r.status, 422, `${slug} ${code}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.code, code, `${slug}`);
  }
  assert.equal(await inquiryCount(), before);
  const edge = await submit("subscribe", { body: "가나다라마바사아자차", contactEmail: email });
  assert.equal(edge.status, 201, "10글자는 통과");
  const edgeMax = await submit("subscribe", { body: "가".repeat(5000), contactEmail: email });
  assert.equal(edgeMax.status, 201, "5000글자는 통과");
});

test("e) 첨부 — .exe·이름만 바꾼 실행 파일·개수·합계 상한은 거부하고 정상 파일은 비공개 저장소에 두어 직원만 서명 주소로 내려받는다", async () => {
  const before = await inquiryCount();
  const exe = Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0]);
  const fields = { body: BODY };
  const bad = [
    [[{ name: "setup.exe", data: exe }], "attachment_type"],
    [[{ name: "report.pdf", data: exe }], "attachment_type"],
    [[{ name: "a.pdf", data: pdf(100) }, { name: "b.pdf", data: pdf(100) }, { name: "c.pdf", data: pdf(100) }, { name: "d.pdf", data: pdf(100) }], "attachment_count"],
    [[{ name: "big.pdf", data: pdf(4_000_001) }], "attachment_size"],
  ];
  for (const [files, code] of bad) {
    const r = await submitForm("report", fields, files);
    assert.equal(r.status, 303);
    assert.match(r.location, new RegExp(`\\?e=${code}$`), JSON.stringify(files.map((f) => f.name)));
  }
  assert.equal(await inquiryCount(), before, "거부된 제출은 행 0");
  const exact = await submitForm("report", fields, [{ name: "limit.pdf", data: pdf(4_000_000) }]);
  assert.match(exact.location, /\?sent=[A-HJ-NP-Z2-9]{8}$/, "합계 4,000,000바이트는 통과");

  const ok = await submitForm("report", fields, [{ name: "../../증거 자료.PDF", data: pdf(2048) }]);
  const ref = /sent=([A-Z0-9]{8})$/.exec(ok.location)?.[1];
  assert.ok(ref, ok.location);
  const row = await rowOf(ref);
  assert.equal(row.attachments.length, 1);
  assert.match(row.attachments[0].path, new RegExp(`^${row.id}/[0-9a-f-]{36}\\.pdf$`));
  assert.equal(row.attachments[0].name, "증거 자료.PDF");
  for (const a of (await db.query("select attachments from public.inquiries where id > $1", [idMark])).rows.flatMap((r) => r.attachments)) storedPaths.push(a.path);

  const publicUrl = await fetch(`${sb.url}/storage/v1/object/public/inquiry-attachments/${row.attachments[0].path}`);
  assert.notEqual(publicUrl.status, 200, "공개 주소 0");
  assert.equal((await admin("GET", `/inquiries/${row.id}/attachments/0`, null)).status, 401);
  assert.equal((await admin("GET", `/inquiries/${row.id}/attachments/0`, u.adOps)).status, 403, "광고 담당은 기사 제보 첨부 못 본다");
  const signed = await admin("GET", `/inquiries/${row.id}/attachments/0`, u.reporter);
  assert.equal(signed.status, 302);
  assert.match(signed.location, /\/object\/sign\/inquiry-attachments\//);
  assert.match(signed.location, /download=/, "내려받기 형태");
  const file = await fetch(signed.location);
  assert.equal(file.status, 200);
  assert.equal((await file.text()).slice(0, 5), "%PDF-");
  assert.equal((await admin("GET", `/inquiries/${row.id}/attachments/5`, u.reporter)).status, 404);
});

test("f) 봇 차단 — 숨은 칸·열림 토큰 없음/너무 빠름/만료는 한 문장으로 거부(행 0), IP 빈도는 n번째 허용·n+1번째 429", async () => {
  const before = await inquiryCount();
  const email = mailTo("f");
  const cases = [
    ["숨은 칸", { website: "http://spam.example" }, {}],
    ["토큰 없음", {}, { fill: "" }],
    ["너무 빠름", {}, { fill: fillToken(1_000) }],
    ["만료", {}, { fill: fillToken(3 * 3600 * 1000) }],
    ["위조", {}, { fill: `${Date.now() - 10_000}.${"0".repeat(32)}` }],
  ];
  const messages = new Set();
  for (const [name, extra, opts] of cases) {
    const r = await submit("subscribe", { body: BODY, contactEmail: email }, { ...opts, ...(extra.website ? { website: extra.website } : {}) });
    assert.equal(r.status, 422, name);
    assert.equal(r.body.code, "bot", name);
    messages.add(r.body.error ?? r.body.message);
  }
  assert.equal(messages.size, 1, "거부 문장은 하나");
  assert.equal(await inquiryCount(), before);

  await setFormIp(2);
  try {
    const ip = "10.99.1.1";
    assert.equal((await submit("subscribe", { body: BODY, contactEmail: email }, { ip })).status, 201);
    assert.equal((await submit("subscribe", { body: BODY, contactEmail: email }, { ip })).status, 201);
    const third = await submit("subscribe", { body: BODY, contactEmail: email }, { ip });
    assert.equal(third.status, 429);
    assert.equal(third.body.code, "too_many");
    assert.equal((await submit("subscribe", { body: BODY, contactEmail: email }, { ip: "10.99.1.2" })).status, 201, "다른 IP는 영향 없음");
  } finally {
    await setFormIp(1000);
  }
});

test("g) 정정·반론은 처리 결과·사유 없이 완료 불가(422·행 그대로), 둘 다 있으면 완료되고 감사 로그에는 본문·연락처가 없다", async () => {
  const { row } = await create("corrections", { body: BODY, requestType: "correction", articleUrl: "/news/e2e-x" }, "g");
  const url = `/inquiries/${row.id}`;
  assert.equal((await admin("PATCH", url, u.reporter, { status: "done" })).status, 403, "기자는 정정·반론 못 다룬다");
  assert.equal((await admin("PATCH", url, u.editor, { status: "done" })).status, 422);
  assert.equal((await admin("PATCH", url, u.editor, { status: "done", resolution: "dismissed", resolutionReason: "   " })).status, 422);
  assert.equal((await admin("PATCH", url, u.editor, { status: "done", resolution: "bogus", resolutionReason: "x" })).status, 400);
  assert.equal((await rowOf(row.ref_code)).status, "received");
  const before = (await auditRows("inquiry.update")).length;
  const ok = await admin("PATCH", url, u.editor, { status: "done", resolution: "correction_published", resolutionReason: "기사 정정 게재", memo: "처리 메모" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const after = await rowOf(row.ref_code);
  assert.deepEqual([after.status, after.resolution, after.memo], ["done", "correction_published", "처리 메모"]);
  const logs = await auditRows("inquiry.update");
  assert.equal(logs.length, before + 1);
  const last = logs.at(-1);
  assert.equal(last.target, `inquiries:${row.id}`);
  assert.equal(last.before.status, "received");
  assert.equal(last.after.status, "done");
  const text = JSON.stringify(last);
  assert.ok(!text.includes(mailTo("g")) && !text.includes("처리 메모") && !text.includes("확인 부탁드립니다"), "감사 로그에 연락처·메모·본문 0");
  assert.equal(last.after.memoLength, 5);
});

test("h) [연락처 보기]는 누를 때마다 감사 로그 1건이 생기고 연락처 값은 로그에 없다, 역할 밖은 403 + 거부 로그", async () => {
  const { row } = await create("report", { body: BODY }, "h");
  const url = `/inquiries/${row.id}/contact`;
  assert.equal((await admin("POST", url, null)).status, 401);
  const n0 = (await auditRows("inquiry.contact_view")).length;
  for (let i = 1; i <= 2; i++) {
    const r = await admin("POST", url, u.reporter);
    assert.equal(r.status, 200);
    assert.equal(r.body.contact.email, mailTo("h"));
    assert.equal((await auditRows("inquiry.contact_view")).length, n0 + i);
  }
  const last = (await auditRows("inquiry.contact_view")).at(-1);
  assert.equal(last.target, `inquiries:${row.id}`);
  assert.ok(!JSON.stringify(last).includes(mailTo("h")));
  const d0 = (await auditRows("inquiry.contact_view.denied")).length;
  assert.equal((await admin("POST", url, u.adOps)).status, 403);
  assert.equal((await auditRows("inquiry.contact_view.denied")).length, d0 + 1);
  assert.equal((await auditRows("inquiry.contact_view")).length, n0 + 2, "거부는 열람 로그를 만들지 않는다");
});

test("i) 종류별 열람 역할 — 역할 밖은 403 + inquiry.update.denied, 관리자는 전 종류, 담당자는 그 종류를 다룰 역할만", async () => {
  const ad = (await create("ad", { body: BODY }, "i1")).row;
  const sub = (await create("subscribe", { body: BODY }, "i2")).row;
  const tip = (await create("report", { body: BODY }, "i3")).row;
  const matrix = [
    [u.reporter, ad, 403], [u.reporter, sub, 403], [u.reporter, tip, 200],
    [u.adOps, ad, 200], [u.adOps, sub, 403], [u.adOps, tip, 403],
    [u.storeOps, sub, 200], [u.storeOps, ad, 403],
    [u.editor, tip, 200], [u.editor, ad, 403],
    [u.admin, ad, 200], [u.admin, sub, 200], [u.admin, tip, 200],
  ];
  for (const [user, r, expected] of matrix) {
    const d0 = (await auditRows("inquiry.update.denied")).length;
    const res = await admin("PATCH", `/inquiries/${r.id}`, user, { status: "in_progress" });
    assert.equal(res.status, expected, `${user.email} → ${r.kind}`);
    assert.equal((await auditRows("inquiry.update.denied")).length, d0 + (expected === 403 ? 1 : 0));
  }
  assert.equal((await admin("PATCH", `/inquiries/${ad.id}`, null, { status: "done" })).status, 401);
  assert.equal((await admin("PATCH", `/inquiries/${ad.id}`, u.admin, { assignee: u.adOps.id })).status, 200);
  assert.equal((await rowOf(ad.ref_code)).assignee, u.adOps.id);
  assert.equal((await admin("PATCH", `/inquiries/${ad.id}`, u.admin, { assignee: u.reporter.id })).status, 422, "광고 문의 담당자로 기자는 안 된다");
  assert.equal((await rowOf(ad.ref_code)).assignee, u.adOps.id);
  assert.equal((await admin("PATCH", `/inquiries/${ad.id}`, u.admin, { status: "닫힘" })).status, 400);
  assert.equal((await admin("PATCH", `/inquiries/${ad.id}`, u.admin, {})).status, 400);
  assert.equal((await admin("PATCH", `/inquiries/99999999`, u.admin, { status: "done" })).status, 404);
});

test("j) ADM-04 — PO 아닌 관리자·편집국의 감사 기록 수정·삭제는 403 + 감사 로그 audit.amend.denied 정확히 1건(기록 그대로), PO는 성공하고 변경 기록이 남는다", async () => {
  const seed = async (label) => {
    const r = await db.query("insert into public.audit_logs (actor, action, target, reason) values ($1, 'e2e.help.seed', $2, '시험 원본') returning id", [`e2e-help-${run}`, `e2e-help:${label}`]);
    seededAuditIds.push(Number(r.rows[0].id));
    return Number(r.rows[0].id);
  };
  const id = await seed("a");
  const changeBody = { changes: { reason: "수정된 이유" }, reason: "오타 정정" };

  for (const [name, user] of [["관리자(PO 아님)", u.admin], ["편집 책임자", u.editor]]) {
    for (const [method, body] of [["PATCH", changeBody], ["DELETE", { reason: "삭제 시도" }]]) {
      const before = await auditCount();
      const res = await admin(method, `/audit/${id}`, user, body);
      assert.equal(res.status, 403, `${name} ${method}`);
      assert.equal((await auditCount()) - before, 1, `${name} ${method}: 새 감사 로그 정확히 1건`);
      const denied = (await auditRows("audit.amend.denied")).at(-1);
      assert.equal(denied.actor, `user:${user.id}`);
      assert.equal(denied.target, `audit_logs:${id}`);
    }
  }
  const untouched = (await db.query("select reason from public.audit_logs where id = $1", [id])).rows;
  assert.deepEqual(untouched.map((r) => r.reason), ["시험 원본"], "기록 그대로");
  const unauth = await auditCount();
  assert.equal((await admin("PATCH", `/audit/${id}`, null, changeBody)).status, 401);
  assert.equal(await auditCount(), unauth, "로그인 안 한 요청은 로그 0");

  // PO — 이유 필수, 성공하면 변경 기록(audit_log_changes)이 남는다
  assert.equal((await admin("PATCH", `/audit/${id}`, u.po, { changes: { reason: "x" } })).status, 400);
  assert.equal((await admin("PATCH", `/audit/${id}`, u.po, { changes: {}, reason: "빈 변경" })).status, 400);
  const patch = await admin("PATCH", `/audit/${id}`, u.po, changeBody);
  assert.equal(patch.status, 200, JSON.stringify(patch.body));
  assert.equal((await db.query("select reason from public.audit_logs where id = $1", [id])).rows[0].reason, "수정된 이유");
  const ch1 = (await db.query("select op, actor, reason, old_row->>'reason' as old_reason, new_row->>'reason' as new_reason from public.audit_log_changes where log_id = $1", [id])).rows;
  assert.deepEqual(ch1, [{ op: "update", actor: `admin:${PO_EMAIL}`, reason: "오타 정정", old_reason: "시험 원본", new_reason: "수정된 이유" }]);

  assert.equal((await admin("DELETE", `/audit/${id}`, u.po, {})).status, 400, "삭제도 이유 필수");
  const del = await admin("DELETE", `/audit/${id}`, u.po, { reason: "시험 삭제" });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal((await db.query("select 1 from public.audit_logs where id = $1", [id])).rowCount, 0);
  const ch2 = (await db.query("select op, reason from public.audit_log_changes where log_id = $1 order by id", [id])).rows;
  assert.deepEqual(ch2.map((r) => r.op), ["update", "delete"]);
  assert.equal((await admin("DELETE", `/audit/${id}`, u.po, { reason: "없는 기록" })).status >= 400, true, "이미 지운 기록은 실패");
});
