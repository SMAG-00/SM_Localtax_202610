// E2E 공용 — 로컬 Supabase 접속값 읽기, standalone 서버 띄우기
// 로컬 Supabase의 키는 개발용 기본값이라 비밀이 아니지만, 로그에 찍지 않는다.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const WEB = path.join(ROOT, "apps", "web");
const STANDALONE_SERVER = path.join(WEB, ".next", "standalone", "apps", "web", "server.js");

export function localSupabase() {
  const out = execFileSync("supabase", ["status", "-o", "json"], {
    cwd: path.join(ROOT, "packages", "db"),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    shell: process.platform === "win32",
  });
  const j = JSON.parse(out.slice(out.indexOf("{")));
  return { url: j.API_URL, anonKey: j.ANON_KEY, serviceRoleKey: j.SERVICE_ROLE_KEY, dbUrl: j.DB_URL };
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** 웹 앱을 standalone으로 빌드한다 (Docker 이미지와 같은 산출물) */
export function buildWeb() {
  execFileSync("pnpm", ["--filter", "@ltr/web", "build"], { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
  if (!fs.existsSync(STANDALONE_SERVER)) throw new Error(`standalone 서버가 없습니다: ${STANDALONE_SERVER}`);
}

/** standalone 서버를 주어진 환경변수로 띄운다. 부모 환경변수는 넘기지 않는다 (시험마다 설정을 정확히 고정) */
export async function startServer(env) {
  const port = await freePort();
  const child = spawn(process.execPath, [STANDALONE_SERVER], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PORT: String(port), HOSTNAME: "127.0.0.1", NODE_ENV: "production", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`서버가 종료됨: ${log}`);
    try {
      await fetch(`${base}/api/health`);
      return { base, port, stop: () => child.kill(), log: () => log };
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  child.kill();
  throw new Error(`서버가 30초 안에 뜨지 않음: ${log}`);
}
