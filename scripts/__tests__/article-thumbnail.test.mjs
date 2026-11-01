// 기사 썸네일 도구(scripts/media/article-thumbnail.mjs) — 순수 함수만 시험한다(네트워크·브라우저 없음).
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  apiErrorMessage,
  apiSizeFor,
  buildPrompt,
  buildRequest,
  checkFocus,
  checkSlug,
  dateFolder,
  extractImage,
  imageType,
  parseArgs,
  parseSizes,
  parseTitle,
  pickBase,
  pickBodyBase,
  seoulDate,
  thumbHtml,
  titleWarnings,
} from "../media/article-thumbnail.mjs";

test("인자 — 값 옵션·깃발 옵션, 모르는 옵션과 빠진 값은 오류", () => {
  const o = parseArgs(["--slug", "일시적2주택", "--title", "a|b", "--dry-run"]);
  assert.equal(o.slug, "일시적2주택");
  assert.equal(o.title, "a|b");
  assert.ok(o.flags.has("dry-run"));
  assert.throws(() => parseArgs(["--nope", "x"]), /모르는 옵션/);
  assert.throws(() => parseArgs(["--slug"]), /값이 없습니다/);
  assert.throws(() => parseArgs(["--slug", "--dry-run"]), /값이 없습니다/);
  assert.throws(() => parseArgs(["slug"]), /알 수 없는 인자/);
});

test("제목 — | 또는 줄바꿈으로 1~2줄, 비거나 3줄이면 오류", () => {
  assert.deepEqual(parseTitle("조정지역 일시적 2주택|처분기한 3년→2년"), ["조정지역 일시적 2주택", "처분기한 3년→2년"]);
  assert.deepEqual(parseTitle("한 줄 제목"), ["한 줄 제목"]);
  assert.deepEqual(parseTitle("가\\n나"), ["가", "나"]);
  assert.deepEqual(parseTitle(" 가 | 나 "), ["가", "나"]);
  assert.throws(() => parseTitle(""), /비었습니다/);
  assert.throws(() => parseTitle("가|나|다"), /두 줄까지/);
});

test("제목 길이 경고 — 공백 빼고 15자 초과만", () => {
  assert.equal(titleWarnings(["조정지역 일시적 2주택"]).length, 0);
  assert.equal(titleWarnings(["가나다라마바사아자차카타파하가나"]).length, 1);
});

test("크기 — 기본 1200x630, 쉼표 여러 개, 형식 오류", () => {
  assert.deepEqual(parseSizes(), [{ w: 1200, h: 630 }]);
  assert.deepEqual(parseSizes("1200x630, 1280x720"), [{ w: 1200, h: 630 }, { w: 1280, h: 720 }]);
  assert.throws(() => parseSizes("1200*630"), /형식/);
});

test("주제·초점 — 경로 문자와 CSS 주입을 막는다", () => {
  assert.equal(checkSlug(" 생애최초 "), "생애최초");
  assert.throws(() => checkSlug(""), /필요합니다/);
  assert.throws(() => checkSlug("../x"), /쓸 수 없는/);
  assert.throws(() => checkSlug("a/b"), /쓸 수 없는/);
  assert.equal(checkFocus("70%"), "70%");
  assert.throws(() => checkFocus("center;}body{"), /focus/);
});

test("날짜 폴더 — YYYYMMDD → YYYY_MM_DD", () => {
  assert.equal(dateFolder("20261101"), "2026_11_01");
  assert.throws(() => dateFolder("2026-11-01"), /YYYYMMDD/);
});

test("날짜 — 서울 시간 기준", () => {
  assert.equal(seoulDate(new Date("2026-10-31T16:00:00Z")), "20261101");
  assert.equal(seoulDate(new Date("2026-10-31T14:59:00Z")), "20261031");
});

test("생성 크기 기본값 — 모델별 가로형", () => {
  assert.equal(apiSizeFor("gpt-image-2"), "1536x1024");
  assert.equal(apiSizeFor("gpt-image-1"), "1536x1024");
  assert.equal(apiSizeFor("dall-e-3"), "1792x1024");
  assert.equal(apiSizeFor(""), "1536x1024");
});

test("프롬프트 — 장면을 담고 글자·인물·실재 건물 금지를 항상 붙인다", () => {
  const p = buildPrompt("서울 도심 아파트 단지");
  assert.match(p, /서울 도심 아파트 단지/);
  assert.match(p, /any text, letters, numbers/);
  assert.match(p, /identifiable people/);
  assert.match(p, /recognizable specific real buildings/);
  assert.throws(() => buildPrompt("  "), /비었습니다/);
});

test("본문 이미지 — 깃발 인자, 균형 구도 프롬프트, 이름 _v2", () => {
  const o = parseArgs(["--body", "--slug", "ai1_이사거실", "--scene", "s", "--width", "1280"]);
  assert.ok(o.flags.has("body"));
  assert.equal(o.width, "1280");
  const p = buildPrompt("이사 상자가 놓인 거실", { body: true });
  assert.match(p, /inside a Korean news column/);
  assert.match(p, /balanced framing/);
  assert.doesNotMatch(p, /headline will be placed/);
  assert.match(p, /any text, letters, numbers/);
  assert.match(buildPrompt("x"), /headline will be placed/);
  const out = path.resolve("/tmp/out");
  const have = new Set([path.join(out, "ai1.png")]);
  assert.equal(pickBodyBase({ out, slug: "ai1", exists: () => false }), "ai1");
  assert.equal(pickBodyBase({ out, slug: "ai1", exists: (p2) => have.has(p2) }), "ai1_v2");
});

test("요청 본문 — 키를 담지 않고, response_format은 dall-e만", () => {
  const g = buildRequest({ model: "gpt-image-2", prompt: "p", apiSize: "1536x1024", quality: "medium" });
  assert.deepEqual(g, { model: "gpt-image-2", prompt: "p", size: "1536x1024", n: 1, quality: "medium" });
  const d = buildRequest({ model: "dall-e-3", prompt: "p", apiSize: "1792x1024" });
  assert.equal(d.response_format, "b64_json");
  assert.equal("quality" in d, false);
  assert.doesNotMatch(JSON.stringify(g), /sk-|Bearer/);
});

test("응답 해석 — b64_json·url·사용량, 그림이 없으면 오류", () => {
  assert.deepEqual(extractImage({ data: [{ b64_json: "AAA" }], usage: { total_tokens: 3 } }), { b64: "AAA", url: null, revisedPrompt: null, usage: { total_tokens: 3 } });
  assert.equal(extractImage({ data: [{ url: "https://x/y.png", revised_prompt: "r" }] }).revisedPrompt, "r");
  assert.throws(() => extractImage({ data: [] }), /그림이 없습니다/);
});

test("오류 메시지 — API 메시지와 상태별 안내", () => {
  const m = apiErrorMessage(401, JSON.stringify({ error: { message: "Incorrect API key provided" } }));
  assert.match(m, /HTTP 401/);
  assert.match(m, /Incorrect API key/);
  assert.match(m, /OPENAI_API_KEY를 확인/);
  assert.match(apiErrorMessage(500, "oops"), /oops/);
});

test("그림 형식 판별", () => {
  assert.equal(imageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])).ext, "png");
  assert.equal(imageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])).ext, "jpg");
  assert.equal(imageType(Buffer.from("RIFF0000WEBPVP8 ", "ascii")).ext, "webp");
  assert.throws(() => imageType(Buffer.from("hello world!!")), /아닙니다/);
});

test("파일 이름 바탕 — 새 배경은 덮어쓰지 않고 _v2, 기존 배경은 그 바탕 그대로", () => {
  const out = path.resolve("/tmp/out");
  const none = () => false;
  assert.equal(pickBase({ out, slug: "s", date: "20261103", exists: none }), "s_썸네일_20261103");
  const have = new Set([path.join(out, "s_썸네일_20261103_bg.png"), path.join(out, "s_썸네일_20261103_v2_bg.png")]);
  assert.equal(pickBase({ out, slug: "s", date: "20261103", exists: (p) => have.has(p) }), "s_썸네일_20261103_v3");
  assert.equal(pickBase({ out, slug: "s", date: "20261103", bgPath: path.join(out, "s_썸네일_20261103_v2_bg.png") }), "s_썸네일_20261103_v2");
  assert.equal(pickBase({ out, slug: "s", date: "20261103", bgPath: "/elsewhere/photo.jpg" }), "s_썸네일_20261103");
});

test("HTML — 글자 이스케이프, 한 줄 제목은 강조 줄, 출처 표기", () => {
  const h = thumbHtml({ bgDataUri: "data:image/png;base64,AA", lines: ["<b>위</b>", "아래"], label: "법령개정", w: 1200, h: 630 });
  assert.match(h, /&lt;b&gt;위&lt;\/b&gt;/);
  assert.match(h, /class="l2">아래/);
  assert.match(h, /이미지: AI 생성/);
  assert.match(h, /월간 지방세연구/);
  assert.match(h, /width: 1200px; height: 630px/);
  const one = thumbHtml({ bgDataUri: "data:image/png;base64,AA", lines: ["한 줄"], w: 1280, h: 720, credit: "사진: 홍길동, CC BY" });
  assert.doesNotMatch(one, /class="l1"/);
  assert.match(one, /class="l2">한 줄/);
  assert.match(one, /사진: 홍길동, CC BY/);
  assert.throws(() => thumbHtml({ bgDataUri: "x", lines: ["a"], w: 10, h: 10, focus: "1;x" }), /focus/);
});
