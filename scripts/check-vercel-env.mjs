#!/usr/bin/env node
// Vercel 환경변수 설정 검사 (FND-02 · ENV-05 · ENV-06)
//  - Production의 NEXT_PUBLIC_SUPABASE_URL은 운영(prod) DB, Preview·Development는 시험(staging) DB
//  - CI 전용 변수(scripts/env-scopes.json의 ci 범위)는 Vercel 어느 환경에도 없다
// Vercel CLI로 환경별 값을 임시 파일에 받아 비교하고 바로 지운다. 값은 화면에 찍지 않는다 (ref·변수 이름만).
// 필요: Vercel CLI 로그인(로컬) 또는 VERCEL_TOKEN(CI). 사용: node scripts/check-vercel-env.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGETS = ["production", "preview", "development"];

export function parseDotenv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 1) continue;
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[line.slice(0, i).trim()] = v;
  }
  return out;
}

const refOf = (url) => (url ?? "").match(/^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/)?.[1] ?? null;

/** envs: { production: {...}, preview: {...}, development: {...} } → { errors, summary } */
export function evaluateVercelEnv(envs, refs, ciOnly) {
  const errors = [];
  const summary = {};
  for (const target of TARGETS) {
    const vars = envs[target] ?? {};
    const ref = refOf(vars.NEXT_PUBLIC_SUPABASE_URL);
    summary[target] = ref ? (ref === refs.production ? "운영 DB" : ref === refs.staging ? "시험 DB" : "알 수 없는 DB") : "없음";
    if (!vars.NEXT_PUBLIC_SUPABASE_URL) errors.push(`${target}: NEXT_PUBLIC_SUPABASE_URL이 없다`);
    else if (target === "production" && ref !== refs.production) errors.push(`${target}: 운영 DB(${refs.production})가 아닌 ${ref ?? "Supabase 밖 주소"}를 가리킨다`);
    else if (target !== "production" && ref === refs.production) errors.push(`${target}: 운영 DB(${refs.production})를 가리킨다 — 시험 DB만 써야 한다`);
    else if (target !== "production" && ref !== refs.staging) errors.push(`${target}: 시험 DB(${refs.staging})가 아닌 ${ref ?? "Supabase 밖 주소"}를 가리킨다`);
    for (const name of ciOnly) if (name in vars) errors.push(`${target}: CI 전용 변수 ${name}가 Vercel에 있다 — GitHub Actions Secrets에만 둔다 (ENV-05)`);
  }
  return { errors, summary };
}

function pull(target, dir) {
  const file = path.join(dir, `${target}.env`);
  const args = ["env", "pull", file, "--environment", target, "--yes"];
  if (process.env.VERCEL_TOKEN) args.push("--token", process.env.VERCEL_TOKEN);
  const r = spawnSync("vercel", args, { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32" });
  if (r.status !== 0) throw new Error(`vercel env pull ${target} 실패 (종료 코드 ${r.status})`);
  return parseDotenv(fs.readFileSync(file, "utf8"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const refs = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "config", "environments.json"), "utf8")).supabaseRef;
  const scopes = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "env-scopes.json"), "utf8"));
  const ciOnly = Object.entries(scopes.vars).filter(([, s]) => s === "ci").map(([k]) => k);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ltr-vercel-env-"));
  let result;
  try {
    const envs = Object.fromEntries(TARGETS.map((t) => [t, pull(t, dir)]));
    result = evaluateVercelEnv(envs, refs, ciOnly);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true }); // 받은 값은 바로 지운다
  }
  for (const [t, s] of Object.entries(result.summary)) console.log(`${t.padEnd(12)} → ${s}`);
  if (result.errors.length) {
    console.error(`Vercel 환경변수 검사 실패 ${result.errors.length}건`);
    for (const e of result.errors) console.error(` - ${e}`);
    process.exit(1);
  }
  console.log("Vercel 환경변수 검사 통과 — Production↔운영 DB, Preview·Development↔시험 DB, CI 전용 변수 0");
}
