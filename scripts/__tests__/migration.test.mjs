// W9 이관 도구 시험 (docs/dev/W9_설계.md) — 모든 자료는 지어낸 값(fixtures/migration)이다
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LEGACY_CATEGORIES, findCategory } from "../migration/format.mjs";
import { articleIdOf, normalizeLegacyUrl } from "../migration/normalize.mjs";
import { validateDocument } from "../migration/validate.mjs";
import { htmlToBlocks, toArticle } from "../migration/transform.mjs";
import { buildUrlMap, checkUrlMap, renderRedirectsSql } from "../migration/urlmap.mjs";
import { adaptNdsoft, parseRss, parseSitemap } from "../migration/adapters/ndsoft.mjs";
import { adaptWxr } from "../migration/adapters/wxr.mjs";
import { runDryRun } from "../migration/run.mjs";
import { main } from "../migration/cli.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const fx = (name) => readFileSync(join(here, "fixtures", "migration", name), "utf8");
const NOW = new Date("2026-10-25T00:00:00+09:00");
const rec = (over = {}) => ({ legacy_id: "1", title: "가상 제목", category: "S1N2", author_name: "가상필자", published_at: "2026-10-01T09:00:00+09:00", body_text: "첫 문단입니다.\n\n둘째 문단입니다.", status: "published", ...over });
const doc = (articles) => ({ format: "ltr-legacy-articles", version: 1, source: { platform: "test" }, articles });

test("분류 대응표가 DB legacy_category_map 씨앗과 같다 (이름·분야·하위 분야·태그·재분류)", () => {
  const sql = readFileSync(resolve(here, "../../packages/db/supabase/migrations/20261018000002_categories_settings.sql"), "utf8");
  const block = sql.slice(sql.indexOf("insert into public.legacy_category_map"));
  const rows = [...block.matchAll(/\('([^']+)',\s+'(\w+)',\s+(null|'[\w-]+'),\s+(null|'[^']+'),\s+(true|false),/g)].map((m) => ({ name: m[1], section: m[2], category: m[3] === "null" ? null : m[3].slice(1, -1), tag: m[4] === "null" ? null : m[4].slice(1, -1), re: m[5] === "true" }));
  assert.equal(rows.length, 8);
  for (const r of rows) {
    const c = LEGACY_CATEGORIES.find((x) => x.dbName === r.name);
    assert.ok(c, `${r.name} 대응 없음`);
    assert.deepEqual({ section: c.section, category: c.category, tag: c.tag, re: c.needsReclassify }, { section: r.section, category: r.category, tag: r.tag, re: r.re }, r.name);
  }
});

test("분류 찾기: 코드·현 사이트 표기·공백 차이를 같은 분류로 보고 모르는 이름은 null", () => {
  assert.equal(findCategory("S1N5").dbName, "부동산 정보");
  assert.equal(findCategory("교육, 포럼, 행사").code, "S1N7");
  assert.equal(findCategory("판례소개").code, "S1N3");
  assert.equal(findCategory("상담 사례").code, "S1N8");
  assert.equal(findCategory("연예"), null);
  assert.equal(findCategory(""), null);
});

test("옛 주소 정규형: 호스트·쪽 쿼리를 떼고 앞 0을 없애며, 잘못된 번호는 null", () => {
  assert.equal(normalizeLegacyUrl("http://www.localtaxresearch.com/news/articleView.html?idxno=0123&sc_section_code=S1N1"), "/news/articleView.html?idxno=123");
  assert.equal(normalizeLegacyUrl("https://localtaxresearch.com/news/articleList.html?sc_section_code=s1n4&view_type=sm&page=3"), "/news/articleList.html?sc_section_code=S1N4");
  assert.equal(normalizeLegacyUrl("/news/articleList.html?view_type=sm"), "/news/articleList.html");
  assert.equal(normalizeLegacyUrl("/com/privacy.html/"), "/com/privacy.html");
  assert.equal(normalizeLegacyUrl("/?p=45"), "/?p=45");
  assert.equal(normalizeLegacyUrl("/news/articleView.html?idxno=abc"), null);
  assert.equal(normalizeLegacyUrl("/news/articleView.html"), null);
  assert.equal(articleIdOf("/news/articleView.html?idxno=77"), "77");
});

test("검증: 정상 기사는 통과하고 비공개·삭제는 사유와 함께 제외로 센다", () => {
  const v = validateDocument(doc([rec(), rec({ legacy_id: "2", status: "deleted" }), rec({ legacy_id: "3", status: "hidden", excluded_reason: "필자 요청" })]), { now: NOW });
  assert.deepEqual(v.errors, []);
  assert.equal(v.records.length, 1);
  assert.deepEqual(v.excluded.map((e) => [e.legacy_id, e.status, e.reason]), [["2", "deleted", "현 사이트에서 삭제된 기사"], ["3", "hidden", "필자 요청"]]);
});

test("검증: 필수 칸·중복·날짜·분류·이미지·slug 오류를 모두 잡는다", () => {
  const v = validateDocument(doc([
    rec({ legacy_id: "10", title: "  " }),
    rec({ legacy_id: "11" }),
    rec({ legacy_id: "11", title: "중복 번호" }),
    rec({ legacy_id: "12", published_at: "2026-13-40" }),
    rec({ legacy_id: "13", published_at: "2027-01-01T00:00:00+09:00" }),
    rec({ legacy_id: "14", published_at: "1999-12-31T00:00:00+09:00" }),
    rec({ legacy_id: "15", category: "연예" }),
    rec({ legacy_id: "16", images: ["ftp://x.example.test/a.png"] }),
    rec({ legacy_id: "17", slug: "popular" }),
    rec({ legacy_id: "18", slug: "a b" }),
    rec({ legacy_id: "19", slug: "same" }),
    rec({ legacy_id: "20", slug: "same" }),
    rec({ legacy_id: "21", body_text: "", body_html: "" }),
    rec({ legacy_id: "x1" }),
    rec({ legacy_id: "22", status: "weird" }),
    rec({ legacy_id: "23", legacy_url: "/news/articleView.html?idxno=11" }),
  ]), { now: NOW });
  const key = (e) => `${e.id}:${e.field}`;
  const got = new Set(v.errors.map(key));
  for (const k of ["10:title", "11:legacy_id", "12:published_at", "13:published_at", "14:published_at", "15:category", "16:images[0]", "17:slug", "18:slug", "20:slug", "21:body", "x1:legacy_id", "22:status", "23:legacy_url"]) assert.ok(got.has(k), `${k} 없음 — ${[...got]}`);
  assert.deepEqual(v.records.map((r) => r.rec.legacy_id), ["11", "19"]); // 오류 없는 기사: 11(처음 것)·19(slug 처음 것)
});

test("검증: 경고(필자 없음·수정일 역전·주민번호/전화 모양·이미지 반복)는 막지 않고 알린다", () => {
  const v = validateDocument(doc([rec({ author_name: "", updated_at: "2026-09-01T00:00:00+09:00", body_text: "문의 010-1234-5678 / 800101-1234567", images: ["https://i.example.test/a.png", "https://i.example.test/a.png"] })]), { now: NOW });
  assert.equal(v.errors.length, 0);
  const msgs = v.warnings.map((w) => w.message).join("|");
  for (const part of ["필자 이름이 없습니다", "수정일이 발행일보다", "주민등록번호", "전화번호", "같은 이미지 주소 반복"]) assert.match(msgs, new RegExp(part));
});

test("변환: HTML 본문을 문단·표·이미지 블록으로 바꾸고 엔티티를 풀며 스크립트는 버린다", () => {
  const { blocks, images } = htmlToBlocks('<script>x()</script><p>가&nbsp;나 &amp; 다</p><p>둘째<br>셋째</p><img src="https://i.example.test/a.png" alt="그림"><table><caption>표</caption><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>', "5");
  assert.deepEqual(blocks.map((b) => b.type), ["paragraph", "paragraph", "paragraph", "image", "table"]);
  assert.equal(blocks[0].text, "가 나 & 다");
  assert.deepEqual(blocks[3], { type: "image", mediaId: "legacy:5:1", alt: "그림", caption: "", rightsStatus: "unconfirmed" });
  assert.deepEqual(blocks[4].rows, [["a", "b"], ["1", "2"]]);
  assert.deepEqual(images, [{ url: "https://i.example.test/a.png", alt: "그림" }]);
});

test("변환: 이관 기사는 origin=legacy · content_type 비움 · 원래 발행일 · 분야 대응 · 이미지 권리 미확인", () => {
  const v = validateDocument(doc([rec({ legacy_id: "7", category: "S1N5", title: "가상시 부동산 소식", body_html: '<p>가상구 안내</p><img src="https://i.example.test/p.png">' })]), { now: NOW });
  const draft = toArticle(v.records[0]);
  assert.equal(draft.article.status, "draft");
  assert.equal(draft.article.editorial_status, "pending");
  assert.equal(draft.article.origin, "legacy");
  assert.equal(draft.article.content_type, null);
  assert.equal(draft.article.section, "realestate");
  assert.equal(draft.article.slug, "legacy-7");
  assert.equal(draft.article.first_published_at, "2026-10-01T09:00:00+09:00");
  assert.equal(draft.article.legacy_url, "/news/articleView.html?idxno=7");
  assert.equal(draft.sidecar.needs_reclassify, true);
  assert.equal(draft.sidecar.region_review, true);
  assert.ok(draft.article.body.filter((b) => b.type === "image").every((b) => b.rightsStatus === "unconfirmed"));
  assert.equal(toArticle(v.records[0], { status: "published" }).article.status, "published");
  assert.throws(() => toArticle(v.records[0], { status: "deleted" }));
  assert.equal(draft.content_hash, toArticle(v.records[0]).content_hash);
});

test("주소 매핑: 기사 301·제외 410/404·목록 8+1·정적 쪽, 연쇄·홈 이동·사유 없는 404를 검사가 잡는다", () => {
  const map = buildUrlMap({ migrated: [{ legacy_url: "/news/articleView.html?idxno=1", slug: "legacy-1" }], excluded: [{ legacy_url: "/news/articleView.html?idxno=2", status: "deleted", reason: "삭제" }] });
  assert.equal(map.find((r) => r.old_path.endsWith("idxno=1")).new_path, "/news/legacy-1");
  assert.equal(map.find((r) => r.old_path.endsWith("idxno=2")).status, 410);
  assert.equal(map.filter((r) => r.kind === "list").length, 9);
  assert.ok(map.filter((r) => r.kind === "list").every((r) => r.new_path !== "/" && r.new_path));
  const problems = checkUrlMap(map);
  assert.ok(problems.every((p) => p.problem === "새 주소 미결정"), JSON.stringify(problems)); // 정적 쪽 미결정만 남는다
  const bad = checkUrlMap([
    { old_path: "/a", new_path: "/b", status: 301, origin: "legacy_site" },
    { old_path: "/b", new_path: "/c", status: 301, origin: "legacy_site" },
    { old_path: "/news/articleView.html?idxno=9", new_path: "/", status: 301, origin: "legacy_site" },
    { old_path: "/x", new_path: null, status: 404, reason: "", origin: "legacy_site" },
    { old_path: "/x", new_path: "/y", status: 301, origin: "legacy_site" },
  ]).map((p) => p.problem);
  for (const part of ["연쇄", "새 홈", "사유가 없습니다", "중복"]) assert.ok(bad.some((p) => p.includes(part)), part);
});

test("redirects SQL: 따옴표를 막고 같은 입력이면 같은 글자, on conflict로 다시 돌려도 안전", () => {
  const rows = [{ old_path: "/a?x='1'", new_path: "/n", status: 301, reason: null, origin: "legacy_site" }, { old_path: "/g", new_path: null, status: 410, reason: "사유 'x'", origin: "legacy_site" }];
  const sql = renderRedirectsSql(rows);
  assert.match(sql, /\('\/a\?x=''1''', '\/n', 301, null, 'legacy_site'\)/);
  assert.match(sql, /\('\/g', null, 410, '사유 ''x''', 'legacy_site'\)/);
  assert.match(sql, /on conflict \(old_path\) do update/);
  assert.equal(sql, renderRedirectsSql(rows));
});

test("ndsoft 어댑터: 기사 쪽 저장본에서 제목·필자·분류·발행/수정일·본문·이미지를 읽는다", () => {
  const d = adaptNdsoft([{ id: "9001", html: fx("ndsoft-article.html") }]);
  const a = d.articles[0];
  assert.equal(a.legacy_id, "9001");
  assert.equal(a.title, "가상시, 종이 없는 지방세 전자고지 & 확대");
  assert.equal(a.author_name, "가상기자 기자");
  assert.equal(a.category_code, "S1N1");
  assert.equal(a.published_at, "2026-10-13T10:09:10+09:00");
  assert.equal(a.updated_at, "2026-10-14T09:30:00+09:00");
  assert.equal(a.legacy_url, "/news/articleView.html?idxno=9001");
  assert.match(a.body_html, /전자고지를 확대/);
  assert.doesNotMatch(a.body_html, /itemprop/);
  const out = runDryRun(d, { now: NOW });
  assert.equal(out.ok, true, JSON.stringify(out.errors));
  const types = out.items[0].article.body.map((b) => b.type);
  assert.deepEqual(types, ["paragraph", "paragraph", "image", "table"]);
  assert.equal(out.items[0].article.body[1].text, "고지서 ‘종이 없는’ 발송은 11월부터 시작한다.");
});

test("ndsoft 사이트맵·RSS 모양: 기사 번호와 발행일만 뽑고 번호 없는 주소는 건너뛴다", () => {
  const sm = parseSitemap('<urlset><url><loc>http://www.example.test/news/articleView.html?idxno=5</loc><news:news><news:publication_date>2026-10-20T17:23:35+09:00</news:publication_date><news:title>가상 &amp; 제목</news:title></news:news></url><url><loc>http://www.example.test/</loc></url></urlset>');
  assert.deepEqual(sm, [{ legacy_id: "5", published_at: "2026-10-20T17:23:35+09:00", title: "가상 & 제목" }]);
  const rss = parseRss("<rss><channel><item><title>가상</title><link>http://www.example.test/news/articleView.html?idxno=6</link><pubDate>2026-10-20 13:07:21</pubDate></item></channel></rss>");
  assert.deepEqual(rss, [{ legacy_id: "6", title: "가상", published_at: "2026-10-20T13:07:21+09:00" }]);
});

test("WXR 어댑터: 글만 읽고(첨부 제외) 초안은 hidden, 분류 맵을 쓰며, 같은 파이프라인을 통과한다", () => {
  const d = adaptWxr(fx("wxr-sample.xml"), { categoryMap: {} });
  assert.deepEqual(d.articles.map((a) => [a.legacy_id, a.status, a.slug ?? null]), [["101", "published", "virtual-amendment"], ["102", "hidden", null]]);
  assert.equal(d.articles[0].published_at, "2026-10-01T00:00:00Z");
  assert.equal(d.articles[0].legacy_url, "/2026/10/virtual-amendment");
  const out = runDryRun(d, { now: NOW });
  assert.equal(out.ok, true, JSON.stringify(out.errors));
  assert.equal(out.items[0].article.slug, "virtual-amendment");
  assert.equal(out.items[0].article.section, "tax");
  assert.deepEqual(out.excluded.map((e) => [e.legacy_id, e.status]), [["102", "hidden"]]);
  assert.equal(out.report.counts.reconciled, true);
  // 분류 맵 없이 모르는 워드프레스 분류는 미배정 오류
  const unknown = adaptWxr(fx("wxr-sample.xml").replaceAll("법령개정", "가상분류"));
  assert.ok(runDryRun(unknown, { now: NOW }).errors.some((e) => e.field === "category"));
  const mapped = adaptWxr(fx("wxr-sample.xml").replaceAll("법령개정", "가상분류"), { categoryMap: { 가상분류: "S1N4" } });
  assert.equal(runDryRun(mapped, { now: NOW }).ok, true);
});

test("dry-run 보고: 이관+제외=원본, 분야별 수, 표본, 오류가 있으면 FAIL이고 변환 결과가 없다", () => {
  const articles = Array.from({ length: 12 }, (_, i) => rec({ legacy_id: String(i + 1), category: ["S1N1", "S1N2", "S1N5"][i % 3] }));
  const ok = runDryRun(doc([...articles, rec({ legacy_id: "50", status: "deleted" })]), { now: NOW });
  assert.equal(ok.report.result, "PASS");
  assert.equal(ok.report.counts.source, 13);
  assert.equal(ok.report.counts.migrated + ok.report.counts.excluded, 13);
  assert.deepEqual(ok.report.counts.by_section, { tax: 4, realestate: 4, finance: 0, local: 4 });
  assert.equal(ok.report.counts.reclassify_queue, 4);
  assert.equal(ok.report.sample.length, 12);
  const fail = runDryRun(doc([...articles, rec({ legacy_id: "51", category: "연예" })]), { now: NOW });
  assert.equal(fail.ok, false);
  assert.equal(fail.report.result, "FAIL");
  assert.equal(fail.items.length, 0);
  assert.equal(fail.report.counts.reconciled, false);
});

test("CLI 리허설 2회: 같은 입력이면 산출물 해시가 같고, 오류 입력은 종료 코드 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "ltr-mig-"));
  const input = join(dir, "in.json");
  const articles = Array.from({ length: 5 }, (_, i) => rec({ legacy_id: String(i + 1) }));
  const write = (p, v) => import("node:fs").then((fs) => fs.writeFileSync(p, JSON.stringify(v)));
  return Promise.all([write(input, doc(articles)), write(join(dir, "bad.json"), doc([rec({ category: "연예" })]))]).then(() => {
    const code = main(["rehearse", "--input", input, "--out", join(dir, "out"), "--now", "2026-10-25T00:00:00+09:00"]);
    assert.equal(code, 0);
    const result = JSON.parse(readFileSync(join(dir, "out", "rehearsal.json"), "utf8"));
    assert.equal(result.identical, true);
    assert.ok(existsSync(join(dir, "out", "run2", "redirects.sql")));
    assert.deepEqual(readdirSync(join(dir, "out", "run1")).sort(), ["articles.json", "images.txt", "redirects.json", "redirects.sql", "report.json", "report.md"]);
    assert.equal(main(["dry-run", "--input", join(dir, "bad.json"), "--out", join(dir, "bad-out"), "--now", "2026-10-25T00:00:00+09:00"]), 1);
    assert.throws(() => main(["dry-run", "--out", dir]), /--input/);
  });
});
