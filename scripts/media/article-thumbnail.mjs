#!/usr/bin/env node
// 기사 썸네일 만들기 (2026-11-01) — OpenAI(ChatGPT) 이미지 API로 배경 그림을 만들고, 제목·섹션 라벨·매체 표기를 HTML로 얹어 PNG로 저장한다.
//   글자는 그림 생성 단계에서 넣지 않는다(이미지 모델은 한글 오탈자가 잦다) — Playwright로 HTML을 찍는다.
//   인스타그램 카드뉴스 표지에는 이 도구를 쓰지 않는다 — image/Instagram/[월]월_News_Briefing_*.png 원본을 쓴다 (image/Instagram/CLAUDE.md).
// 사용:
//   1) 사전 점검(무료):  node scripts/media/article-thumbnail.mjs --slug 일시적2주택 --title "조정지역 일시적 2주택|처분기한 3년→2년" --label 법령개정 --scene "늦가을 오후, 서울 도심 아파트 단지와 한강" --dry-run
//   2) 생성(유료):       같은 명령에서 --dry-run만 뺀다
//   3) 제목만 고치기:    --bg New_Article/thumbnails/일시적2주택_썸네일_20261103_bg.png 를 붙이면 API를 다시 부르지 않는다
//   4) 본문 이미지:      --body --slug ai1_이사거실 --scene "…" [--width 1280] — 글자를 얹지 않고 폭 1,280px로 줄여 New_Article/images에 저장
// 옵션:
//   --slug 주제(필수, 파일명 앞부분) · --title "첫 줄|둘째 줄"(필수, 둘째 줄이 큰 강조) · --label 섹션 라벨(선택)
//   --scene 배경 장면 설명(--bg가 없으면 필수) · --sizes 1200x630,1280x720 (기본 1200x630) · --date YYYYMMDD (기본 오늘, 서울 시간)
//   --model 모델 이름(기본 OPENAI_IMAGE_MODEL) · --api-size 생성 크기(기본: 모델에 맞춰) · --quality low|medium|high
//   --focus 배경 가로 위치(left·center·right·70% 등, 기본 center) · --credit 오른쪽 아래 출처 표기(기본 "이미지: AI 생성")
//   --out 저장 폴더(기본 New_Article/{YYYY_MM_DD}/thumbnails, 본문 이미지는 …/images — 날짜는 --date) · --bg 기존 배경 파일 · --dry-run · --help
//   --base-url API 주소(기본 https://api.openai.com — 시험용 가짜 서버를 가리킬 때만 쓴다)
// 환경변수(저장소 루트 .env.local에 사용자가 직접 넣는다): OPENAI_API_KEY [서버 전용 비밀] · OPENAI_IMAGE_MODEL [서버]
//   키 값은 화면·로그·ai_prompts.json 어디에도 남기지 않는다.
// 저장 규칙(2026-11-01): 기사 산출물은 New_Article/{YYYY_MM_DD}/ 날짜 폴더에 모은다 (image/Instagram/CLAUDE.md '저장 폴더 규칙').
// 결과(--out 폴더):
//   {slug}_썸네일_{date}_bg.png        배경 원본(글자 없음) — 다시 만들면 _v2, _v3로 붙는다(덮어쓰지 않는다)
//   {slug}_썸네일_{date}_{W}x{H}.png   썸네일 — 같은 배경으로 다시 찍으면 덮어쓴다
//   ai_prompts.json                    생성 기록 누적(모델·크기·프롬프트·사용량·파일명)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_BASE_URL = "https://api.openai.com";
/** 날짜 폴더 이름 — 20261101 → 2026_11_01 */
export function dateFolder(yyyymmdd) {
  const m = String(yyyymmdd ?? "").match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) throw new Error(`날짜는 YYYYMMDD입니다 (받은 값: ${yyyymmdd})`);
  return `${m[1]}_${m[2]}_${m[3]}`;
}
const defaultOut = (date) => `New_Article/${dateFolder(date)}/thumbnails`;
const defaultBodyOut = (date) => `New_Article/${dateFolder(date)}/images`;
const BRAND = "월간 지방세연구";
const SITE = "localtaxresearch.com";
const PRETENDARD_CSS = "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css";
const API_TIMEOUT_MS = 300_000;
const VALUE_OPTS = ["slug", "title", "label", "scene", "sizes", "date", "model", "api-size", "quality", "focus", "credit", "out", "bg", "base-url", "width"];
const FLAG_OPTS = ["dry-run", "help", "body"];

/** --이름 값 형식만 받는다. 모르는 옵션·빠진 값은 바로 오류 */
export function parseArgs(argv) {
  const opts = { flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`알 수 없는 인자: ${a}`);
    const name = a.slice(2);
    if (FLAG_OPTS.includes(name)) {
      opts.flags.add(name);
      continue;
    }
    if (!VALUE_OPTS.includes(name)) throw new Error(`모르는 옵션: --${name} (--help로 목록 확인)`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`--${name} 값이 없습니다`);
    opts[name] = v;
    i++;
  }
  return opts;
}

/** 제목 "첫 줄|둘째 줄" → 줄 배열(1~2줄). 줄바꿈 문자나 \n 글자도 나눔으로 본다 */
export function parseTitle(raw) {
  const lines = String(raw ?? "")
    .split(/\||\\n|\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!lines.length) throw new Error('--title이 비었습니다 (예: "조정지역 일시적 2주택|처분기한 3년→2년")');
  if (lines.length > 2) throw new Error("--title은 두 줄까지입니다 — 줄은 | 로 나눕니다");
  return lines;
}

/** 줄당 12자 안팎 권장 — 공백 빼고 15자를 넘으면 경고 */
export function titleWarnings(lines) {
  return lines
    .map((l) => ({ l, n: [...l.replace(/\s/g, "")].length }))
    .filter(({ n }) => n > 15)
    .map(({ l, n }) => `제목 줄이 깁니다(공백 빼고 ${n}자): "${l}" — 줄당 12자 안팎 권장`);
}

export function parseSizes(raw = "1200x630") {
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.match(/^(\d{3,4})x(\d{3,4})$/);
      if (!m) throw new Error(`--sizes 형식은 1200x630,1280x720 입니다 (받은 값: ${s})`);
      return { w: Number(m[1]), h: Number(m[2]) };
    });
}

/** 파일명에 쓸 주제 — 경로 문자·Windows 금지 문자를 막는다 */
export function checkSlug(slug) {
  const s = String(slug ?? "").trim();
  if (!s) throw new Error("--slug(주제, 파일명 앞부분)가 필요합니다 (예: 일시적2주택)");
  if (/[\\/:*?"<>|]|\.\./.test(s)) throw new Error(`--slug에 쓸 수 없는 문자가 있습니다: ${s}`);
  return s;
}

/** CSS에 그대로 들어가는 값이라 형식을 좁힌다 */
export function checkFocus(focus = "center") {
  if (!/^(left|center|right|\d{1,3}%)$/.test(focus)) throw new Error(`--focus는 left·center·right·0%~100% 중 하나입니다 (받은 값: ${focus})`);
  return focus;
}

export function seoulDate(now = new Date()) {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return ymd.replaceAll("-", "");
}

/** 생성 크기 기본값 — 가로형. 모델이 받지 않는 크기면 --api-size로 바꾼다 */
export function apiSizeFor(model) {
  const m = String(model ?? "").toLowerCase();
  if (m.startsWith("dall-e-3")) return "1792x1024";
  if (m.startsWith("dall-e-2")) return "1024x1024";
  return "1536x1024";
}

/** 그림 프롬프트 — 장면은 사용자가 정하고, 금지 사항(글자·인물·실재 건물·보도사진풍)은 항상 붙인다.
 *  body=false 썸네일 배경(왼쪽에 제목 자리) · body=true 본문 삽입 사진(균형 잡힌 구도) */
export function buildPrompt(scene, { body = false } = {}) {
  const s = String(scene ?? "").trim();
  if (!s) throw new Error("--scene(배경 장면 설명)이 비었습니다");
  return [
    body
      ? "Photorealistic editorial photograph placed inside a Korean news column about local taxes and real estate."
      : "Photorealistic editorial photograph used as the background of a Korean news article thumbnail about local taxes and real estate.",
    `Scene: ${s}`,
    body
      ? "Composition: wide landscape frame with a clear main subject and natural, balanced framing, like a magazine feature photo."
      : "Composition: wide landscape frame. Keep the left 45% calm and uncluttered (soft sky, plain wall, water or gentle bokeh) because a headline will be placed there; put the main subject on the right half.",
    "Look: natural daylight, soft contrast, slightly airy pastel color grading, realistic textures, no heavy filters or illustration style.",
    "Do not include: any text, letters, numbers, signs, logos, watermarks or UI; identifiable people or faces; recognizable specific real buildings, apartment brand names or landmarks; documents, bills, forms or screens with readable content; anything that looks like a news photo of a real event.",
  ].join("\n");
}

/** 이미지 생성 요청 본문. 키는 본문에 넣지 않는다(헤더로만) */
export function buildRequest({ model, prompt, apiSize, quality }) {
  const body = { model, prompt, size: apiSize, n: 1 };
  if (quality) body.quality = quality;
  if (/^dall-e/i.test(model)) body.response_format = "b64_json";
  return body;
}

/** 응답에서 그림 한 장 — b64_json 또는 url */
export function extractImage(json) {
  const d = json?.data?.[0];
  if (!d || (!d.b64_json && !d.url)) throw new Error("API 응답에 그림이 없습니다");
  return { b64: d.b64_json ?? null, url: d.url ?? null, revisedPrompt: d.revised_prompt ?? null, usage: json.usage ?? null };
}

/** 실패 응답 → 사람이 읽을 메시지 (요청 헤더·키는 담지 않는다) */
export function apiErrorMessage(status, text) {
  let msg = String(text ?? "").slice(0, 400);
  try {
    msg = JSON.parse(text)?.error?.message ?? msg;
  } catch {
    // JSON이 아니면 본문 앞부분을 그대로 쓴다
  }
  const hint =
    status === 401 ? " — .env.local의 OPENAI_API_KEY를 확인하세요"
    : status === 403 ? " — 계정·조직 권한(모델 사용 승인)을 OpenAI 대시보드에서 확인하세요"
    : status === 429 ? " — 사용 한도·잔액을 확인하거나 잠시 뒤 다시 실행하세요"
    : status === 400 ? " — 모델이 받지 않는 크기·품질 값이거나, 장면 설명이 안전 정책에 걸렸을 수 있습니다"
    : "";
  return `OpenAI 이미지 API 오류 (HTTP ${status}): ${msg}${hint}`;
}

/** 그림 형식 — 앞 바이트로 판별 */
export function imageType(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { mime: "image/png", ext: "png" };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return { mime: "image/jpeg", ext: "jpg" };
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  throw new Error("PNG·JPEG·WEBP 그림이 아닙니다");
}

/** 파일 이름 바탕 — 새 배경이면 이미 있는 바탕 뒤에 _v2, _v3. 기존 배경(…_bg.확장자)을 쓰면 그 바탕을 그대로 */
export function pickBase({ out, slug, date, bgPath, exists = fs.existsSync }) {
  if (bgPath) {
    const m = path.basename(bgPath).match(/^(.*)_bg\.(png|jpe?g|webp)$/i);
    if (m && path.resolve(path.dirname(bgPath)) === path.resolve(out)) return m[1];
    return `${slug}_썸네일_${date}`;
  }
  const taken = (b) => ["png", "jpg", "webp"].some((e) => exists(path.join(out, `${b}_bg.${e}`)));
  let base = `${slug}_썸네일_${date}`;
  for (let v = 2; taken(base); v++) base = `${slug}_썸네일_${date}_v${v}`;
  return base;
}

/** 본문 이미지 파일 바탕 — 이미 있으면 _v2, _v3 (덮어쓰지 않는다) */
export function pickBodyBase({ out, slug, exists = fs.existsSync }) {
  const taken = (b) => exists(path.join(out, `${b}.png`)) || exists(path.join(out, `${b}_원본.png`));
  let base = slug;
  for (let v = 2; taken(base); v++) base = `${slug}_v${v}`;
  return base;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** 썸네일 HTML — 크기는 높이 630 기준 단위(--u)로 비례. 줄이 하나면 강조 줄로만 쓴다 */
export function thumbHtml({ bgDataUri, lines, label, w, h, focus = "center", credit = "이미지: AI 생성" }) {
  const u = (h / 630).toFixed(4);
  const [l1, l2] = lines.length === 2 ? lines : [null, lines[0]];
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<link rel="stylesheet" href="${PRETENDARD_CSS}">
<style>
  :root { --u: ${u}px; --ink: #2b3445; --accent: #1B4DA0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; width: ${w}px; height: ${h}px; overflow: hidden; }
  body {
    position: relative; background: #eef3fb url("${bgDataUri}") ${checkFocus(focus)} center / cover no-repeat;
    font-family: Pretendard, "Pretendard Variable", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans CJK KR", "Noto Sans KR", sans-serif;
    -webkit-font-smoothing: antialiased; word-break: keep-all;
  }
  .veil { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(247,249,253,.95) 0%, rgba(247,249,253,.88) 36%, rgba(247,249,253,.45) 56%, rgba(247,249,253,0) 70%); }
  .copy { position: absolute; left: calc(64 * var(--u)); top: 0; bottom: calc(70 * var(--u)); width: ${Math.round(w * 0.58)}px; display: flex; flex-direction: column; justify-content: center; }
  .label { align-self: flex-start; margin-bottom: calc(24 * var(--u)); padding: calc(7 * var(--u)) calc(18 * var(--u)); border-radius: 999px; background: rgba(27,77,160,.10); border: calc(1.5 * var(--u)) solid rgba(27,77,160,.35); color: var(--accent); font-weight: 700; font-size: calc(22 * var(--u)); }
  .l1 { color: var(--ink); font-weight: 700; font-size: calc(44 * var(--u)); line-height: 1.25; letter-spacing: -0.02em; }
  .l2 { margin-top: calc(6 * var(--u)); color: var(--accent); font-weight: 800; font-size: calc(64 * var(--u)); line-height: 1.18; letter-spacing: -0.03em; }
  .brand { position: absolute; left: calc(64 * var(--u)); bottom: calc(40 * var(--u)); color: var(--ink); font-weight: 800; font-size: calc(22 * var(--u)); }
  .brand span { margin-left: calc(10 * var(--u)); color: #5b6577; font-weight: 500; font-size: calc(18 * var(--u)); }
  .credit { position: absolute; right: calc(16 * var(--u)); bottom: calc(12 * var(--u)); color: rgba(255,255,255,.95); font-size: calc(14 * var(--u)); text-shadow: 0 1px 3px rgba(0,0,0,.55); }
</style></head>
<body>
  <div class="veil"></div>
  <div class="copy">
    ${label ? `<div class="label">${esc(label)}</div>` : ""}
    ${l1 ? `<div class="l1">${esc(l1)}</div>` : ""}
    <div class="l2">${esc(l2)}</div>
  </div>
  <div class="brand">${BRAND}<span>${SITE}</span></div>
  ${credit ? `<div class="credit">${esc(credit)}</div>` : ""}
</body></html>`;
}

/** 생성 기록 누적. 기존 파일이 깨져 있으면 덮지 않고 새 파일에 남긴다 */
export function appendLog(logPath, entry) {
  let list = [];
  let target = logPath;
  if (fs.existsSync(logPath)) {
    try {
      const j = JSON.parse(fs.readFileSync(logPath, "utf8"));
      if (!Array.isArray(j)) throw new Error("배열이 아님");
      list = j;
    } catch {
      target = logPath.replace(/\.json$/, `_${Date.now()}.json`);
      console.warn(`경고 — ${path.basename(logPath)}을 읽지 못해 ${path.basename(target)}에 따로 남깁니다`);
    }
  }
  list.push(entry);
  fs.writeFileSync(target, `${JSON.stringify(list, null, 2)}\n`, "utf8");
  return target;
}

async function launchBrowser() {
  const { chromium } = await import("playwright");
  let last;
  for (const opt of [{}, { channel: "msedge" }, { channel: "chrome" }]) {
    try {
      return await chromium.launch(opt);
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`브라우저를 열지 못했습니다 — pnpm exec playwright install chromium 후 다시 실행하세요 (${String(last?.message ?? last).split("\n")[0]})`);
}

/** 배경 + 글자 → 크기별 PNG */
export async function renderThumbs({ bgPath, lines, label, focus, credit, targets }) {
  const buf = fs.readFileSync(bgPath);
  const { mime } = imageType(buf);
  const bgDataUri = `data:${mime};base64,${buf.toString("base64")}`;
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    for (const t of targets) {
      await page.setViewportSize({ width: t.w, height: t.h });
      // 웹 글꼴(Pretendard)을 못 받으면 맑은 고딕 등으로 찍는다 — 시간 초과는 무시하고 진행
      await page.setContent(thumbHtml({ bgDataUri, lines, label, w: t.w, h: t.h, focus, credit }), { waitUntil: "load", timeout: 30_000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: t.file, type: "png", clip: { x: 0, y: 0, width: t.w, height: t.h } });
    }
  } finally {
    await browser.close();
  }
}

/** 본문 이미지 — 원본을 폭 width로 줄인 PNG (비율 유지) */
export async function renderResized({ srcPath, width, file }) {
  const buf = fs.readFileSync(srcPath);
  const { mime } = imageType(buf);
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width, height: 100 } });
    await page.setContent(`<!doctype html><html><body style="margin:0"><img id="i" style="display:block;width:${width}px;height:auto" src="data:${mime};base64,${buf.toString("base64")}"></body></html>`, { waitUntil: "load" });
    const h = await page.evaluate(() => Math.round(document.getElementById("i").getBoundingClientRect().height));
    await page.setViewportSize({ width, height: h });
    await page.screenshot({ path: file, type: "png", clip: { x: 0, y: 0, width, height: h } });
    return { width, height: h };
  } finally {
    await browser.close();
  }
}

const rel = (p) => path.relative(root, p).split(path.sep).join("/");

const USAGE = `사용: node scripts/media/article-thumbnail.mjs --slug 주제 --title "첫 줄|둘째 줄" --scene "배경 장면" [--label 섹션] [--sizes 1200x630,1280x720] [--dry-run]
       제목만 다시 찍기: --bg New_Article/thumbnails/주제_썸네일_YYYYMMDD_bg.png (API를 부르지 않는다)
       본문 이미지:     --body --slug ai1_설명 --scene "장면" [--width 1280] [--out New_Article/images]
       자세한 옵션은 파일 맨 위 주석을 본다.`;

/** OpenAI 이미지 API 한 번 호출 → 그림 바이트 (키는 헤더로만 보낸다) */
async function generateImage({ o, model, prompt, apiSize, quality }) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY가 없습니다 — 저장소 루트 .env.local에 OPENAI_API_KEY=... 를 직접 넣어 주세요 (채팅·코드에 붙여 넣지 않습니다)");
  if (!model) throw new Error("모델 이름이 없습니다 — .env.local에 OPENAI_IMAGE_MODEL=... 를 넣거나 --model로 지정하세요");
  const baseUrl = (o["base-url"] ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  console.log(`그림 생성 요청 — ${model} · ${apiSize}${quality ? ` · ${quality}` : ""} (보통 30초~2분)`);
  const res = await fetch(`${baseUrl}/v1/images/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify(buildRequest({ model, prompt, apiSize, quality })),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(apiErrorMessage(res.status, text));
  const gen = extractImage(JSON.parse(text));
  if (gen.b64) return { buf: Buffer.from(gen.b64, "base64"), gen };
  const r = await fetch(gen.url, { signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`생성된 그림을 내려받지 못했습니다 (HTTP ${r.status})`);
  return { buf: Buffer.from(await r.arrayBuffer()), gen };
}

/** 본문 이미지 모드 — 글자를 얹지 않고 원본과 폭 축소본을 저장한다 */
async function mainBody(o, slug) {
  if (!o.scene) throw new Error("--body에는 --scene(장면 설명)이 필요합니다");
  const width = Number(o.width ?? 1280);
  if (!(width >= 320 && width <= 4000)) throw new Error(`--width는 320~4000입니다 (받은 값: ${o.width})`);
  const date = o.date ?? seoulDate();
  const out = path.resolve(root, o.out ?? defaultBodyOut(date));
  const model = o.model ?? process.env.OPENAI_IMAGE_MODEL ?? "";
  const apiSize = o["api-size"] ?? apiSizeFor(model);
  const quality = o.quality;
  if (quality && !/^(low|medium|high|auto|standard|hd)$/.test(quality)) throw new Error(`--quality 값을 알 수 없습니다: ${quality}`);
  const prompt = buildPrompt(o.scene, { body: true });
  const base = pickBodyBase({ out, slug });
  const original = path.join(out, `${base}_원본.png`);
  const file = path.join(out, `${base}.png`);

  if (o.flags.has("dry-run")) {
    console.log("사전 점검 — API를 부르지 않습니다 (요금 없음)");
    console.log(" 방식      본문 이미지 생성 (OpenAI 이미지 API, 유료, 글자 없음)");
    console.log(` 모델      ${model || "(없음 — .env.local OPENAI_IMAGE_MODEL 또는 --model)"}`);
    console.log(` API 키    ${process.env.OPENAI_API_KEY ? "있음" : "없음 — .env.local에 OPENAI_API_KEY를 넣어야 생성됩니다"}`);
    console.log(` 생성 크기 ${apiSize}${quality ? ` · 품질 ${quality}` : ""} → 폭 ${width}px`);
    console.log(` 저장      ${rel(file)} (원본 ${rel(original)})`);
    console.log(`\n프롬프트\n${prompt}`);
    console.log("\n실제 생성은 같은 명령에서 --dry-run을 빼고 실행합니다.");
    return;
  }

  fs.mkdirSync(out, { recursive: true });
  const { buf, gen } = await generateImage({ o, model, prompt, apiSize, quality });
  const originalPath = original.replace(/\.png$/, `.${imageType(buf).ext}`);
  fs.writeFileSync(originalPath, buf);
  console.log(`원본 저장 ${rel(originalPath)} (${(buf.length / 1024).toFixed(0)}KB)`);
  const log = appendLog(path.join(out, "ai_prompts.json"), {
    createdAt: new Date().toISOString(),
    kind: "article-image",
    slug: base,
    source: "openai",
    model,
    apiSize,
    quality: quality ?? null,
    scene: o.scene,
    prompt,
    revisedPrompt: gen.revisedPrompt ?? null,
    usage: gen.usage ?? null,
    original: rel(originalPath),
    outputs: [rel(file)],
  });
  console.log(`기록 ${rel(log)}`);
  try {
    const { height } = await renderResized({ srcPath: originalPath, width, file });
    console.log(`본문 이미지 ${rel(file)} (${width}×${height})`);
  } catch (e) {
    throw new Error(`축소 실패: ${String(e?.message ?? e)}\n원본은 저장됐습니다 — ${rel(originalPath)}`);
  }
  console.log(`\n캡션 표기: (이미지: AI 생성, OpenAI ${model})`);
}

async function main(argv) {
  const o = parseArgs(argv);
  if (o.flags.has("help")) {
    console.log(USAGE);
    return;
  }
  const envFile = path.join(root, ".env.local");
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

  const slug = checkSlug(o.slug);
  if (o.flags.has("body")) return mainBody(o, slug);
  const lines = parseTitle(o.title);
  for (const w of titleWarnings(lines)) console.warn(`경고 — ${w}`);
  const sizes = parseSizes(o.sizes);
  const date = o.date ?? seoulDate();
  if (!/^\d{8}$/.test(date)) throw new Error(`--date는 YYYYMMDD입니다 (받은 값: ${date})`);
  const focus = checkFocus(o.focus ?? "center");
  const credit = o.credit ?? "이미지: AI 생성";
  const out = path.resolve(root, o.out ?? defaultOut(date));
  const bgIn = o.bg ? path.resolve(root, o.bg) : null;
  if (bgIn && !fs.existsSync(bgIn)) throw new Error(`--bg 파일이 없습니다: ${bgIn}`);
  if (bgIn) imageType(fs.readFileSync(bgIn));
  if (!bgIn && !o.scene) throw new Error("--scene(배경 장면 설명)이 필요합니다. 이미 만든 배경을 쓰려면 --bg");

  const model = o.model ?? process.env.OPENAI_IMAGE_MODEL ?? "";
  const apiSize = o["api-size"] ?? apiSizeFor(model);
  const quality = o.quality;
  if (quality && !/^(low|medium|high|auto|standard|hd)$/.test(quality)) throw new Error(`--quality 값을 알 수 없습니다: ${quality}`);
  const prompt = bgIn ? null : buildPrompt(o.scene);
  const base = pickBase({ out, slug, date, bgPath: bgIn });
  const targets = sizes.map((s) => ({ ...s, file: path.join(out, `${base}_${s.w}x${s.h}.png`) }));

  if (o.flags.has("dry-run")) {
    console.log("사전 점검 — API를 부르지 않습니다 (요금 없음)");
    console.log(` 방식      ${bgIn ? `기존 배경 재사용 (${rel(bgIn)})` : "새 배경 생성 (OpenAI 이미지 API, 유료)"}`);
    if (!bgIn) {
      console.log(` 모델      ${model || "(없음 — .env.local OPENAI_IMAGE_MODEL 또는 --model)"}`);
      console.log(` API 키    ${process.env.OPENAI_API_KEY ? "있음" : "없음 — .env.local에 OPENAI_API_KEY를 넣어야 생성됩니다"}`);
      console.log(` 생성 크기 ${apiSize}${quality ? ` · 품질 ${quality}` : ""}`);
      console.log(` 배경 저장 ${rel(path.join(out, `${base}_bg.png`))}`);
    }
    console.log(` 제목      ${lines.join(" / ")}${o.label ? ` · 라벨 ${o.label}` : ""}`);
    for (const t of targets) console.log(` 썸네일    ${rel(t.file)}`);
    if (prompt) console.log(`\n프롬프트\n${prompt}`);
    console.log("\n실제 생성은 같은 명령에서 --dry-run을 빼고 실행합니다.");
    return;
  }

  fs.mkdirSync(out, { recursive: true });
  let bgPath = bgIn;
  let gen = null;
  if (!bgIn) {
    let buf;
    ({ buf, gen } = await generateImage({ o, model, prompt, apiSize, quality }));
    bgPath = path.join(out, `${base}_bg.${imageType(buf).ext}`);
    fs.writeFileSync(bgPath, buf);
    console.log(`배경 저장 ${rel(bgPath)} (${(buf.length / 1024).toFixed(0)}KB)`);
  }

  // 기록은 배경을 얻은 직후에 남긴다 — 글자 합성이 실패해도 유료 생성 기록은 남는다
  const log = appendLog(path.join(out, "ai_prompts.json"), {
    createdAt: new Date().toISOString(),
    kind: "article-thumbnail",
    slug,
    title: lines,
    label: o.label ?? null,
    source: gen ? "openai" : "기존 배경",
    model: gen ? model : null,
    apiSize: gen ? apiSize : null,
    quality: gen ? quality ?? null : null,
    scene: o.scene ?? null,
    prompt,
    revisedPrompt: gen?.revisedPrompt ?? null,
    usage: gen?.usage ?? null,
    background: rel(bgPath),
    outputs: targets.map((t) => rel(t.file)),
  });
  console.log(`기록 ${rel(log)}`);

  try {
    await renderThumbs({ bgPath, lines, label: o.label, focus, credit, targets });
  } catch (e) {
    const again = gen ? `\n배경은 저장됐습니다 — API를 다시 부르지 않으려면 --scene 대신 --bg ${rel(bgPath)} 를 붙여 다시 실행하세요.` : "";
    throw new Error(`썸네일 합성 실패: ${String(e?.message ?? e)}${again}`);
  }
  for (const t of targets) console.log(`썸네일 ${rel(t.file)}`);
  if (gen) console.log(`\n캡션·편집 메모 표기: (이미지: AI 생성, OpenAI ${model})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
