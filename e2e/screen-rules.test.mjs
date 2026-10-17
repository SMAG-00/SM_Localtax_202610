// UX-02 화면 규칙 측정 — 측정 스크립트가 경계 견본에서 맞게 판정하는지 실제 브라우저로 확인한다.
//  R1 360×740 첫 화면 글자 150자 이하 (입력창 안내 포함, 화면 밖·화면 읽기 전용 글자 제외)
//  R2 뷰포트마다 주 버튼(data-ui=primary-button) 1개 이하
//  R3 hermes-500 면적 뷰포트의 5% 이하 (스크린샷 픽셀)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { ROOT } from "./lib/local.mjs";
import { measurePage } from "./lib/screen-rules.mjs";

const FIXTURES = path.join(ROOT, "e2e", "fixtures", "screen-rules");
let server;
let base;
let browser;

before(async () => {
  server = http.createServer((req, res) => {
    const file = path.join(FIXTURES, path.basename(req.url));
    if (!fs.existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.close();
});

const mobile = (file) => measurePage(browser, `${base}/${file}`, { width: 360, height: 740 });

test("R1 — 보이는 글자 150자는 통과, 151자는 실패", async () => {
  const a = await mobile("r1-150.html");
  const b = await mobile("r1-151.html");
  assert.equal(a.r1.chars, 150);
  assert.equal(a.r1.pass, true);
  assert.equal(b.r1.chars, 151);
  assert.equal(b.r1.pass, false);
});

test("R1 — 화면 밖 글자와 화면 읽기 전용(sr-only) 글자는 세지 않는다", async () => {
  const a = await mobile("r1-150.html");
  assert.equal(a.r1.chars, 150);
});

test("R1 — 입력창 안내 글자(placeholder)를 센다", async () => {
  const a = await mobile("r1-placeholder.html");
  assert.equal(a.r1.chars, 151);
  assert.equal(a.r1.pass, false);
});

test("R2 — 한 화면에 주 버튼 1개는 통과, 2개는 실패, 화면이 다르면 각 1개로 통과", async () => {
  assert.equal((await mobile("r2-one.html")).r2.pass, true);
  const two = await mobile("r2-two.html");
  assert.equal(two.r2.maxPerViewport, 2);
  assert.equal(two.r2.pass, false);
  const apart = await mobile("r2-apart.html");
  assert.equal(apart.r2.maxPerViewport, 1);
  assert.equal(apart.r2.pass, true);
});

test("R3 — hermes-500 면적 4.86%는 통과, 5.27%는 실패", async () => {
  const under = await mobile("r3-under.html");
  const over = await mobile("r3-over.html");
  assert.ok(Math.abs(under.r3.ratio - 0.0486) < 0.002, String(under.r3.ratio));
  assert.equal(under.r3.pass, true);
  assert.ok(Math.abs(over.r3.ratio - 0.0527) < 0.002, String(over.r3.ratio));
  assert.equal(over.r3.pass, false);
});

test("같은 화면은 같은 측정값 (결정론)", async () => {
  const a = await mobile("r2-two.html");
  const b = await mobile("r2-two.html");
  assert.deepEqual(a, b);
});
