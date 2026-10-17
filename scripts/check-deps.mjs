#!/usr/bin/env node
// 의존성 검사
//  FND-08 — Vercel 전용 서비스 패키지(Workflow·Queues·Blob·KV·Global Config·AI Gateway·BotID)가 의존성에 들어오면 실패 (lockfile의 간접 의존성 포함)
//  FND-01 — 1단계 AI SDK는 packages/assistant에서만 쓴다 (package.json 의존성과 import 모두)
// 규칙 목록: scripts/forbidden-packages.json
// 사용: node scripts/check-deps.mjs [저장소 루트]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEP_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const SKIP_DIR = /(^|\/)(node_modules|\.next|dist|coverage|__tests__)(\/|$)/;

/** "@ai-sdk/*" → @ai-sdk/ 아래 모든 패키지, "ai" → 정확히 ai (하위 경로 ai/rsc 포함) */
export function matcher(patterns) {
  return (name) =>
    patterns.find((p) => (p.endsWith("/*") ? name.startsWith(p.slice(0, -1)) : name === p || name.startsWith(`${p}/`)));
}

/** import 경로 → 패키지 이름 (@scope/name 또는 name) */
function packageOf(spec) {
  if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:")) return null;
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

export function importsOf(source) {
  const specs = new Set();
  const res = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of res) for (const m of source.matchAll(re)) specs.add(m[1]);
  return [...specs];
}

/** pnpm-lock.yaml packages: 절의 패키지 이름 */
export function lockPackages(lock) {
  const names = new Set();
  const section = lock.split(/^packages:\s*$/m)[1]?.split(/^snapshots:\s*$/m)[0] ?? "";
  for (const m of section.matchAll(/^ {2}'?((?:@[^@\s'/]+\/)?[^@\s'/]+)@[^:]*'?:\s*$/gm)) names.add(m[1]);
  return names;
}

function tracked(root) {
  return execFileSync("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

export function checkDeps({ root }) {
  const rules = JSON.parse(fs.readFileSync(path.join(root, "scripts", "forbidden-packages.json"), "utf8"));
  const isVercelOnly = matcher(rules.vercelOnly);
  const isAiSdk = matcher(rules.aiSdk);
  const allowed = (file) => rules.aiSdkAllowed.some((dir) => file === dir || file.startsWith(`${dir}/`));
  const errors = [];
  const files = tracked(root);

  for (const f of files.filter((f) => f.endsWith("package.json") && !SKIP_DIR.test(f))) {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, f), "utf8"));
    for (const field of DEP_FIELDS) {
      for (const name of Object.keys(pkg[field] ?? {})) {
        if (isVercelOnly(name)) errors.push(`${f}: Vercel 전용 서비스 패키지 ${name} (${field}) — 사내 서버 이전을 막는다 (FND-08)`);
        if (isAiSdk(name) && !allowed(f)) errors.push(`${f}: AI SDK ${name} (${field}) — 1단계에는 ${rules.aiSdkAllowed.join("·")}에서만 쓴다 (FND-01)`);
      }
    }
  }

  const lockPath = path.join(root, "pnpm-lock.yaml");
  if (fs.existsSync(lockPath)) {
    for (const name of lockPackages(fs.readFileSync(lockPath, "utf8"))) {
      if (isVercelOnly(name)) errors.push(`pnpm-lock.yaml: Vercel 전용 서비스 패키지 ${name}가 간접 의존성으로 들어왔다 (FND-08)`);
    }
  }

  for (const f of files.filter((f) => CODE_EXT.test(f) && !SKIP_DIR.test(f) && !allowed(f))) {
    const full = path.join(root, f);
    if (!fs.existsSync(full)) continue;
    for (const spec of importsOf(fs.readFileSync(full, "utf8"))) {
      const name = packageOf(spec);
      if (name && isAiSdk(name)) errors.push(`${f}: AI SDK '${spec}'를 불러온다 — 1단계에는 ${rules.aiSdkAllowed.join("·")}에서만 (FND-01)`);
      if (name && isVercelOnly(name)) errors.push(`${f}: Vercel 전용 서비스 패키지 '${spec}'를 불러온다 (FND-08)`);
    }
  }
  return { errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const r = checkDeps({ root });
  if (r.errors.length) {
    console.error(`의존성 검사 실패 ${r.errors.length}건`);
    for (const e of r.errors) console.error(` - ${e}`);
    process.exit(1);
  }
  console.log("의존성 검사 통과 — Vercel 전용 서비스 패키지 0, AI SDK는 허용 위치에만");
}
