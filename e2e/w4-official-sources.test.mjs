// 공식 자료 규칙 E2E (W4 5단계 — docs/dev/W4_설계.md 1장 5단계 증거 · 2.1 · 2.2 · 12장 #13·#22, PRD-01B REG1-07 · REG1-09 · REG1-13 · PR-07)
// standalone 빌드를 띄우고 로컬 Supabase에 붙인다. 발표기관·주소·숫자는 모두 시험용 가짜다(시험용 가상구·*.example — 설계 8장).
//  a) 발행 판정 — 공식 자료의 기준일·지역 단위가 비면 발행 422(빈 칸 이름 · reg1_09.official-fields만) · 분석 문단을 고쳐도 원자료 행 그대로 ·
//     원자료 고치기 = 새 버전 + 사유(빈 사유 422 · 옛 판·스냅샷 해시 그대로 · 감사 official_source.edit 1건 · 대체된 판 다시 고치기 409) ·
//     제2유형 대표 사진은 발행 422(pr07.photo-license) → 자체 촬영 사진으로 바꾸면 발행 200
//  b) 공개 화면 — 공식 자료 원문 카드(자료 종류·발표기관·기준일·확인일 고정폭·공공누리 유형 글자·원문 새 창)는 본문 블록(기자의 해석)과 다른 구역 ·
//     대체된 옛 판 0 · 보도자료 줄에 유형 글자 · 원본 스냅샷 글자 0 · 자르기 불가 대표 사진 = 원본 비율(±1%)
//  c) 자료 종류 — 차단 4종(교통·관광·음식점·생활 안내)은 출처 422(칸 이름)·설정 422·DB 거부, 허용 목록 밖 422 · 공공누리 유형 없는 보도자료 422 ·
//     제4유형·미표시는 이용 범위 설정에도 못 넣음(422)
//  d) 사진 — 제2·3유형은 권고 기본값에서 공개 렌더 0(화면·anon 읽기), 이용 범위 설정을 열면 다음 요청부터 보이고 되돌리면 다시 0
//  e) 고시 자료를 쓴 해설 — 세무 감수 없이 발행 422(대상 이유 'REG1-07'), DB도 거부 · 감수 승인 뒤 발행 200
//  f) 편집 화면 — 공식 자료 칸(공공누리 유형·발표일·기준일·지역 단위·수집일) 칸 오류 · 자료 종류 고르기 목록 = 허용 목록(차단 4종 0) ·
//     원자료 고치기 폼 사유 칸 오류 → 사유를 적으면 새 버전
// 만든 계정·기사·출처·이미지는 끝나면 지우고, 운영 설정은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import pg from "pg";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w4-official-sources-e2e@example.test";
const SITE = "https://e2e.example.test";
const KOGL_SEED = { photoTypes: ["kogl_1", "not_applicable"], fullTextTypes: [] };
const TYPES_SEED = ["ordinance", "notice", "budget_settlement", "local_tax_revenue", "realestate_transaction", "redevelopment"];
const BLOCKED = ["transport", "tourism", "restaurant", "living_guide"];
const SNAPSHOT_TEXT = "시험용 가상구 2026년 상반기 지방세 세수 결산 원문입니다. 이 글자는 공개 화면에 나오지 않아야 합니다.";

let sb, server, staff, db, browser, base;
const u = {};
const fx = {};
const counts0 = {};
/** 그림 주소(경로) → 원본 크기 — 브라우저 가로채기가 이 크기의 PNG를 돌려준다 */
const IMAGES = new Map();

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const slugOf = (label) => `e2e-w4os-${label}-${staff.run}`;

async function api(method, p, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const show = (r) => JSON.stringify(r.body).slice(0, 1500);

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}
function png(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.alloc(1 + width * 3, 0xdd);
  row[0] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
}

/** 이미지 기록 (DB에 직접 — 이미지 등록 API는 아직 없다). 권리 확인 + 공공누리 유형 */
async function insertMedia(label, { licenseType, cropAllowed = true, width = 1200, height = 800 }) {
  const path = `e2e/${staff.run}/${label}.png`;
  const row = await one(
    `insert into public.media (path, alt, kind, rights_status, credit, photographer, license, checked_at, width, height, license_type, crop_allowed)
     values ($1, $2, 'photo', 'confirmed', '시험용 가상구청', '시험 촬영자', '시험용 이용 조건', now(), $3, $4, $5, $6) returning id, license_cleared`,
    [path, `${label} 시험 사진`, width, height, licenseType, cropAllowed],
  );
  staff.trackRow("media", row.id);
  IMAGES.set(`/${path}`, { width, height });
  return { id: Number(row.id), mediaId: String(row.id), path, width, height, cleared: row.license_cleared };
}

async function pageWithImages(p, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.route(`${SITE}/**`, async (route) => {
    const size = IMAGES.get(new URL(route.request().url()).pathname);
    if (!size) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, contentType: "image/png", body: png(size.width, size.height) });
  });
  const page = await ctx.newPage();
  const res = await page.goto(`${base}${p}`, { waitUntil: "networkidle" });
  return { page, ctx, status: res.status() };
}

// ── 발행 판정을 지나는 세법 해설 (site-media와 같은 틀 — 출처 · 핵심 요약 · 문단 · 표 · 문서 인용 · 상자 · FAQ · 핵심 주장) ──
const LAW = {
  kind: "official_doc",
  title: "시험용 법령 조문(신고 및 납부)",
  url: "https://law.example/gasang/20",
  sourceName: "시험용 법령 정보 창구",
  lastVerifiedAt: "2026-10-10T09:00:00+09:00",
  licenseStatus: "출처표시",
  licenseType: "kogl_1",
  publishedOn: "2026-10-01",
  referenceDate: "2026-10-01",
  regionUnit: "전국",
  collectedAt: "2026-10-10T09:00:00+09:00",
};
/** 시험용 가상구 세수 결산 — 기준일·지역 단위가 빈 공식 자료 (발행 거부 대상) */
const DATASET = {
  kind: "dataset",
  title: "시험용 가상구 지방세 세수 결산(2026년 상반기)",
  url: "https://gasang.example/open-data/tax-revenue-2026h1",
  sourceName: "시험용 가상구청 세무과",
  lastVerifiedAt: "2026-10-20T10:00:00+09:00",
  licenseStatus: "출처표시",
  licenseType: "kogl_1",
  sourceType: "local_tax_revenue",
  publishedOn: "2026-07-15",
  collectedAt: "2026-10-19T09:00:00+09:00",
  snapshot: { text: SNAPSHOT_TEXT },
};
const PRESS = { kind: "press_release", title: "시험용 가상구, 상반기 세수 결산 발표", url: "https://gasang.example/press/2026-07-15", sourceName: "시험용 가상구청 대변인실", licenseType: "kogl_2" };
const ANALYSIS = "편집국이 결산 자료를 읽어 보니 세목별 증감은 거래량 변화와 함께 움직였다.";

const baseBlocks = (srcRef) => [
  { type: "key_summary", lines: ["주택을 사면 취득일부터 60일 안에 신고합니다.", "취득일은 잔금일과 등기일 중 빠른 날입니다.", "신고와 납부는 함께 합니다."] },
  { type: "paragraph", text: "취득일은 잔금을 치른 날과 등기를 마친 날 중 빠른 날이다. 자세한 흐름은 [지방세 허브](/tax)에서 볼 수 있다." },
  { type: "table", caption: "취득일 정하는 법", rows: [["경우", "취득일"], ["잔금이 먼저", "잔금일"], ["등기가 먼저", "등기일"]], chart: { axis: "경우", unit: "날짜", source: "시험용 법령 조문" } },
  { type: "quote", text: "취득세는 취득일부터 60일 이내에 신고하고 납부하여야 한다.", speaker: "시험용 법령 조문", origin: "document", refId: srcRef },
  { type: "callout", kind: "tip", title: "절세 체크포인트", text: "생애 첫 주택이면 감면 요건을 먼저 확인하세요." },
  { type: "callout", kind: "mistake", title: "자주 틀리는 점", text: "계약일이 아니라 잔금일이나 등기일이 취득일입니다." },
  { type: "faq", items: [{ question: "취득세는 어디에 신고하나요?", answer: "주택이 있는 시·군·구청이나 위택스에 신고합니다." }, { question: "신고와 납부를 따로 하나요?", answer: "신고하면서 함께 냅니다." }] },
];
const claims = (srcRef) => [{ id: "claim-1", text: "취득일부터 60일 안에 신고하고 납부해야 한다.", kind: "legal", evidenceIds: [srcRef], blockIndex: 1 }];

async function draftExplainer(label, title) {
  const created = await api("POST", "/articles", u.reporter, { slug: slugOf(label), title: `${title} ${staff.run}`, summary: "시험용 가상구 자료로 취득세 신고 순서를 정리했습니다.", section: "tax", categoryId: fx.interpretations, contentType: "explainer", legalBasisDate: "2026-10-01" });
  assert.equal(created.status, 201, show(created));
  const id = created.body.article.id;
  staff.trackArticle(id);
  const law = await api("POST", `/articles/${id}/sources`, u.reporter, LAW);
  assert.equal(law.status, 201, show(law));
  fx[label] = { id, slug: slugOf(label), href: `/news/${slugOf(label)}`, srcRef: law.body.source.ref, lawId: Number(law.body.source.id) };
  return fx[label];
}
const writeBody = (a, extra = [], user = u.reporter) => api("PATCH", `/articles/${a.id}`, user, { body: { blocks: [...baseBlocks(a.srcRef), ...extra], claims: claims(a.srcRef) } });
async function approve(a, { tax = true } = {}) {
  const desk = await api("POST", `/articles/${a.id}/reviews`, u.editor, { kind: "desk_edit", decision: "approve" });
  assert.equal(desk.status, 201, show(desk));
  if (tax) {
    const t = await api("POST", `/articles/${a.id}/reviews`, u.reviewer, { kind: "tax_review", decision: "approve" });
    assert.equal(t.status, 201, show(t));
  }
}
const publish = (a) => api("POST", `/articles/${a.id}/publish`, u.editor);
const sourceRows = (articleId) => db.query("select * from public.article_sources where article_id = $1 order by id", [articleId]).then((r) => r.rows);
const auditCount = (action, target) => one("select count(*)::int n from public.audit_logs where action = $1 and target = $2 and at >= $3", [action, target, staff.startedAt]).then((r) => r.n);

before(async () => {
  sb = localSupabase();
  buildWeb();
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    ADMIN_EMAILS: ADMIN_EMAIL,
    NEXT_PUBLIC_SITE_URL: SITE,
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  for (const t of ["article_sources", "media", "raw_snapshots"]) counts0[t] = (await one(`select count(*)::int n from public.${t}`)).n;
  assert.deepEqual((await one("select value from public.settings where key = 'kogl_usage'")).value, KOGL_SEED, "시험 전 공공누리 이용 범위 = 씨앗(12장 #13 권고 기본값)");
  assert.deepEqual((await one("select value from public.settings where key = 'official_source_types'")).value, TYPES_SEED, "시험 전 자료 종류 허용 목록 = 씨앗");

  u.admin = await staff.createUser({ label: "w4os-admin", email: ADMIN_EMAIL });
  u.reporter = await staff.createUser({ label: "w4os-reporter", roles: ["reporter"], person: { name: "시험용 공식 자료 기자", roles: ["reporter"] } });
  u.editor = await staff.createUser({ label: "w4os-editor", roles: ["editor"], person: { name: "시험용 공식 자료 편집자", roles: ["editor"] } });
  u.reviewer = await staff.createUser({ label: "w4os-reviewer", roles: ["reviewer"], person: { name: "시험용 공식 자료 감수위원", roles: ["reviewer"] } });
  fx.interpretations = Number((await one("select id from public.categories where section = 'tax' and slug = 'interpretations'")).id);

  // 이미지 — 자체 촬영(자르기 불가, 가로 3:2) · 제2유형 · 제3유형
  fx.own = await insertMedia("own-no-crop", { licenseType: "not_applicable", cropAllowed: false, width: 1500, height: 1000 });
  fx.kogl2 = await insertMedia("kogl2", { licenseType: "kogl_2", width: 1200, height: 900 });
  fx.kogl3 = await insertMedia("kogl3", { licenseType: "kogl_3", width: 900, height: 1200 });
  assert.deepEqual([fx.own.cleared, fx.kogl2.cleared, fx.kogl3.cleared], [true, false, false], "공개 렌더 가능 계산 = 권고 기본값");

  // 사진 공개 렌더 시험 기사 — DB에 직접 (공개 기사, 대표 = 제2유형, 본문 = 제3유형·자체 촬영)
  const photoBody = {
    blocks: [
      { type: "paragraph", text: "시험용 사진 공개 렌더 기사 본문입니다." },
      { type: "image", mediaId: fx.kogl3.mediaId, alt: "제3유형 시험 사진", caption: "제3유형" },
      { type: "image", mediaId: fx.own.mediaId, alt: "자체 촬영 시험 사진", caption: "자체 촬영" },
    ],
    claims: [],
  };
  const photo = await one(
    `insert into public.articles (slug, title, summary, section, content_type, status, author_id, lead_media_id, body, first_published_at)
     values ($1, $2, '사진 공개 렌더 시험', 'tax', 'explainer', 'published', $3, $4, $5, now() - interval '1 hour') returning id, slug`,
    [slugOf("photos"), `시험용 사진 공개 렌더 ${staff.run}`, u.reporter.personId, fx.kogl2.id, JSON.stringify(photoBody)],
  );
  staff.trackArticle(Number(photo.id));
  fx.photos = { id: Number(photo.id), href: `/news/${photo.slug}` };

  browser = await chromium.launch();
});

after(async () => {
  try {
    // 이용 범위를 API로 되돌린다 — 이미지 계산 칸도 같이 다시 계산된다 (정리는 트리거를 끈 세션이라)
    if (u.admin) await api("PATCH", "/settings/kogl_usage", u.admin, { value: KOGL_SEED });
    await browser?.close();
    await staff?.cleanup();
  } finally {
    server?.stop();
    if (sb && Object.keys(counts0).length) {
      const c = new pg.Client({ connectionString: sb.dbUrl });
      await c.connect();
      try {
        for (const t of Object.keys(counts0)) assert.equal((await c.query(`select count(*)::int n from public.${t}`)).rows[0].n, counts0[t], `정리 뒤 ${t} 행 수 = 시험 전`);
        assert.deepEqual((await c.query("select value from public.settings where key = 'kogl_usage'")).rows[0].value, KOGL_SEED, "이용 범위 되돌림");
        assert.deepEqual((await c.query("select value from public.settings where key = 'official_source_types'")).rows[0].value, TYPES_SEED, "허용 목록 그대로");
      } finally {
        await c.end();
      }
    }
  }
});

test("a) 공식 자료 칸이 빈 기사 발행 422(빈 칸 이름) · 분석 문단을 고쳐도 원자료 그대로 · 원자료 고치기 = 새 버전 + 사유 · 제2유형 사진 422 → 발행 200", async () => {
  const a = await draftExplainer("main", "시험용 가상구 세수 결산으로 보는 취득세 신고");
  const ds = await api("POST", `/articles/${a.id}/sources`, u.reporter, DATASET);
  assert.equal(ds.status, 201, show(ds));
  a.dsId = Number(ds.body.source.id);
  const press = await api("POST", `/articles/${a.id}/sources`, u.reporter, PRESS);
  assert.equal(press.status, 201, show(press));
  a.pressId = Number(press.body.source.id);

  // 1) 기준일·지역 단위가 빈 공식 자료 → 발행 422, 그 규칙 하나만 · 칸마다 항목 · 위치에 API 칸 이름 · 문장에 화면 칸 이름
  let saved = await writeBody(a, [{ type: "paragraph", text: ANALYSIS }]);
  assert.equal(saved.status, 200, show(saved));
  await approve(a);
  let r = await publish(a);
  assert.equal(r.status, 422, show(r));
  assert.deepEqual(r.body.failed, ["reg1_09.official-fields"], show(r));
  const fields = r.body.findings.filter((f) => f.id === "reg1_09.official-fields");
  assert.deepEqual(fields.map((f) => f.location.field), ["sources.referenceDate", "sources.regionUnit"]);
  assert.match(fields[0].message, /기준일\(referenceDate\)/);
  assert.match(fields[1].message, /지역 단위\(regionUnit\)/);
  assert.ok(!["published", "scheduled"].includes((await one("select status from public.articles where id = $1", [a.id])).status), "발행 0");

  // 2) 분석 문단(기자의 해석)을 고쳐도 원자료 행은 그대로 (REG1-09)
  const rowsBefore = await sourceRows(a.id);
  saved = await writeBody(a, [{ type: "paragraph", text: `${ANALYSIS} 다만 감면 확대 영향은 따로 보지 않았다.` }]);
  assert.equal(saved.status, 200, show(saved));
  assert.deepEqual(await sourceRows(a.id), rowsBefore, "분석 문단 수정 뒤 출처 행 불변");

  // 3) 원자료 고치기 — 사유가 비면 422(칸 이름), 행 0
  const noReason = await api("PATCH", `/articles/${a.id}/sources/${a.dsId}`, u.reporter, { referenceDate: "2026-06-30", regionUnit: "시·군·구" });
  assert.equal(noReason.status, 422, show(noReason));
  assert.deepEqual(noReason.body.errors.map((e) => e.split(":")[0]), ["source.revisionReason"]);
  const blankReason = await api("PATCH", `/articles/${a.id}/sources/${a.dsId}`, u.reporter, { revisionReason: "   ", referenceDate: "2026-06-30" });
  assert.equal(blankReason.status, 422, show(blankReason));
  assert.equal((await sourceRows(a.id)).length, 3, "새 행 0");
  // 차단 종류로 고치기도 422
  const blocked = await api("PATCH", `/articles/${a.id}/sources/${a.dsId}`, u.reporter, { revisionReason: "종류 변경", sourceType: "tourism" });
  assert.equal(blocked.status, 422, show(blocked));
  assert.deepEqual(blocked.body.errors.map((e) => e.split(":")[0]), ["source.sourceType"]);

  // 4) 사유 + 기준일·지역 단위 → 새 버전 행(201). 옛 판·스냅샷 그대로, 감사 1건
  const oldRow = (await sourceRows(a.id)).find((s) => Number(s.id) === a.dsId);
  const snapHash = (await one("select content_hash from public.raw_snapshots where id = $1", [oldRow.snapshot_id])).content_hash;
  const rev = await api("PATCH", `/articles/${a.id}/sources/${a.dsId}`, u.reporter, { revisionReason: "발표기관 결산 공고의 기준일·지역 단위를 확인해 채움", referenceDate: "2026-06-30", regionUnit: "시·군·구" });
  assert.equal(rev.status, 201, show(rev));
  assert.equal(rev.body.source.supersedesRef, `src:${a.dsId}`);
  a.dsV2 = Number(rev.body.source.id);
  const rows = await sourceRows(a.id);
  const v2 = rows.find((s) => Number(s.id) === a.dsV2);
  assert.equal(Number(v2.supersedes_id), a.dsId);
  assert.equal(v2.revision_reason, "발표기관 결산 공고의 기준일·지역 단위를 확인해 채움");
  assert.equal((await one("select reference_date::text d from public.article_sources where id = $1", [a.dsV2])).d, "2026-06-30");
  assert.equal(v2.region_unit, "시·군·구");
  assert.equal(Number(v2.snapshot_id), Number(oldRow.snapshot_id), "원본 스냅샷을 잇는다");
  assert.equal((await one("select content_hash from public.raw_snapshots where id = $1", [v2.snapshot_id])).content_hash, snapHash, "스냅샷 해시 그대로");
  assert.deepEqual(rows.find((s) => Number(s.id) === a.dsId), oldRow, "옛 판 행은 그대로 (덮어쓰기 0)");
  assert.equal(await auditCount("official_source.edit", `articles:${a.id}`), 1, "감사 official_source.edit 1건");
  // 대체된 판을 또 고치면 409, 원자료 칸을 DB에서 직접 덮어써도 거부 (REG1-09)
  const again = await api("PATCH", `/articles/${a.id}/sources/${a.dsId}`, u.reporter, { revisionReason: "다시", title: "두 번째 고침" });
  assert.equal(again.status, 409, show(again));
  await assert.rejects(db.query("update public.article_sources set title = '덮어쓴 제목' where id = $1", [a.dsV2]), /새 버전 행/);

  // 5) 제2유형 대표 사진 → 발행 422(pr07.photo-license 하나) — 법률 검토 전 기본값
  let lead = await api("PATCH", `/articles/${a.id}`, u.reporter, { leadMediaId: fx.kogl2.id });
  assert.equal(lead.status, 200, show(lead));
  saved = await writeBody(a, [{ type: "paragraph", text: ANALYSIS }]);
  assert.equal(saved.status, 200, show(saved));
  await approve(a);
  r = await publish(a);
  assert.equal(r.status, 422, show(r));
  assert.deepEqual(r.body.failed, ["pr07.photo-license"], show(r));
  assert.match(r.body.findings.find((f) => f.id === "pr07.photo-license").message, /법률 검토 전/);

  // 6) 자체 촬영(자르기 불가) 사진으로 바꾸면 발행 200
  lead = await api("PATCH", `/articles/${a.id}`, u.reporter, { leadMediaId: fx.own.id });
  assert.equal(lead.status, 200, show(lead));
  saved = await writeBody(a, [{ type: "paragraph", text: ANALYSIS }]);
  assert.equal(saved.status, 200, show(saved));
  await approve(a);
  r = await publish(a);
  assert.equal(r.status, 200, show(r));
  assert.equal((await one("select status from public.articles where id = $1", [a.id])).status, "published");
  // 발행된 기사에 칸이 빈 공식 자료를 더하면 DB가 거부 → 409/422 (한쪽만 우회한 삽입도 실패 — REG1-13)
  const late = await api("POST", `/articles/${a.id}/sources`, u.editor, { ...DATASET, title: "발행 뒤 칸 빈 자료", snapshot: undefined });
  assert.ok([409, 422].includes(late.status), show(late));
  assert.equal((await sourceRows(a.id)).length, 4, "발행 뒤 칸 빈 출처 0");
});

test("b) 공개 화면 — 공식 자료 원문 카드(유형 글자·날짜·원문 새 창)는 본문 블록과 다른 구역 · 옛 판 0 · 보도자료 유형 글자 · 스냅샷 글자 0 · 자르기 불가 사진 원본 비율", async () => {
  const a = fx.main;
  assert.ok(a?.dsV2, "a) 먼저");
  const { page, ctx, status } = await pageWithImages(a.href);
  try {
    assert.equal(status, 200);
    const html = await page.content();
    assert.equal(html.includes(SNAPSHOT_TEXT.slice(0, 20)), false, "원본 스냅샷 글자 0 (링크만)");

    // 공식 자료 카드 = 법령(완전) + 새 판(완전). 대체된 옛 판(src:dsId) 0
    const cards = await page.$$eval('[data-part="official-source-card"]', (els) =>
      els.map((el) => ({
        id: Number(el.getAttribute("data-source-id")),
        type: el.querySelector('[data-part="official-source-type"]')?.textContent,
        license: el.querySelector('[data-part="license-badge"]')?.textContent,
        dates: el.querySelector('[data-part="official-source-dates"]')?.textContent,
        link: { href: el.querySelector("a")?.getAttribute("href"), target: el.querySelector("a")?.getAttribute("target"), rel: el.querySelector("a")?.getAttribute("rel") },
        text: el.textContent,
        inBlocks: Boolean(el.closest('[data-part="blocks"]')),
      })),
    );
    assert.deepEqual(cards.map((c) => c.id), [a.lawId, a.dsV2], "카드 = 대체되지 않은 완전한 공식 자료");
    assert.equal(await page.locator(`[data-source-id="${a.dsId}"]`).count(), 0, "대체된 옛 판 0");
    const ds = cards[1];
    assert.equal(ds.type, "지방세 세수");
    assert.equal(ds.license, "공공누리 제1유형 (출처표시)");
    assert.match(ds.dates, /발표일2026-07-15/);
    assert.match(ds.dates, /기준일2026-06-30/);
    assert.match(ds.dates, /지역 단위시·군·구/);
    assert.match(ds.dates, /확인일2026-10-20/);
    assert.deepEqual(ds.link, { href: DATASET.url, target: "_blank", rel: "noopener noreferrer" });
    assert.equal(await page.locator('[data-part="official-source-dates"]').first().evaluate((el) => getComputedStyle(el).fontFamily.toLowerCase().includes("mono")), true, "날짜 고정폭");

    // 원문 블록 ≠ 해석 블록 — 카드는 본문 블록 밖, 카드에 본문 글자 0, 본문 블록에 카드 0
    for (const c of cards) {
      assert.equal(c.inBlocks, false, `src:${c.id} 카드가 본문 블록 안에 있다`);
      assert.equal(c.text.includes("편집국이 결산 자료를 읽어 보니"), false, "카드에 기자의 해석 글자 0");
    }
    assert.match(await page.locator('[data-part="blocks"]').innerText(), /편집국이 결산 자료를 읽어 보니/, "해석은 본문 블록에");
    assert.equal(await page.locator('[data-part="blocks"] [data-part="official-source-card"]').count(), 0);

    // 보도자료 줄 — 유형 글자
    const pressLine = page.locator(`[data-part="sources"] [data-source-id="${a.pressId}"]`);
    assert.equal((await pressLine.locator('[data-part="license-badge"]').textContent()).trim(), "· 공공누리 제2유형 (출처표시·상업적 이용금지)");

    // 자르기 불가 대표 사진 — 화면 비율 = 원본(±1%), object-fit cover 0
    const img = page.locator('[data-part="lead-image"]');
    await img.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('[data-part="lead-image"]')?.complete);
    const box = await img.evaluate((el) => ({ w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height, fit: getComputedStyle(el).objectFit, nw: el.naturalWidth, nh: el.naturalHeight }));
    assert.deepEqual([box.nw, box.nh], [fx.own.width, fx.own.height], "원본 그림이 왔다");
    const natural = fx.own.width / fx.own.height;
    assert.ok(Math.abs(box.w / box.h - natural) / natural < 0.01, `원본 비율 ${natural} ≠ 화면 ${box.w / box.h}`);
    assert.notEqual(box.fit, "cover");
  } finally {
    await ctx.close();
  }
});

test("c) 자료 종류 차단 4종 — 출처 422(칸 이름)·설정 422·DB 거부, 목록 밖 422 · 유형 없는 보도자료 422 · 제4유형·미표시는 이용 범위 설정에도 0", async () => {
  const draft = await api("POST", "/articles", u.reporter, { slug: slugOf("types"), title: `시험용 자료 종류 ${staff.run}`, section: "local", contentType: "reported_news" });
  assert.equal(draft.status, 201, show(draft));
  const id = draft.body.article.id;
  staff.trackArticle(id);
  const official = { kind: "official_doc", title: "시험용 가상구 안내", url: "https://gasang.example/guide", sourceName: "시험용 가상구청", lastVerifiedAt: "2026-10-20T10:00:00+09:00", licenseStatus: "출처표시", licenseType: "kogl_1" };
  for (const t of BLOCKED) {
    const r = await api("POST", `/articles/${id}/sources`, u.reporter, { ...official, sourceType: t });
    assert.equal(r.status, 422, `${t}: ${show(r)}`);
    assert.deepEqual(r.body.errors, [`source.sourceType: 자료 종류 ${t}는 교통·관광·음식점·생활 안내라 지역정보(공식 자료)에 넣지 않습니다 (REG1-07 코드 고정)`]);
    await assert.rejects(
      db.query("insert into public.article_sources (article_id, kind, title, source_url, source_name, last_verified_at, license_status, license_type, source_type) values ($1, 'official_doc', 'x', 'https://x.example', 'x', now(), 'x', 'kogl_1', $2)", [id, t]),
      /REG1-07 코드 고정/,
      `${t}: DB도 거부`,
    );
  }
  const outside = await api("POST", `/articles/${id}/sources`, u.reporter, { ...official, sourceType: "festival_guide" });
  assert.equal(outside.status, 422, show(outside));
  assert.deepEqual(outside.body.errors.map((e) => e.split(":")[0]), ["source.sourceType"]);
  const ok = await api("POST", `/articles/${id}/sources`, u.reporter, { ...official, sourceType: "notice" });
  assert.equal(ok.status, 201, show(ok));
  const noLicense = await api("POST", `/articles/${id}/sources`, u.reporter, { kind: "press_release", title: "유형 없는 시험용 보도자료" });
  assert.equal(noLicense.status, 422, show(noLicense));
  assert.deepEqual(noLicense.body.errors.map((e) => e.split(":")[0]), ["source.licenseType"]);
  assert.equal((await sourceRows(id)).length, 1, "거부된 출처 0");

  // 설정 — 차단 종류를 허용 목록에 넣기 422(관리자도), 값 그대로
  for (const t of BLOCKED) {
    const r = await api("PATCH", "/settings/official_source_types", u.admin, { value: [...TYPES_SEED, t] });
    assert.equal(r.status, 422, `${t}: ${show(r)}`);
    assert.match(JSON.stringify(r.body), /REG1-07 코드 고정/);
  }
  for (const t of ["kogl_4", "unmarked"]) {
    const r = await api("PATCH", "/settings/kogl_usage", u.admin, { value: { photoTypes: ["kogl_1", t], fullTextTypes: [] } });
    assert.equal(r.status, 422, `${t}: ${show(r)}`);
    const full = await api("PATCH", "/settings/kogl_usage", u.admin, { value: { photoTypes: ["kogl_1"], fullTextTypes: [t] } });
    assert.equal(full.status, 422, `${t} 전재: ${show(full)}`);
    await assert.rejects(db.query("update public.settings set value = $1::jsonb where key = 'kogl_usage'", [JSON.stringify({ photoTypes: [t], fullTextTypes: [] })]), /PR-07 코드 고정/, `${t}: DB도 거부`);
  }
  assert.deepEqual((await one("select value from public.settings where key = 'official_source_types'")).value, TYPES_SEED);
  assert.deepEqual((await one("select value from public.settings where key = 'kogl_usage'")).value, KOGL_SEED);
});

test("d) 사진 — 제2·3유형은 기본값에서 공개 렌더 0(화면·anon), 이용 범위를 열면 다음 요청부터 보이고 되돌리면 다시 0", async () => {
  const anonMedia = async (ids) => {
    const res = await fetch(`${sb.url}/rest/v1/media?select=id&id=in.(${ids.join(",")})`, { headers: { apikey: sb.anonKey, authorization: `Bearer ${sb.anonKey}` } });
    return (await res.json()).map((m) => Number(m.id)).sort((x, y) => x - y);
  };
  const imagesOn = async () => {
    const { page, ctx, status } = await pageWithImages(fx.photos.href);
    try {
      assert.equal(status, 200);
      return {
        lead: await page.locator('[data-part="lead-image"]').count(),
        body: await page.$$eval('[data-part="blocks"] figure img', (els) => els.map((e) => e.getAttribute("alt"))),
      };
    } finally {
      await ctx.close();
    }
  };
  assert.deepEqual(await anonMedia([fx.own.id, fx.kogl2.id, fx.kogl3.id]), [fx.own.id], "anon은 자체 촬영만");
  assert.deepEqual(await imagesOn(), { lead: 0, body: ["자체 촬영 시험 사진"] }, "기본값 — 제2유형 대표·제3유형 본문 사진 0");

  try {
    const open = await api("PATCH", "/settings/kogl_usage", u.admin, { value: { photoTypes: ["kogl_1", "kogl_2", "not_applicable"], fullTextTypes: [] } });
    assert.equal(open.status, 200, show(open));
    assert.deepEqual(await anonMedia([fx.own.id, fx.kogl2.id, fx.kogl3.id]), [fx.own.id, fx.kogl2.id].sort((x, y) => x - y), "제2유형을 열면 그 사진만");
    assert.deepEqual(await imagesOn(), { lead: 1, body: ["자체 촬영 시험 사진"] }, "다음 요청부터 제2유형 대표 사진, 제3유형은 그대로 0");
  } finally {
    const back = await api("PATCH", "/settings/kogl_usage", u.admin, { value: KOGL_SEED });
    assert.equal(back.status, 200, show(back));
  }
  assert.deepEqual(await anonMedia([fx.own.id, fx.kogl2.id, fx.kogl3.id]), [fx.own.id]);
  assert.deepEqual(await imagesOn(), { lead: 0, body: ["자체 촬영 시험 사진"] }, "되돌리면 다시 0");
});

test("e) 고시 자료를 쓴 해설 — 간편 발행(2026-10-31 PO 결정): 세무 감수 없이 발행 200, 빠진 감수는 경고(REG1-07 이유)·작성자 책임 기록, 감수 상태는 그대로", async () => {
  const a = await draftExplainer("notice", "시험용 가상구 고시로 보는 감면 신청");
  const notice = await api("POST", `/articles/${a.id}/sources`, u.reporter, {
    kind: "official_doc",
    title: "시험용 가상구 고시 제2026-1호",
    url: "https://gasang.example/notice/2026-1",
    sourceName: "시험용 가상구청",
    lastVerifiedAt: "2026-10-20T10:00:00+09:00",
    licenseStatus: "출처표시",
    licenseType: "kogl_1",
    sourceType: "notice",
    publishedOn: "2026-09-01",
    referenceDate: "2026-09-01",
    regionUnit: "시·군·구",
    collectedAt: "2026-10-19T09:00:00+09:00",
  });
  assert.equal(notice.status, 201, show(notice));
  const saved = await writeBody(a);
  assert.equal(saved.status, 200, show(saved));
  assert.equal(saved.body.article.taxReviewStatus, "pending", "세무 감수 대상");
  const check = await api("GET", `/articles/${a.id}/check`, u.reporter);
  assert.equal(check.status, 200, show(check));
  assert.deepEqual(check.body.failed, [], show(check));
  assert.match(check.body.findings.find((f) => f.id === "nav03.tax-review-required").message, /고시·조례 자료를 쓴 해설 \(REG1-07\)/, "대상 이유는 경고 문장에 그대로");
  await approve(a, { tax: false });
  const ok = await publish(a);
  assert.equal(ok.status, 200, show(ok));
  const row = await one("select status, tax_review_status, check_log -> 'publish' as pub from public.articles where id = $1", [a.id]);
  assert.equal(row.status, "published");
  assert.equal(row.tax_review_status, "pending", "감수 기록이 없으니 감수 상태는 approved가 아니다");
  assert.equal(row.pub.authorResponsibility, true, "작성자 책임 발행(세무 감수 대체) 기록");
});

test("f) 편집 화면 — 공식 자료 칸 오류 · 자료 종류 목록 = 허용 목록(차단 4종 0) · 원자료 고치기 폼 사유 칸 오류 → 새 버전", async () => {
  const draft = await api("POST", "/articles", u.reporter, { slug: slugOf("editor"), title: `시험용 편집 화면 공식 자료 ${staff.run}`, section: "local", contentType: "reported_news" });
  assert.equal(draft.status, 201, show(draft));
  const id = draft.body.article.id;
  staff.trackArticle(id);
  const seeded = await api("POST", `/articles/${id}/sources`, u.reporter, { ...DATASET, snapshot: undefined });
  assert.equal(seeded.status, 201, show(seeded));
  const srcId = Number(seeded.body.source.id);

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await ctx.newPage();
    await page.goto(`${base}/admin/login`);
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "로그인" && !b.disabled));
    await page.fill("#login-email", u.reporter.email);
    await page.fill("#login-password", u.reporter.password);
    await page.getByRole("button", { name: "로그인" }).click();
    await page.waitForURL((url) => url.pathname !== "/admin/login");
    await page.goto(`${base}/admin/articles/${id}`);
    // 출처 칸은 접힌 '그 밖의 칸' 안에 있다 (간편 발행 2026-10-31) — 눌러서 편다
    await page.locator("details#more-sections > summary").click();
    const form = page.getByRole("form", { name: "출처 더하기" });
    await form.getByRole("button", { name: "출처 더하기" }).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll("form[aria-label='출처 더하기'] button")].some((b) => !b.disabled));

    // 목록에 있는 출처 — 빈 칸 표시
    const item = page.locator(`[data-testid="source-list"] [data-source-id="${srcId}"]`);
    assert.match(await item.locator('[data-testid="source-missing"]').innerText(), /기준일·지역 단위/);

    // 공식 문서 — 제목만 적고 더하기 → 칸 오류(저장 0)
    await form.locator("#src-kind").selectOption("official_doc");
    await form.locator("#src-title").fill("시험용 칸 빈 공식 문서");
    await form.getByRole("button", { name: "출처 더하기" }).click();
    for (const field of ["src-license-type", "src-published", "src-reference", "src-region-unit", "src-collected"]) {
      assert.ok((await form.locator(`#${field}-error`).innerText()).length > 0, `${field} 칸 오류`);
      assert.match((await form.locator(`#${field}`).getAttribute("aria-describedby")) ?? "", new RegExp(`${field}-error`));
    }
    assert.match(await form.locator("#src-license-type-error").innerText(), /PR-07/);
    assert.match(await form.locator("#src-reference-error").innerText(), /REG1-09/);
    const options = await form.locator("#src-source-type option").evaluateAll((els) => els.map((e) => e.getAttribute("value")));
    assert.deepEqual(options, ["", ...TYPES_SEED], "자료 종류 = 허용 목록(차단 4종 0)");
    assert.equal((await sourceRows(id)).length, 1, "저장 0");

    // 원자료 고치기 — 사유 없이 저장 → 사유 칸 오류, 사유를 적으면 새 버전
    await item.getByRole("button", { name: `src:${srcId} 원자료 고치기 (새 버전)` }).click();
    const rev = page.getByRole("form", { name: `src:${srcId} 원자료 고치기` });
    await rev.locator(`#rev-${srcId}-reference`).fill("2026-06-30");
    await rev.locator(`#rev-${srcId}-region-unit`).fill("시·군·구");
    await rev.getByRole("button", { name: "새 버전 저장" }).click();
    assert.match(await rev.locator(`#rev-${srcId}-reason-error`).innerText(), /수정 사유/);
    assert.equal((await sourceRows(id)).length, 1, "사유 없이 새 행 0");
    await rev.locator(`#rev-${srcId}-reason`).fill("결산 공고의 기준일·지역 단위 확인");
    await rev.getByRole("button", { name: "새 버전 저장" }).click();
    const newer = page.locator('[data-testid="source-list"] li', { hasText: `새 버전 (src:${srcId} 대체)` });
    await newer.waitFor();
    assert.match(await newer.innerText(), /수정 사유: 결산 공고의 기준일·지역 단위 확인/);
    assert.equal(await page.locator(`[data-testid="source-list"] [data-source-id="${srcId}"]`).count(), 0, "편집 화면 목록은 최신 판만");
    const rows = await sourceRows(id);
    assert.equal(rows.length, 2);
    assert.equal(Number(rows[1].supersedes_id), srcId);
  } finally {
    await ctx.close();
  }
});
