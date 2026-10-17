// 화면 규칙 측정 (UX-02, PRD-00 8.2) — R1 글자 밀도 · R2 주 버튼 하나 · R3 오렌지 면적
// 실제 브라우저(Playwright)에서 잰다. 기준값은 PRD-00 8.2 표의 값이다 (바꾸면 표를 고친다).
import zlib from "node:zlib";

export const LIMITS = { r1Chars: 150, r2PrimaryPerViewport: 1, r3HermesRatio: 0.05 };
const HERMES_500 = [0xf2, 0x6a, 0x1b];
const TOLERANCE = 6; // 글꼴 안티앨리어싱 경계의 섞인 색은 세지 않는다

/** PNG(8비트 RGB/RGBA, 인터레이스 없음) → { width, height, channels, data } */
export function decodePng(buf) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error("8비트·인터레이스 없는 PNG만 읽는다");
      colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`지원하지 않는 PNG 색 형식: ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

export function hermesRatio(png) {
  const { width, height, channels, data } = decodePng(png);
  let count = 0;
  for (let i = 0; i < data.length; i += channels) {
    if (Math.abs(data[i] - HERMES_500[0]) <= TOLERANCE && Math.abs(data[i + 1] - HERMES_500[1]) <= TOLERANCE && Math.abs(data[i + 2] - HERMES_500[2]) <= TOLERANCE) count++;
  }
  return count / (width * height);
}

/** 페이지 안에서 — 첫 화면에 보이는 글자 수 (화면 읽기 전용·숨김 제외, 입력창 안내 포함) */
function countVisibleChars() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const visible = (el) => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
      const r = e.getBoundingClientRect();
      if (r.width <= 1 && r.height <= 1 && s.overflow !== "visible") return false; // sr-only 류
      if (s.clip && s.clip !== "auto" && /rect\(0(px)?,? ?0(px)?,? ?0(px)?,? ?0(px)?\)/.test(s.clip)) return false;
    }
    return true;
  };
  let chars = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    if (!text.trim() || !node.parentElement || !visible(node.parentElement)) continue;
    if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(node.parentElement.tagName)) continue;
    for (let i = 0; i < text.length; i++) {
      if (/\s/.test(text[i])) continue;
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const r = range.getBoundingClientRect();
      if (r.width > 0 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw) chars++;
    }
  }
  for (const input of document.querySelectorAll("input[placeholder], textarea[placeholder]")) {
    const r = input.getBoundingClientRect();
    if (!input.value && visible(input) && r.bottom > 0 && r.top < vh) chars += input.placeholder.replace(/\s/g, "").length;
  }
  return chars;
}

/** 페이지 안에서 — 뷰포트 높이 창을 위에서 아래로 옮기며 주 버튼 수의 최댓값 */
function maxPrimaryPerViewport() {
  const vh = window.innerHeight;
  const tops = [...document.querySelectorAll('[data-ui="primary-button"]')]
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({ top: r.top + window.scrollY, bottom: r.bottom + window.scrollY }));
  let max = 0;
  for (const start of [0, ...tops.map((t) => t.top)]) {
    const n = tops.filter((t) => t.bottom > start && t.top < start + vh).length;
    max = Math.max(max, n);
  }
  return max;
}

/** 한 화면을 한 뷰포트 크기로 잰다 → { r1, r2, r3 } */
export async function measurePage(browser, url, viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts?.ready);
    const chars = await page.evaluate(countVisibleChars);
    const maxPerViewport = await page.evaluate(maxPrimaryPerViewport);
    const ratio = hermesRatio(await page.screenshot({ type: "png" }));
    return {
      url,
      viewport: `${viewport.width}x${viewport.height}`,
      r1: { chars, limit: LIMITS.r1Chars, pass: chars <= LIMITS.r1Chars },
      r2: { maxPerViewport, limit: LIMITS.r2PrimaryPerViewport, pass: maxPerViewport <= LIMITS.r2PrimaryPerViewport },
      r3: { ratio: Math.round(ratio * 10000) / 10000, limit: LIMITS.r3HermesRatio, pass: ratio <= LIMITS.r3HermesRatio },
    };
  } finally {
    await page.close();
  }
}

/** 측정 결과 → 화면·규칙별 표 (CI 기록용, UX-02) */
export function toTable(results) {
  const ok = (p) => (p ? "통과" : "실패");
  const rows = results.map((r) => `| ${r.url} | ${r.viewport} | ${r.r1.chars}자 ${ok(r.r1.pass)} | ${r.r2.maxPerViewport}개 ${ok(r.r2.pass)} | ${(r.r3.ratio * 100).toFixed(2)}% ${ok(r.r3.pass)} |`);
  return ["| 화면 | 뷰포트 | R1 글자(≤150, 360px만) | R2 주 버튼(≤1) | R3 오렌지(≤5%) |", "|---|---|---|---|---|", ...rows].join("\n");
}
