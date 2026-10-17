// DS-02 견본 페이지 · FND-09 가로 스크롤 0 — 실제 브라우저(Playwright Chromium)로 /_design을 연다.
// E2E_BASE_URL이 있으면 그 주소(예: 배포된 시험 주소)를, 없으면 standalone 빌드를 띄워 확인한다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { ROOT, buildWeb, startServer } from "./lib/local.mjs";

let server;
let base;
let browser;

before(async () => {
  if (process.env.E2E_BASE_URL) {
    base = process.env.E2E_BASE_URL.replace(/\/$/, "");
  } else {
    buildWeb();
    server = await startServer({});
    base = server.base;
  }
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.stop();
});

/** 등록 목록의 data-ui 값 — 묶음별 registry.ts에서 읽는다 */
function registeredUis() {
  const dir = path.join(ROOT, "packages", "ui", "src", "components");
  const files = [path.join(dir, "base.registry.ts"), ...["shell", "discovery", "local", "services"].map((g) => path.join(dir, g, "registry.ts"))];
  return files.flatMap((f) => [...fs.readFileSync(f, "utf8").matchAll(/ui: "([a-z0-9-]+)"/g)].map((m) => m[1]));
}

for (const width of [360, 640, 1024]) {
  test(`폭 ${width}px에서 /_design 가로 스크롤 0`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 740 } });
    await page.goto(`${base}/_design`, { waitUntil: "networkidle" });
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    await page.close();
    assert.ok(scrollWidth <= clientWidth, `scrollWidth ${scrollWidth} > clientWidth ${clientWidth}`);
  });
}

test("견본 페이지에 등록된 70종이 모두 렌더되고 견본 칸도 70개다", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${base}/_design`, { waitUntil: "networkidle" });
  const { uis, specimens } = await page.evaluate(() => ({
    uis: [...new Set([...document.querySelectorAll("[data-ui]")].map((e) => e.getAttribute("data-ui")))],
    specimens: document.querySelectorAll("[data-specimen]").length,
  }));
  await page.close();
  const registered = registeredUis();
  assert.equal(registered.length, 70);
  assert.equal(specimens, 70);
  assert.deepEqual(registered.filter((u) => !uis.includes(u)), []);
});

test("견본 페이지는 검색 노출 차단(noindex)이고 외부 글꼴 요청이 없다 (DS-04)", async () => {
  const page = await browser.newPage();
  const external = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (/\.(woff2?|ttf|otf)$/.test(url.pathname) && !req.url().startsWith(base)) external.push(req.url());
  });
  await page.goto(`${base}/_design`, { waitUntil: "networkidle" });
  const robots = await page.getAttribute('meta[name="robots"]', "content");
  await page.close();
  assert.match(robots ?? "", /noindex/);
  assert.deepEqual(external, []);
});
