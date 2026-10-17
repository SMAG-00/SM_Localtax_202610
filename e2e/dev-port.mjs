#!/usr/bin/env node
// FND-10 수용 기준 E2E — 실제 개발 서버를 띄워 확인한다.
//  A. 3000에 다른 프로세스가 있는 채로 루트에서 `npm run dev`·`pnpm dev` → 3001이 200, 3000의 응답·PID 그대로
//  B. 3001을 다른 프로세스가 쓰는 상태에서 `npm run dev` → 종료 코드 1, 메시지에 그 PID, 3002 등 다른 포트에 서버 없음
// 3000번에 이미 다른 프로젝트가 떠 있으면 그 프로세스를 그대로 두고 PID만 대조한다 (종료·수정 금지).
import { spawn, execFileSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isPortInUse, findListeners } from "../scripts/check-port.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEV_PORT = 3001;
const OTHER_PORT = 3000;
const NEIGHBOR_PORTS = [3002, 3003];
const START_TIMEOUT_MS = 180_000;
const spawned = [];
let failures = 0;

function check(ok, label, detail = "") {
  console.log(`${ok ? "통과" : "실패"} — ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}

function get(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 5000 }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
  });
}

function holdPort(port) {
  const code = `require("node:http").createServer((q, r) => r.end("holder:" + process.pid)).listen(${port}, () => console.log("ready"));`;
  const child = spawn(process.execPath, ["-e", code], { stdio: ["ignore", "pipe", "inherit"] });
  spawned.push(child);
  return new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => d.toString().includes("ready") && resolve(child));
    child.once("exit", (c) => reject(new Error(`포트 ${port} 점유 프로세스가 종료됨 (${c})`)));
  });
}

/** 우리가 띄운 프로세스 트리만 끈다 */
function killTree(child) {
  if (child.exitCode !== null) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {}
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
}

function runDev(cmd) {
  // Windows에서 npm·pnpm은 .cmd라 셸로 띄운다 — 인자를 따로 넘기지 않고 고정 명령 문자열 하나로 넘긴다
  const win = process.platform === "win32";
  const child = spawn(win ? `${cmd} run dev` : cmd, win ? [] : ["run", "dev"], {
    cwd: ROOT,
    shell: win,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  spawned.push(child);
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  return { child, output: () => out };
}

async function waitFor(fn, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

async function neighborState() {
  const s = {};
  for (const p of NEIGHBOR_PORTS) s[p] = (await isPortInUse(p)) ? findListeners(p).map((o) => o.pid).sort().join(",") : "free";
  return s;
}

async function scenarioA(cmd, other) {
  const before = await get(OTHER_PORT);
  const { child, output } = runDev(cmd);
  const res = await waitFor(async () => {
    const r = await get(DEV_PORT);
    return r && r.status === 200 ? r : null;
  }, START_TIMEOUT_MS);
  check(Boolean(res), `[${cmd} run dev] http://localhost:${DEV_PORT} 이 200으로 응답`, res ? "" : output().slice(-400));
  const after = await get(OTHER_PORT);
  check(before && after && before.body === after.body, `[${cmd} run dev] 3000 응답이 그대로`);
  const pidsAfter = findListeners(OTHER_PORT).map((o) => o.pid);
  check(pidsAfter.includes(other.pid), `[${cmd} run dev] 3000 프로세스 PID 그대로`, `PID ${other.pid}`);
  killTree(child);
  await waitFor(async () => !(await isPortInUse(DEV_PORT)), 30_000);
}

async function scenarioB() {
  const holder = await holdPort(DEV_PORT);
  const neighborsBefore = await neighborState();
  const { child, output } = runDev("npm");
  const code = await waitFor(
    () => new Promise((r) => (child.exitCode !== null ? r(child.exitCode) : r(null))),
    60_000,
  );
  check(code !== null && code !== 0, "[3001 사용 중] npm run dev가 실패 코드로 멈춤", `종료 코드 ${code}`);
  check(output().includes(`PID ${holder.pid}`), "[3001 사용 중] 메시지에 점유 프로세스 PID", output().trim().split("\n").slice(-3).join(" / "));
  const neighborsAfter = await neighborState();
  check(JSON.stringify(neighborsBefore) === JSON.stringify(neighborsAfter), "[3001 사용 중] 3002·3003에 새 서버 없음", JSON.stringify(neighborsAfter));
  const still = await get(DEV_PORT);
  check(still && still.body === `holder:${holder.pid}`, "[3001 사용 중] 점유 프로세스가 그대로 응답");
  killTree(child);
  killTree(holder);
}

async function main() {
  if (await isPortInUse(DEV_PORT)) {
    console.error(`시작 전에 ${DEV_PORT}이 이미 쓰이고 있어 E2E를 할 수 없습니다: ${JSON.stringify(findListeners(DEV_PORT))}`);
    return 2;
  }
  let other;
  if (await isPortInUse(OTHER_PORT)) {
    const owner = findListeners(OTHER_PORT)[0];
    console.log(`3000번은 이미 다른 프로그램이 쓰고 있어 그대로 둡니다 — ${owner?.name} (PID ${owner?.pid})`);
    other = { pid: owner?.pid };
  } else {
    other = await holdPort(OTHER_PORT);
    console.log(`3000번에 더미 서버를 띄웠습니다 (PID ${other.pid})`);
  }
  await scenarioA("npm", other);
  await scenarioA("pnpm", other);
  await scenarioB();
  return failures ? 1 : 0;
}

try {
  process.exitCode = await main();
} finally {
  for (const c of spawned) killTree(c);
}
console.log(failures ? `실패 ${failures}건` : "모두 통과");
