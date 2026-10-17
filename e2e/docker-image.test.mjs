// FND-07 Docker 이미지 검증 — 사내 서버 이전 대비. 이미지를 실제로 빌드해 컨테이너로 띄운다.
// (같은 API 시험은 E2E_TARGET=docker로 e2e/api-health-jobs.test.mjs를 돌려 확인한다)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { IMAGE, ROOT, localSupabase, freePort } from "./lib/local.mjs";

let id;
let base;

before(async () => {
  execFileSync("docker", ["build", "-f", "deploy/Dockerfile", "-t", IMAGE, "."], { cwd: ROOT, stdio: "inherit" });
  const sb = localSupabase();
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  id = execFileSync(
    "docker",
    ["run", "-d", "--rm", "-p", `127.0.0.1:${port}:8080`, "-e", "PORT=8080", "--add-host", "host.docker.internal:host-gateway", "-e", "NEXT_PUBLIC_SUPABASE_URL", "-e", "NEXT_PUBLIC_SUPABASE_ANON_KEY", IMAGE],
    { encoding: "utf8", env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: sb.url.replace("127.0.0.1", "host.docker.internal"), NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey } },
  ).trim();
  const end = Date.now() + 60_000;
  while (Date.now() < end) {
    try {
      await fetch(`${base}/api/health`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error("컨테이너가 60초 안에 응답하지 않음");
});

after(() => {
  if (id) execFileSync("docker", ["rm", "-f", id], { stdio: "ignore" });
});

const inContainer = (...cmd) => execFileSync("docker", ["exec", id, ...cmd], { encoding: "utf8" }).trim();

test("PORT=8080으로 띄운 컨테이너가 8080에서 응답한다", () => {
  const status = inContainer("node", "-e", "fetch('http://127.0.0.1:8080/api/health').then(r=>console.log(r.status))");
  assert.equal(status, "200");
});

test("컨테이너 안에서 3000번은 열려 있지 않다 (PORT가 실제로 쓰였다)", () => {
  const out = inContainer("node", "-e", "fetch('http://127.0.0.1:3000/').then(()=>console.log('open'),()=>console.log('closed'))");
  assert.equal(out, "closed");
});

test("컨테이너의 DB 상태 확인이 ok (호스트의 로컬 Supabase에 연결)", async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).checks.db, "ok");
});

test("첫 화면과 정적 자산(/_next/static)이 응답한다", async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<html lang="ko"/);
  const asset = html.match(/\/_next\/static\/[^"']+\.(?:js|css)/)?.[0];
  assert.ok(asset, "정적 자산 링크가 없다");
  assert.equal((await fetch(`${base}${asset}`)).status, 200);
});

test("컨테이너는 root가 아닌 사용자로 돈다", () => {
  assert.notEqual(inContainer("id", "-u"), "0");
});

test("이미지 안에 .env 파일·docs·시험 코드가 들어가지 않는다", () => {
  const out = inContainer("sh", "-c", "find / -xdev \\( -name '.env' -o -name '.env.local' -o -name '*.test.mjs' -o -name 'PRD_*' \\) 2>/dev/null | grep -v '^/proc' || true");
  assert.equal(out, "");
});

test("Dockerfile의 Node 버전이 .nvmrc와 같다 (ENV-04)", () => {
  const nvmrc = fs.readFileSync(path.join(ROOT, ".nvmrc"), "utf8").trim();
  assert.equal(inContainer("node", "-v"), `v${nvmrc}`);
});
