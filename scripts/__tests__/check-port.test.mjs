// FND-10 개발 서버 포트 검사 — 실제 프로세스가 포트를 잡은 상태에서 검사 스크립트를 실행해 확인한다.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import http from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "check-port.mjs");
const holders = [];

after(() => {
  for (const h of holders) if (h.exitCode === null) h.kill();
});

/** 비어 있는 포트 하나를 OS에서 받아 온다 */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** 별도 프로세스(다른 프로그램 역할)가 포트를 잡고 HTTP로 자기 PID를 답한다 */
function holdPort(port, host) {
  const code = `
    const http = require("node:http");
    http.createServer((q, r) => r.end(String(process.pid)))
      .listen(${port}, ${host ? JSON.stringify(host) : "undefined"}, () => console.log("ready"));
  `;
  const child = spawn(process.execPath, ["-e", code], { stdio: ["ignore", "pipe", "inherit"] });
  holders.push(child);
  return new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => d.toString().includes("ready") && resolve(child));
    child.once("exit", (c) => reject(new Error(`holder exited ${c}`)));
  });
}

function getPid(port) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: "/" }, (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => resolve(Number(body)));
      })
      .on("error", reject);
  });
}

function runCheck(...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
}

test("비어 있는 포트면 종료 코드 0과 사용 가능 메시지", async () => {
  const port = await freePort();
  const r = runCheck(String(port));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, new RegExp(`${port}.*사용 가능`));
});

test("다른 프로세스가 쓰는 포트면 종료 코드 1, 메시지에 그 프로세스 이름과 PID", async () => {
  const port = await freePort();
  const holder = await holdPort(port);
  const r = runCheck(String(port));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, new RegExp(`PID ${holder.pid}\\b`));
  assert.match(r.out, /node(\.exe)?/i);
  assert.match(r.out, /다른 포트로 옮기지 않/);
});

test("포트를 쓰는 프로세스를 종료하지 않는다 — 검사 뒤에도 같은 PID가 응답", async () => {
  const port = await freePort();
  const holder = await holdPort(port);
  runCheck(String(port));
  assert.equal(holder.exitCode, null);
  assert.equal(await getPid(port), holder.pid);
});

test("127.0.0.1에만 묶인 프로세스도 사용 중으로 판정한다", async () => {
  const port = await freePort();
  const holder = await holdPort(port, "127.0.0.1");
  const r = runCheck(String(port));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, new RegExp(`PID ${holder.pid}\\b`));
});

test("다른 포트(3000 역할)를 쓰는 프로세스는 건드리지 않고, 검사 포트가 비어 있으면 통과", async () => {
  const otherPort = await freePort();
  const other = await holdPort(otherPort);
  const port = await freePort();
  const r = runCheck(String(port));
  assert.equal(r.code, 0, r.out);
  assert.equal(other.exitCode, null);
  assert.equal(await getPid(otherPort), other.pid);
});

test("인자가 없으면 3001을 검사한다", () => {
  const r = runCheck();
  assert.match(r.out, /3001/);
  assert.ok(r.code === 0 || r.code === 1, r.out);
});

for (const bad of ["abc", "0", "65536", "-1", "30.5"]) {
  test(`잘못된 포트 값(${bad})은 종료 코드 2`, () => {
    const r = runCheck(bad);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /포트 번호/);
  });
}
