// E2E 공용 — 로컬 Supabase 접속값 읽기, 웹 서버 띄우기
// E2E_TARGET=docker 이면 같은 시험을 Docker 이미지(deploy/Dockerfile)로 돌린다 (FND-07 — Vercel·Docker에서 같은 E2E)
// 로컬 Supabase의 키는 개발용 기본값이라 비밀이 아니지만, 로그·명령줄에 찍지 않는다.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const WEB = path.join(ROOT, "apps", "web");
export const TARGET = process.env.E2E_TARGET === "docker" ? "docker" : "standalone";
export const IMAGE = "ltr-web:e2e";
const STANDALONE_SERVER = path.join(WEB, ".next", "standalone", "apps", "web", "server.js");
const CONTAINER_PORT = 8080; // 컨테이너 안 포트 — PORT 환경변수로 정해지는지 함께 본다
const shell = process.platform === "win32";

export function localSupabase() {
  const out = execFileSync("supabase", ["status", "-o", "json"], {
    cwd: path.join(ROOT, "packages", "db"),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    shell,
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

/** standalone 빌드 또는 Docker 이미지 빌드 */
export function buildWeb() {
  if (TARGET === "docker") {
    execFileSync("docker", ["build", "-f", "deploy/Dockerfile", "-t", IMAGE, "."], { cwd: ROOT, stdio: "inherit" });
    return;
  }
  execFileSync("pnpm", ["--filter", "@ltr/web", "build"], { cwd: ROOT, stdio: "inherit", shell });
  if (!fs.existsSync(STANDALONE_SERVER)) throw new Error(`standalone 서버가 없습니다: ${STANDALONE_SERVER}`);
}

async function waitHealthy(base, isDead, log) {
  const end = Date.now() + 60_000;
  while (Date.now() < end) {
    if (isDead()) throw new Error(`서버가 종료됨: ${log()}`);
    try {
      await fetch(`${base}/api/health`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error(`서버가 60초 안에 뜨지 않음: ${log()}`);
}

/** 컨테이너 안에서 호스트의 로컬 Supabase에 닿도록 주소를 바꾼다 */
const forContainer = (value) => value.replace(/\/\/(127\.0\.0\.1|localhost)(?=[:/])/g, "//host.docker.internal");

/** 웹 서버를 주어진 환경변수로 띄운다. 부모 환경변수는 넘기지 않는다 (시험마다 설정을 정확히 고정) */
export async function startServer(env) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  if (TARGET === "docker") {
    const names = Object.keys(env);
    const values = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, forContainer(v)]));
    const args = ["run", "-d", "--rm", "-p", `127.0.0.1:${port}:${CONTAINER_PORT}`, "--add-host", "host.docker.internal:host-gateway"];
    args.push("-e", `PORT=${CONTAINER_PORT}`);
    for (const n of names) args.push("-e", n); // 값은 명령줄이 아니라 환경으로 넘긴다
    args.push(IMAGE);
    const id = execFileSync("docker", args, { encoding: "utf8", env: { ...process.env, ...values } }).trim();
    const alive = () => spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", id], { encoding: "utf8" }).stdout.trim() === "true";
    const log = () => spawnSync("docker", ["logs", id], { encoding: "utf8" }).stdout;
    await waitHealthy(base, () => !alive(), log);
    return { base, port, id, stop: () => spawnSync("docker", ["rm", "-f", id], { stdio: "ignore" }), log };
  }
  const child = spawn(process.execPath, [STANDALONE_SERVER], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PORT: String(port), HOSTNAME: "127.0.0.1", NODE_ENV: "production", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  await waitHealthy(base, () => child.exitCode !== null, () => out);
  return { base, port, stop: () => child.kill(), log: () => out };
}
