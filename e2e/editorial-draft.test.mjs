// 편집위원 결과물 → 기사 초안 옮기기 E2E (PO 2026-11-18 "기사초안으로 옮기기 버튼만들어줘")
// standalone 빌드를 로컬 Supabase에 붙인다. 결과물 묶음(editorial_packages + 비공개 버킷 editorial-desk)을 시험이 직접 만들고, 화면 버튼과 API로 초안을 만든다.
//  a) 권한 — 비로그인 401 · 편집위원만(기사 작성 권한 없음) 403·묶음 화면에 버튼 0 · 기자(편집위원 아님) 403
//  b) 확인 창 기본값 — 제목·요약(부제)·분야 tax·칼럼·하위 분야 columns·주소 desk-날짜 · 그림 3(썸네일 대표·AI 확인·실사진 미확인) · 출처 2 · 확인 필요 2
//  c) 입력 오류 — 제목 41자·모르는 분야 422(화면 말), 아무것도 만들지 않음
//  d) 화면 — 편집위원+편집 책임자가 [기사 초안으로 옮기기] → 미리 채운 확인 창 → [초안 만들기] → 초안 링크
//     · DB: 초안(draft)·작성자 = 누른 사람의 인물·분야·유형·하위 분야·대표 사진 = 썸네일 · 본문 첫 블록 핵심 요약 · ※ 줄은 표 제목 · 그림 블록 = 사진 보관함 번호
//     · 사진 보관함: AI 그림 2장 권리 확인됨(출처 'AI 생성 (OpenAI gpt-image-2)'·해당 없음), 실사진 1장 미확인 · 공개 버킷 바이트 = 원본
//     · 출처 2건(기타)·묶음 article_id·감사 로그(기사·사진) · 같은 묶음 다시 만들기 409 · 묶음 화면은 '초안 열기'
//  e) AI 그림만 있는 묶음(판례소개 → 해설)은 초안 그대로 [발행] 통과 → 공개 200 / d)의 칼럼 초안은 만든 사람 발행 403(BR-08), 다른 편집 책임자도 실사진 권리 미확인이라 422 nav04.image-rights
// 만든 계정·기사·사진·묶음·저장소 객체는 끝나면 지운다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

let sb, server, staff, db, base, browser;
const u = {};
const fx = { packages: [], deskKeys: [] };
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const rows = async (sql, params) => (await db.query(sql, params)).rows;
const show = (r) => JSON.stringify(r.body).slice(0, 1500);

/** w×h 단색 PNG — 사진 보관함 검사(파일 모양·크기)를 통과하는 진짜 그림 */
function png(w, h, rgb) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const COLUMN_MD = (run) => `# 30년 산 집에 공제 한도 10억…장기거주 소득공제의 역설 ${run}

[섹션] 전문가 칼럼

[제목] 30년 산 집 공제 한도 10억의 역설 ${run}

[제목 대안]

1. 보유는 빼고 거주만 센다
2. 오래 지킨 집일수록 손해 보는 공제

[부제] 2028년부터 거주 중심 개편…세금 3.6배 차이

[이미지 캡션] ▲오래 살아온 아파트 거실 창가. (이미지: AI 생성, OpenAI gpt-image-2)

## 본문

이준수 기자(공인회계사·세무사)

은퇴를 앞둔 1주택자라면 2027년 12월 31일을 기억해 둘 필요가 있습니다.

◇ 1. 현행 제도는 보유와 거주를 더하는 구조

현행 제도의 근거는 「소득세법」 제95조 제2항입니다.

![오래 살아온 아파트 거실 창가](images/ai1_거실.png)

▲오래 살아온 아파트 거실 창가. 18년 실거주한 A씨. (이미지: AI 생성, OpenAI gpt-image-2)

![1976년 한강변 아파트](images/photo_한강.png)

▲1976년 한강변 아파트 단지. (사진: 국가기록원, 공공누리 1유형)

※ 장기보유특별공제 개편 정부안 요약

| 구분 | 2027년 | 2029년 |
| --- | --- | --- |
| 공제 한도 | 없음 | 10억 원 |

[바이라인] 이준수 기자(공인회계사·세무사) js.lee@sunmyung.kr

[키워드] #장기보유특별공제 #양도소득세

[요약] 정부안대로라면 공제가 거주 중심으로 바뀝니다. 30년 거주자는 세금이 크게 늘어 보완이 필요합니다.

---

## 편집 메모

출처 목록

- 한국세정신문, 「2026년 세제개편안」(2026.8.5) https://taxtimes.co.kr/news/article.html?no=276274
- 머니투데이(2026.11.8) https://www.mt.co.kr/article/2026110608451788914

[확인 필요]

1. B씨 공제율 해석.
2. 조세소위 심사 결과.

[이미지 출처·라이선스]

- 썸네일: images/썸네일_1200x630.png (AI 생성 배경 + HTML 글자)

썸네일 파일명: images/썸네일_1200x630.png
`;

const CASE_MD = (run) => `# 판례 ${run}

[섹션] 판례소개

[제목] 간주취득세 평가충당금 차감 불허 ${run}

[부제] 장부가액도 실제 가치에 맞아야 과표

## 본문

대법원은 근거 없는 평가충당금을 과표에서 뺄 수 없다고 판단했습니다.

![개발 예정 토지](images/ai1_토지.png)

▲개발 예정 토지를 형상화한 이미지. (이미지: AI 생성, OpenAI gpt-image-2)

[요약] 대법원이 근거 없는 평가충당금 차감을 불허했습니다.

## 편집 메모

[확인 필요]

- 1심 금액 확인.
`;

async function storage(method, objectPath, body, contentType) {
  const res = await fetch(`${sb.url}/storage/v1/object/${objectPath}`, {
    method,
    headers: { authorization: `Bearer ${sb.serviceRoleKey}`, apikey: sb.serviceRoleKey, ...(contentType ? { "content-type": contentType } : {}), "x-upsert": "true" },
    body,
  });
  assert.ok(res.ok, `저장소 ${method} ${objectPath}: ${res.status} ${await res.text()}`);
}

/** 결과물 묶음 하나 — 파일을 비공개 버킷에 올리고 editorial_packages 행을 만든다 (작업기 sync와 같은 모양) */
async function makePackage(folder, files) {
  const list = [];
  for (const [i, f] of files.entries()) {
    const key = `packages/${folder}/e2e${i}.${f.path.split(".").pop()}`;
    await storage("POST", `editorial-desk/${key}`, f.bytes, f.mime);
    fx.deskKeys.push(key);
    list.push({ path: f.path, size: f.bytes.length, mime: f.mime, key });
  }
  const row = await one("insert into public.editorial_packages (folder, work_date, title, source, files) values ($1, '2099-12-31', $2, 'cowork', $3::jsonb) returning id", [folder, `시험 묶음 ${folder}`, JSON.stringify(list)]);
  fx.packages.push(row.id);
  return row.id;
}

async function call(method, path, user, body) {
  const headers = user ? { authorization: `Bearer ${user.token}` } : {};
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function pageAs(user) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/login`);
  await page.fill('input[name="email"]', user.email);
  await page.fill('input[name="password"]', user.password);
  await Promise.all([page.waitForURL((url) => !url.pathname.startsWith("/login")), page.click('button[type="submit"]')]);
  return { page, ctx };
}

before(async () => {
  sb = localSupabase();
  buildWeb();
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    NEXT_PUBLIC_SITE_URL: "https://e2e.example.test",
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  u.deskEditor = await staff.createUser({ label: "draft-editor", roles: ["editor", "editorial_board"], person: { name: "초안 편집 책임자", roles: ["editor"] } });
  u.board = await staff.createUser({ label: "draft-board", roles: ["editorial_board"] });
  u.editor2 = await staff.createUser({ label: "draft-editor2", roles: ["editor"], person: { name: "다른 편집 책임자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "draft-rep", roles: ["reporter"], person: { name: "초안 기자", roles: ["reporter"] } });

  const n = Number.parseInt(staff.run.slice(-6), 16) % 90000;
  fx.columnFolder = `2099_12_31_${n}`;
  fx.caseFolder = `2099_12_30_${n}`;
  fx.ai1 = png(40, 30, [200, 180, 150]);
  fx.photo = png(30, 30, [90, 90, 120]);
  fx.thumb = png(120, 63, [20, 40, 80]);
  fx.columnId = await makePackage(fx.columnFolder, [
    { path: "장특공제_칼럼.md", mime: "text/markdown", bytes: Buffer.from(COLUMN_MD(staff.run), "utf8") },
    { path: "images/ai1_거실.png", mime: "image/png", bytes: fx.ai1 },
    { path: "images/photo_한강.png", mime: "image/png", bytes: fx.photo },
    { path: "images/썸네일_1200x630.png", mime: "image/png", bytes: fx.thumb },
    { path: "thread/threads.md", mime: "text/markdown", bytes: Buffer.from("# 쓰레드 — 더 큰 파일이어도 하위 폴더 md는 원고가 아니다\n".repeat(200), "utf8") },
  ]);
  fx.caseId = await makePackage(fx.caseFolder, [
    { path: "간주취득세_판례.md", mime: "text/markdown", bytes: Buffer.from(CASE_MD(staff.run), "utf8") },
    { path: "images/ai1_토지.png", mime: "image/png", bytes: png(20, 20, [120, 160, 90]) },
  ]);
  browser = await chromium.launch();
});

after(async () => {
  try {
    await browser?.close();
    const media = fx.packages.length ? await rows("select m.id, m.path from public.media m join public.articles a on a.lead_media_id = m.id or a.body::text like '%\"mediaId\": \"' || m.id || '\"%' where a.id in (select article_id from public.editorial_packages where id = any($1::uuid[]))", [fx.packages]).catch(() => []) : [];
    const mediaIds = [...new Set([...media.map((m) => Number(m.id)), ...(fx.mediaIds ?? [])])];
    const mediaPaths = (await rows("select path from public.media where id = any($1::bigint[])", [mediaIds]).catch(() => [])).map((m) => m.path);
    if (fx.packages.length) await db.query("delete from public.editorial_packages where id = any($1::uuid[])", [fx.packages]).catch(() => {});
    // 사진은 계정 정리(연결을 닫는다) 전에 — 아직 남은 시험 기사가 대표 사진으로 가리키므로 정리 도구처럼 외래 키 검사를 끈 세션에서 지운다
    if (mediaIds.length) {
      await db.query("set session_replication_role = replica");
      await db.query("delete from public.media where id = any($1::bigint[])", [mediaIds]).catch((e) => console.error("[정리] media 지우기 실패:", e.message));
      await db.query("set session_replication_role = default");
    }
    await staff?.cleanup();
    const mediaObjects = mediaPaths.map((p) => p.split("/").pop());
    if (mediaObjects.length) await fetch(`${sb.url}/storage/v1/object/media`, { method: "DELETE", headers: { authorization: `Bearer ${sb.serviceRoleKey}`, apikey: sb.serviceRoleKey, "content-type": "application/json" }, body: JSON.stringify({ prefixes: mediaObjects }) }).catch(() => {});
    if (fx.deskKeys.length) await fetch(`${sb.url}/storage/v1/object/editorial-desk`, { method: "DELETE", headers: { authorization: `Bearer ${sb.serviceRoleKey}`, apikey: sb.serviceRoleKey, "content-type": "application/json" }, body: JSON.stringify({ prefixes: fx.deskKeys }) }).catch(() => {});
  } finally {
    server?.stop();
  }
});

test("a) 권한 — 비로그인 401, 편집위원만 403·버튼 0, 편집위원 아닌 기자 403", async () => {
  const draft = `/api/editorial/packages/${fx.columnId}/draft`;
  assert.equal((await call("GET", draft)).status, 401);
  assert.equal((await call("GET", draft, u.board)).status, 403, "편집위원 역할만으로는 기사를 만들 수 없다(article.create)");
  assert.equal((await call("POST", draft, u.board, { title: "x" })).status, 403);
  assert.equal((await call("GET", draft, u.reporter)).status, 403, "기자라도 편집위원 데스크를 볼 수 없으면 403(editorial_desk.read)");
  const { page, ctx } = await pageAs(u.board);
  try {
    await page.goto(`${base}/editorial/packages/${fx.columnId}`);
    await page.getByRole("heading", { name: /시험 묶음/ }).waitFor();
    assert.equal(await page.getByTestId("draft-open").count(), 0, "편집위원만인 사람에게 버튼 없음");
    assert.equal(await page.getByText("사이트 기사로 옮기기").count(), 0);
  } finally {
    await ctx.close();
  }
});

test("b) 확인 창 기본값 — 원고·그림·출처·확인 필요를 읽어 미리 채운다", async () => {
  const r = await call("GET", `/api/editorial/packages/${fx.columnId}/draft`, u.deskEditor);
  assert.equal(r.status, 200, show(r));
  const p = r.body.preview;
  assert.equal(p.mdPath, "장특공제_칼럼.md", "폴더 바로 아래 md가 원고 — 더 큰 thread/ md는 아님");
  assert.deepEqual(
    { title: p.defaults.title, summary: p.defaults.summary, section: p.defaults.section, contentType: p.defaults.contentType, categorySlug: p.defaults.categorySlug, slug: p.defaults.slug },
    { title: `30년 산 집 공제 한도 10억의 역설 ${staff.run}`, summary: "2028년부터 거주 중심 개편…세금 3.6배 차이", section: "tax", contentType: "opinion", categorySlug: "columns", slug: `desk-${fx.columnFolder.replace(/_/g, "-")}` },
  );
  assert.deepEqual(
    p.images.map((i) => [i.path, i.kind, i.lead, i.confirmed]),
    [
      ["images/썸네일_1200x630.png", "thumbnail", true, true],
      ["images/ai1_거실.png", "photo", false, true],
      ["images/photo_한강.png", "photo", false, false],
    ],
  );
  assert.equal(p.sources, 2);
  assert.deepEqual(p.needsCheck, ["B씨 공제율 해석.", "조세소위 심사 결과."]);
  assert.equal(p.existing, null);
  assert.ok(p.categories.some((c) => c.section === "tax" && c.slug === "columns"), "하위 분야 목록");
});

test("c) 입력 오류 — 제목 41자·모르는 분야는 422, 아무것도 만들지 않는다", async () => {
  const before = Number((await one("select count(*)::int as n from public.media")).n);
  const r = await call("POST", `/api/editorial/packages/${fx.columnId}/draft`, u.deskEditor, { title: "가".repeat(41), summary: "", section: "nowhere", contentType: "opinion", categorySlug: "", slug: "desk-e2e" });
  assert.equal(r.status, 422, show(r));
  assert.deepEqual(r.body.errors, ["제목: 40자 이하로 줄여 주세요 (지금 41자)", "분야: 지방세·부동산세금·부동산재테크·부동산금융·지자체뉴스 중에서 골라 주세요"]);
  assert.equal(Number((await one("select count(*)::int as n from public.media")).n), before, "사진 보관함에 새 행 0");
  assert.equal((await one("select article_id from public.editorial_packages where id = $1", [fx.columnId])).article_id, null);
});

test("d) 화면에서 [기사 초안으로 옮기기] → [초안 만들기] — 초안·본문·사진 권리·출처·감사 기록·중복 막기", async () => {
  const { page, ctx } = await pageAs(u.deskEditor);
  try {
    await page.goto(`${base}/editorial/packages/${fx.columnId}`);
    await page.getByTestId("draft-open").click();
    await page.getByTestId("draft-form").waitFor();
    assert.equal(await page.inputValue("#df-title"), `30년 산 집 공제 한도 10억의 역설 ${staff.run}`);
    assert.equal(await page.inputValue("#df-summary"), "2028년부터 거주 중심 개편…세금 3.6배 차이");
    assert.equal(await page.inputValue("#df-section"), "tax");
    assert.equal(await page.inputValue("#df-type"), "opinion");
    assert.equal(await page.inputValue("#df-category"), "columns");
    await page.getByTestId("draft-submit").click();
    await page.getByTestId("draft-done").waitFor({ timeout: 30_000 });
    const href = await page.getByRole("link", { name: /초안 열기/ }).getAttribute("href");
    fx.articleId = Number(/\/admin\/articles\/(\d+)$/.exec(href)[1]);
    assert.match(await page.getByTestId("draft-done").innerText(), /그림 3장을 사진 보관함에 넣었습니다 — 권리 미확인 1장/);
  } finally {
    await ctx.close();
  }
  staff.trackArticle(fx.articleId);

  const a = await one("select a.*, c.slug as category_slug from public.articles a left join public.categories c on c.id = a.category_id where a.id = $1", [fx.articleId]);
  const person = await one("select id from public.people where staff_user_id = $1", [u.deskEditor.id]);
  assert.deepEqual(
    { status: a.status, author: Number(a.author_id), section: a.section, type: a.content_type, category: a.category_slug, title: a.title, summary: a.summary, slug: a.slug, format: a.format },
    { status: "draft", author: Number(person.id), section: "tax", type: "opinion", category: "columns", title: `30년 산 집 공제 한도 10억의 역설 ${staff.run}`, summary: "2028년부터 거주 중심 개편…세금 3.6배 차이", slug: `desk-${fx.columnFolder.replace(/_/g, "-")}`, format: "general" },
  );

  const media = await rows("select id, path, kind, rights_status, credit, photographer, license_type, checked_at, alt from public.media where id in (select (b->>'mediaId')::bigint from jsonb_array_elements($1::jsonb) b where b->>'type' = 'image') or id = $2 order by id", [JSON.stringify(a.body.blocks), a.lead_media_id]);
  fx.mediaIds = media.map((m) => Number(m.id));
  assert.equal(media.length, 3, "썸네일 + 본문 그림 2");
  const lead = media.find((m) => Number(m.id) === Number(a.lead_media_id));
  assert.deepEqual([lead.kind, lead.rights_status, lead.credit, lead.license_type], ["thumbnail", "confirmed", "AI 생성 (OpenAI gpt-image-2)", "not_applicable"], "대표 사진 = 썸네일, AI라 권리 확인됨");
  const [aiImg, photoImg] = a.body.blocks.filter((b) => b.type === "image").map((b) => media.find((m) => String(m.id) === b.mediaId));
  assert.deepEqual([aiImg.rights_status, aiImg.photographer, aiImg.alt, aiImg.checked_at !== null], ["confirmed", "AI 생성 (OpenAI gpt-image-2)", "오래 살아온 아파트 거실 창가", true]);
  assert.deepEqual([photoImg.rights_status, photoImg.credit, photoImg.license_type], ["unconfirmed", "국가기록원, 공공누리 1유형", null], "'AI 생성' 표기가 없는 실사진은 미확인");
  // 공개 버킷에 원본 그대로
  const got = Buffer.from(await (await fetch(`${sb.url}/${aiImg.path}`)).arrayBuffer());
  assert.ok(got.equals(fx.ai1), "사진 보관함 그림 = 결과물 그림(바이트)");

  assert.deepEqual(
    a.body.blocks.map((b) => (b.type === "image" ? ["image", b.caption] : b.type === "table" ? ["table", b.caption, b.rows.length] : b.type === "key_summary" ? ["key_summary", ...b.lines] : [b.type, b.text])),
    [
      ["key_summary", "정부안대로라면 공제가 거주 중심으로 바뀝니다.", "30년 거주자는 세금이 크게 늘어 보완이 필요합니다."],
      ["paragraph", "은퇴를 앞둔 1주택자라면 2027년 12월 31일을 기억해 둘 필요가 있습니다."],
      ["heading", "1. 현행 제도는 보유와 거주를 더하는 구조"],
      ["paragraph", "현행 제도의 근거는 「소득세법」 제95조 제2항입니다."],
      ["image", "▲오래 살아온 아파트 거실 창가. 18년 실거주한 A씨. (이미지: AI 생성, OpenAI gpt-image-2)"],
      ["image", "▲1976년 한강변 아파트 단지. (사진: 국가기록원, 공공누리 1유형)"],
      ["table", "장기보유특별공제 개편 정부안 요약", 2],
    ],
    "바이라인 줄·편집 메모는 본문에 없음",
  );

  const sources = await rows("select kind, title, source_url from public.article_sources where article_id = $1 order by id", [fx.articleId]);
  assert.deepEqual(sources, [
    { kind: "other", title: "한국세정신문, 「2026년 세제개편안」(2026.8.5)", source_url: "https://taxtimes.co.kr/news/article.html?no=276274" },
    { kind: "other", title: "머니투데이(2026.11.8)", source_url: "https://www.mt.co.kr/article/2026110608451788914" },
  ]);
  assert.equal(Number((await one("select article_id from public.editorial_packages where id = $1", [fx.columnId])).article_id), fx.articleId);
  const audit = await rows("select action, reason from public.audit_logs where target = $1 or target = any($2::text[]) order by id", [`articles:${fx.articleId}`, fx.mediaIds.map((id) => `media:${id}`)]);
  assert.ok(audit.some((l) => l.action === "article.create" && l.reason.includes(`편집위원 결과물 ${fx.columnFolder}을 기사 초안으로 옮김`)), JSON.stringify(audit));
  assert.equal(audit.filter((l) => l.action === "media.create" && l.reason.includes("AI 생성 그림이라 권리 확인됨")).length, 2);

  // 같은 묶음으로 다시 만들기 409 · 화면은 '초안 열기'
  const again = await call("POST", `/api/editorial/packages/${fx.columnId}/draft`, u.deskEditor, { title: "다시", summary: "", section: "tax", contentType: "opinion", categorySlug: "", slug: "desk-again-e2e" });
  assert.equal(again.status, 409, show(again));
  const { page: p2, ctx: c2 } = await pageAs(u.deskEditor);
  try {
    await p2.goto(`${base}/editorial/packages/${fx.columnId}`);
    await p2.getByTestId("draft-existing").waitFor();
    assert.equal(await p2.getByTestId("draft-open").count(), 0);
  } finally {
    await c2.close();
  }
});

test("e) AI 그림만 있는 묶음은 초안 그대로 [발행] 통과 · 실사진 미확인 초안은 발행 422", async () => {
  const r = await call("POST", `/api/editorial/packages/${fx.caseId}/draft`, u.deskEditor, { title: `간주취득세 평가충당금 차감 불허 ${staff.run}`, summary: "장부가액도 실제 가치에 맞아야 과표", section: "tax", contentType: "explainer", categorySlug: "interpretations", slug: `desk-${fx.caseFolder.replace(/_/g, "-")}` });
  assert.equal(r.status, 201, show(r));
  const id = Number(r.body.article.id);
  staff.trackArticle(id);
  fx.mediaIds = [...(fx.mediaIds ?? []), ...r.body.images.map((i) => i.mediaId)];
  assert.deepEqual(r.body.images.map((i) => i.confirmed), [true]);
  assert.deepEqual(r.body.needsCheck, ["1심 금액 확인."]);

  const pub = await call("POST", `/api/admin/articles/${id}/publish`, u.deskEditor);
  assert.equal(pub.status, 200, show(pub));
  const slug = (await one("select slug, status from public.articles where id = $1", [id])).slug;
  assert.equal((await one("select status from public.articles where id = $1", [id])).status, "published");
  assert.equal((await fetch(`${base}/news/${encodeURIComponent(slug)}`)).status, 200, "공개 화면");

  // 칼럼 초안: 만든 사람(작성자)은 자기 칼럼을 발행할 수 없다(BR-08) → 다른 편집 책임자가 발행해도 실사진 권리 미확인이 막는다
  const own = await call("POST", `/api/admin/articles/${fx.articleId}/publish`, u.deskEditor);
  assert.equal(own.status, 403, show(own));
  const blocked = await call("POST", `/api/admin/articles/${fx.articleId}/publish`, u.editor2);
  assert.equal(blocked.status, 422, show(blocked));
  assert.ok(blocked.body.failed.includes("nav04.image-rights"), "실사진 권리 미확인은 발행을 막는다");
});
