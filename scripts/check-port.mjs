#!/usr/bin/env node
// 개발 서버 포트 검사 (FND-10, PRD-00 10.3).
// 포트가 이미 쓰이고 있으면 쓰는 프로세스 이름·PID를 알려 주고 종료 코드 1로 멈춘다.
// 다른 포트로 옮겨 가지 않고, 포트를 쓰는 프로세스에 어떤 신호도 보내지 않는다 (3000번 다른 프로젝트 보호).
// 사용: node scripts/check-port.mjs [포트]   (기본 3001)
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DEFAULT_PORT = 3001;
// 같은 포트라도 묶는 주소가 다르면 결과가 다를 수 있어 모두 시험한다 (Next 개발 서버는 모든 주소에 묶인다)
const BIND_HOSTS = ["127.0.0.1", "0.0.0.0", "::1", "::"];
const IN_USE_CODES = new Set(["EADDRINUSE", "EACCES"]);

export function parsePort(arg) {
  if (arg === undefined) return DEFAULT_PORT;
  if (!/^\d+$/.test(arg)) return null;
  const n = Number(arg);
  return n >= 1 && n <= 65535 ? n : null;
}

function canBind(port, host) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.unref();
    s.once("error", (err) => resolve(!IN_USE_CODES.has(err.code))); // IPv6 없음 등은 사용 중이 아니다
    s.listen({ port, host, exclusive: true }, () => s.close(() => resolve(true)));
  });
}

function canConnect(port, host) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    sock.setTimeout(500);
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("timeout", () => {
      sock.destroy();
      resolve(false);
    });
    sock.once("error", () => resolve(false));
  });
}

export async function isPortInUse(port) {
  for (const host of BIND_HOSTS) {
    if (!(await canBind(port, host))) return true;
  }
  return (await canConnect(port, "127.0.0.1")) || (await canConnect(port, "::1"));
}

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  } catch {
    return "";
  }
}

/** 포트를 LISTEN 중인 프로세스 목록 [{ pid, name }] — 읽기만 한다 */
export function findListeners(port) {
  const found = new Map();
  if (process.platform === "win32") {
    for (const line of run("netstat", ["-ano"]).split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/);
      // TCP  0.0.0.0:3001  0.0.0.0:0  LISTENING  1234
      if (cols[0] !== "TCP" || cols[3] !== "LISTENING") continue;
      if (!cols[1].endsWith(`:${port}`)) continue;
      const pid = Number(cols[4]);
      if (pid > 0 && !found.has(pid)) {
        const csv = run("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
        const name = csv.match(/^"([^"]+)"/m)?.[1] ?? "확인 불가";
        found.set(pid, name);
      }
    }
  } else {
    // users:(("node",pid=123,fd=20)) — 이름 칸은 스레드 이름(예: Node의 MainThread)일 수 있어 아래에서 실행 파일 이름으로 바꾼다
    for (const m of run("ss", ["-ltnpH", `sport = :${port}`]).matchAll(/\("([^"]+)",pid=(\d+)/g)) {
      found.set(Number(m[2]), m[1]);
    }
    if (found.size === 0) {
      let pid = null;
      for (const line of run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"]).split("\n")) {
        if (line.startsWith("p")) pid = Number(line.slice(1));
        else if (line.startsWith("c") && pid) found.set(pid, line.slice(1));
      }
    }
    for (const [pid, name] of found) found.set(pid, programName(pid) ?? name);
  }
  return [...found].map(([pid, name]) => ({ pid, name }));
}

/** 프로세스의 실행 파일 이름 (리눅스 /proc, 그 밖은 ps) — 스레드 이름이 아니라 프로그램 이름 */
function programName(pid) {
  try {
    const argv0 = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0")[0];
    if (argv0) return path.basename(argv0);
  } catch {}
  const comm = run("ps", ["-p", String(pid), "-o", "comm="]).trim();
  return comm ? path.basename(comm) : null;
}

async function main() {
  const port = parsePort(process.argv[2]);
  if (port === null) {
    console.error(`포트 번호가 올바르지 않습니다: ${process.argv[2]} (1~65535 정수)`);
    return 2;
  }
  if (!(await isPortInUse(port))) {
    console.log(`포트 ${port} 사용 가능`);
    return 0;
  }
  const owners = findListeners(port);
  const who = owners.length
    ? owners.map((o) => `${o.name} (PID ${o.pid})`).join(", ")
    : "확인 불가 (운영체제가 프로세스 정보를 주지 않음)";
  console.error(
    [
      `포트 ${port}을(를) 이미 다른 프로그램이 쓰고 있습니다 — ${who}`,
      `다른 포트로 옮기지 않고 멈춥니다. 그 프로그램을 직접 닫은 뒤 다시 실행하세요.`,
    ].join("\n"),
  );
  return 1;
}

// 다른 스크립트(e2e/dev-port.mjs)가 함수만 가져다 쓸 수 있게, 직접 실행할 때만 검사한다
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
