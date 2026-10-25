// W10-i 수용 E2E (docs/dev/W10-i_설계.md - HOME-12·13·14 · PR-15 · GROW-03·04·05)
// standalone 빌드를 로컬 Supabase에 붙인다. 기능 키는 시험 안에서 켜고 끝나면 운영 설정 스냅샷으로 되돌린다.
// 캠페인 문구·검토 기록은 전부 시험용 가짜다. 브라우저가 필요한 항목(클릭 측정 전송·GPC 전송 0·360px 배치·계산 결과 -> 상담 요청 흐름)은 이 파일 밖 체크리스트(DEPLOY)로 둔다.
//  a) 헤더·홈 - 키 shortcuts 꺼짐: 바로가기 줄·홈 카드 0 / 켜짐: 줄과 카드, 'AI 계산기' 글자 0, 바로가기 주소에 쿼리·해시 0
//  b) 재테크 포인트 - 키 꺼짐·공개 호 0 -> 404, 기자 호 만들기 200·발행 403, 편집 책임자 3건 미만 발행 422
//  c) 캠페인 작성·승인 - 금지 표현·보조 링크 2개 422 / 광고 담당 작성·제출 200, 승인 403+감사 / 관리자 승인: 검토 기록 없음 409 -> 검토 후 200, 작성자 본인 승인 거부
//  d) 랜딩 화면 - 키 꺼짐 404 / 켜짐 200 + noindex 메타·X-Robots-Tag·입력 칸 0·주 버튼 1 / 초안·철회 404 / 승인 뒤 제목 수정 -> 404 / 기간 끝 307 / 임의 태그 문자열 화면에 0
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w10i-acceptance-e2e@example.test";
const SITE = "https://e2e-w10i.example.test";

let sb, server, staff, db, base, run;
const u = {};
const created = { landings: [], issues: [] };

async function api(path, user, body) {
  const res = await fetch(`${base}/api/admin${path}`, { method: "POST", headers: { authorization: `Bearer ${user.token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const camp = (user, body) => api("/campaigns", user, body);
const weekly = (user, body) => api("/realestate-weekly", user, body);
const setFlags = (flags) => db.query("update public.settings set value = value || $1::jsonb where key = 'feature_flags'", [JSON.stringify(flags)]);
const page = async (path, init = {}) => {
  const res = await fetch(`${base}${path}`, { redirect: "manual", ...init });
  return { status: res.status, headers: res.headers, text: await res.text() };
};
const input = (key, extra = {}) => ({
  op: "create",
  campaignKey: key,
  title: "시험용 취득세 안내",
  body: "시험용 문구입니다. 부동산 세금 계산기로 확인해 보세요.",
  primaryTarget: "calc",
  primaryTool: "acquisition",
  secondaryTarget: "",
  channel: "search",
  startsAt: "2020-01-01T00:00:00+09:00",
  endsAt: "2099-01-01T00:00:00+09:00",
  ...extra,
});
async function purge() {
  // 추가만 되는 표 - 트리거를 끈 세션으로 이 시험이 만든 행만 지운다 (로컬 DB)
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.campaign_audit where landing_id in (select id from public.campaign_landings where campaign_key like $1)", [`e2e-w10i-${run}-%`]);
    await db.query("delete from public.campaign_ad_reviews where landing_id in (select id from public.campaign_landings where campaign_key like $1)", [`e2e-w10i-${run}-%`]);
    await db.query("delete from public.campaign_landings where campaign_key like $1", [`e2e-w10i-${run}-%`]);
    await db.query("delete from public.realestate_weekly_audit where issue_id = any($1::bigint[])", [created.issues]);
    await db.query("delete from public.realestate_weekly_items where issue_id = any($1::bigint[])", [created.issues]);
    await db.query("delete from public.realestate_weekly_issues where id = any($1::bigint[])", [created.issues]);
    await db.query("delete from public.audit_log where action like 'campaign.%' and at >= $1", [staff.startedAt.toISOString()]).catch(() => {});
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}
const statusOf = async (id) => (await db.query("select status from public.campaign_landings where id = $1", [id])).rows[0]?.status;

before(async () => {
  sb = localSupabase();
  buildWeb();
  server = await startServer({ NEXT_PUBLIC_SUPABASE_URL: sb.url, NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey, SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey, ADMIN_EMAILS: ADMIN_EMAIL, NEXT_PUBLIC_SITE_URL: SITE });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  run = staff.run.toLowerCase().replace(/[^a-z0-9]/g, "");
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  u.admin = await staff.createUser({ label: "w10i-admin", email: ADMIN_EMAIL });
  u.reporter = await staff.createUser({ label: "w10i-reporter", roles: ["reporter"], person: { name: "시험용 기자", roles: ["reporter"] } });
  u.editor = await staff.createUser({ label: "w10i-editor", roles: ["editor"], person: { name: "시험용 편집 책임자", roles: ["editor"] } });
  u.adOps = await staff.createUser({ label: "w10i-adops", roles: ["ad_ops"] });
});

after(async () => {
  try {
    await purge();
  } finally {
    await staff?.cleanup();
    await server?.stop?.();
  }
});

test("a) 헤더·홈 - 키 shortcuts 꺼짐이면 바로가기 줄·카드 0, 켜짐이면 나오고 AI 계산기 글자·쿼리 주소 0", async () => {
  await setFlags({ shortcuts: false, calc: true });
  const off = await page("/");
  assert.equal(off.status, 200);
  assert.ok(!off.text.includes('aria-label="바로가기"'), "꺼짐: 바로가기 줄 0");
  assert.ok(!off.text.includes('data-part="shortcut-cards"'), "꺼짐: 홈 카드 0");

  await setFlags({ shortcuts: true, calc: true });
  const on = await page("/");
  assert.ok(on.text.includes('aria-label="바로가기"'), "켜짐: 바로가기 줄");
  assert.ok(on.text.includes('data-part="shortcut-cards"'), "켜짐: 홈 카드");
  assert.ok(on.text.includes("부동산 세금 계산기"));
  assert.ok(!/AI\s*(세금\s*)?계산/.test(on.text.replace(/AI 도우미|AI 세금 도우미/g, "")), "AI 계산기 글자 0");
  const nav = on.text.split('aria-label="바로가기"')[1].split("</nav>")[0];
  for (const m of nav.matchAll(/href="([^"]+)"/g)) assert.ok(!/[?#]/.test(m[1]), `바로가기 주소에 쿼리·해시 0: ${m[1]}`);
  const heroAt = on.text.indexOf('data-part="shortcut-cards"');
  assert.ok(heroAt > 0, "카드는 본문 안");
});

test("b) 재테크 포인트 - 키 꺼짐·공개 호 0이면 404, 기자 호 만들기 200·발행 403, 편집 책임자는 3건 미만 발행 422", async () => {
  await setFlags({ realestate_weekly: false });
  assert.equal((await page("/realestate/weekly")).status, 404, "키 꺼짐");
  await setFlags({ realestate_weekly: true });
  assert.equal((await page("/realestate/weekly")).status, 404, "공개 호 0");
  assert.equal((await page("/realestate/weekly/2026-43")).status, 404, "호별도 404");
  assert.equal((await page("/realestate/weekly/abc")).status, 404, "주 모양이 틀리면 404");

  const week = `9${String(Date.now()).slice(-3)}-${String(1 + (Date.now() % 52)).padStart(2, "0")}`;
  const made = await weekly(u.reporter, { op: "create_issue", week });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const issueId = Number(made.body.id);
  created.issues.push(issueId);
  assert.equal((await weekly(u.reporter, { op: "publish", issueId })).status, 403, "기자는 발행 못 함");
  const few = await weekly(u.editor, { op: "publish", issueId });
  assert.equal(few.status, 422, JSON.stringify(few.body));
  assert.ok(JSON.stringify(few.body).includes("3건 이상"));
  assert.equal((await weekly(u.editor, { op: "set_items", issueId, items: Array.from({ length: 8 }, (_, i) => ({ articleId: i + 1, taxItems: ["취득세"], point: "시험용 한 줄" })) })).status, 422, "8건 거부");
  const bad = await weekly(u.reporter, { op: "set_items", issueId, items: [{ articleId: 1, taxItems: ["취득세"], point: "투자 유망한 단지입니다" }] });
  assert.equal(bad.status, 422, "투자 권유 표현 거부");
  assert.equal((await db.query("select status from public.realestate_weekly_issues where id = $1", [issueId])).rows[0].status, "draft");
  await setFlags({ realestate_weekly: false });
});

test("c) 캠페인 작성·승인 - 문구·보조 링크 검사 422, 광고 담당 승인 403+감사, 검토 기록 없으면 409, 검토 뒤 승인 200", async () => {
  const key = `e2e-w10i-${run}-a`;
  const forbidden = await camp(u.adOps, input(`${key}x`, { title: "무조건 줄어드는 취득세" }));
  assert.equal(forbidden.status, 422, "금지 표현");
  assert.equal((await camp(u.adOps, input(`${key}y`, { secondaryTarget: ["expert_request", "brief_weekly"] }))).status, 422, "보조 링크 2개");
  assert.equal((await camp(u.reporter, input(`${key}z`))).status, 403, "기자는 작성 못 함");

  const made = await camp(u.adOps, input(key, { secondaryTarget: "expert_request" }));
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const id = Number(made.body.id);
  created.landings.push(id);
  const row = (await db.query("select content_hash, copy_check_hash, status from public.campaign_landings where id = $1", [id])).rows[0];
  assert.equal(row.status, "draft");
  assert.equal(row.copy_check_hash, row.content_hash, "문구 검사 통과 해시");

  assert.equal((await camp(u.adOps, { op: "approve", id })).status, 403, "광고 담당 승인 403");
  const denied = await db.query("select count(*)::int n from public.audit_log where action = 'campaign.approve.denied' and at >= $1", [staff.startedAt.toISOString()]);
  assert.ok(denied.rows[0].n >= 1, "거부 감사");
  const early = await camp(u.admin, { op: "approve", id });
  assert.equal(early.status, 409, "제출 전 승인");
  assert.equal(early.body.code, "not_submitted");

  assert.equal((await camp(u.adOps, { op: "submit", id })).status, 200);
  const noReview = await camp(u.admin, { op: "approve", id });
  assert.equal(noReview.body.code, "review_missing", "검토 기록 없음");
  assert.equal((await camp(u.adOps, { op: "review", id, reviewer: "x", basisRef: "x", scope: ["표시광고법"], result: "approved" })).status, 403, "검토 기록은 관리자만");
  const reviewed = await camp(u.admin, { op: "review", id, reviewer: "시험용 검토자", basisRef: "시험용 검토 문서", scope: ["표시광고법", "세무사 광고 기준", "자본시장법"], result: "approved" });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
  const ok = await camp(u.admin, { op: "approve", id });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(await statusOf(id), "approved");
  assert.equal(Number((await db.query("select count(*)::int n from public.campaign_audit where landing_id = $1", [id])).rows[0].n), 6, "시도마다 감사 1행: 거부 2 + 제출 1 + 검토 1 + 승인 거부 1 + 승인 1");
});

test("d) 랜딩 화면 - 키 꺼짐 404, 켜짐 200(noindex·입력 칸 0·주 버튼 1), 초안·철회 404, 승인 뒤 수정 404, 기간 끝 307, 임의 태그 글자 0", async () => {
  const key = `e2e-w10i-${run}-a`;
  await setFlags({ campaign_landings: false });
  assert.equal((await page(`/go/${key}`)).status, 404, "키 꺼짐");
  await setFlags({ campaign_landings: true, calc: true, calc_acquisition: true });
  const live = await page(`/go/${key}?utm_source=evil-tag-value&utm_campaign=evil-campaign&gclid=evil-click-id`);
  assert.equal(live.status, 200);
  assert.match(live.headers.get("x-robots-tag") ?? "", /noindex/);
  assert.match(live.text, /<meta name="robots" content="[^"]*noindex/);
  assert.ok(live.text.includes("시험용 취득세 안내"));
  assert.ok(!/<input|<textarea|<select/.test(live.text), "입력 칸 0");
  assert.ok(!/evil-(tag-value|campaign|click-id)/.test(live.text), "임의 태그 글자 0");
  assert.equal((live.text.match(/data-testid="campaign-landing"/g) ?? []).length, 1);
  assert.equal((await page("/go/no-such-campaign")).status, 404, "없는 키");
  assert.equal((await page("/robots.txt")).text.includes("/go"), false, "robots.txt Disallow에 넣지 않음");

  // 승인 뒤 제목 수정 -> 초안으로 되돌아가 공개 렌더 0
  const id = created.landings[0];
  const edit = await camp(u.adOps, { ...input(key, { secondaryTarget: "expert_request" }), op: "update", id, title: "시험용 바뀐 제목" });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal(await statusOf(id), "draft");
  assert.equal((await page(`/go/${key}`)).status, 404, "승인 뒤 수정 -> 404");

  // 기간이 끝난 승인 캠페인 - 도착 화면으로 307
  const endedKey = `e2e-w10i-${run}-b`;
  const made = await camp(u.adOps, input(endedKey, { startsAt: "2020-01-01T00:00:00+09:00", endsAt: "2020-02-01T00:00:00+09:00" }));
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const eid = Number(made.body.id);
  created.landings.push(eid);
  await camp(u.adOps, { op: "submit", id: eid });
  await camp(u.admin, { op: "review", id: eid, reviewer: "시험용 검토자", basisRef: "시험용 검토 문서", scope: ["표시광고법"], result: "approved" });
  assert.equal((await camp(u.admin, { op: "approve", id: eid })).status, 200);
  const ended = await page(`/go/${endedKey}`);
  assert.equal(ended.status, 307, "기간 끝 307");
  assert.ok(!(ended.headers.get("location") ?? "").includes("utm_"), "도착 주소에 태그 0");
  await camp(u.admin, { op: "withdraw", id: eid });
  assert.equal((await page(`/go/${endedKey}`)).status, 404, "철회 404");
  await setFlags({ campaign_landings: false, shortcuts: false });
});
