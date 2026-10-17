// W1-c 완료 증거 — 견본 페이지 접근성 95점 이상 (Lighthouse 접근성 점수, PRD-01A 9장·10.1)
// Playwright Chromium을 원격 디버깅으로 띄우고 Lighthouse를 붙인다. 측정이 문제를 잡는지 역검사 견본(일부러 망가뜨린 페이지)도 잰다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import lighthouse from "lighthouse";
import { chromium } from "playwright";
import { ROOT, buildWeb, freePort, startServer } from "./lib/local.mjs";

const MIN = 0.95;
let server;
let base;
let fixtureServer;
let fixtureBase;
let browser;
let port;

before(async () => {
  if (process.env.E2E_BASE_URL) base = process.env.E2E_BASE_URL.replace(/\/$/, "");
  else {
    buildWeb();
    server = await startServer({});
    base = server.base;
  }
  fixtureServer = http.createServer((req, res) => {
    const file = path.join(ROOT, "e2e", "fixtures", "a11y", path.basename(req.url));
    if (!fs.existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(fs.readFileSync(file));
  });
  await new Promise((r) => fixtureServer.listen(0, "127.0.0.1", r));
  fixtureBase = `http://127.0.0.1:${fixtureServer.address().port}`;
  port = await freePort();
  browser = await chromium.launch({ args: [`--remote-debugging-port=${port}`] });
});

after(async () => {
  await browser?.close();
  server?.stop();
  fixtureServer?.close();
});

async function accessibility(url) {
  const r = await lighthouse(url, { port, output: "json", logLevel: "error", onlyCategories: ["accessibility"] });
  const cat = r.lhr.categories.accessibility;
  const failing = cat.auditRefs
    .map((ref) => r.lhr.audits[ref.id])
    .filter((a) => a.score !== null && a.score < 1 && a.scoreDisplayMode === "binary")
    .map((a) => a.id);
  console.log(`접근성 ${Math.round(cat.score * 100)}점 — ${url.replace(/^https?:\/\/[^/]+/, "")}${failing.length ? ` (미흡: ${failing.join(", ")})` : ""}`);
  return { score: cat.score, failing };
}

test("역검사 — 일부러 문제를 넣은 견본은 95점 미만이고 문제 항목을 잡는다", async () => {
  const r = await accessibility(`${fixtureBase}/bad.html`);
  assert.ok(r.score < MIN, `점수 ${r.score}`);
  for (const id of ["image-alt", "color-contrast", "html-has-lang", "button-name"]) assert.ok(r.failing.includes(id), `${id} 미검출: ${r.failing}`);
});

test("디자인 견본(/_design) 접근성 95점 이상", async () => {
  const r = await accessibility(`${base}/_design`);
  assert.ok(r.score >= MIN, `점수 ${r.score} — 실패 항목: ${r.failing.join(", ")}`);
});

test("첫 화면(/) 접근성 95점 이상", async () => {
  const r = await accessibility(`${base}/`);
  assert.ok(r.score >= MIN, `점수 ${r.score} — 실패 항목: ${r.failing.join(", ")}`);
});
