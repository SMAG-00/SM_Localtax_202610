#!/usr/bin/env node
// 버전 고정 검사 (ENV-04)
//  - .nvmrc의 Node 버전 = Dockerfile(ARG NODE_VERSION / FROM node:<버전>) = CI(setup-node의 node-version-file: .nvmrc), engines.node가 그 버전을 허용
//  - packageManager에 pnpm 정확한 버전 (pnpm@x.y.z)
//  - 코드에 모델 ID 문자열 상수 0 — 모델은 환경변수(ANTHROPIC_MODEL_* 등)로만. 문서·.env.example·범위 목록·시험 견본은 제외
// lockfile과 맞지 않는 설치는 CI의 `pnpm install --frozen-lockfile`이 막는다 (scripts/ci/*.sh)
// 사용: node scripts/check-pins.mjs [저장소 루트]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const MODEL_ID = /claude-(?:opus|sonnet|haiku|fable)-\d+(?:-\d+)*/;
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|ya?ml|toml|sh)$/;
const MODEL_ALLOWED = (f) =>
  f === ".env.example" || f === "scripts/env-scopes.json" || f.startsWith("docs/") || /(^|\/)(__tests__|tests|node_modules)\//.test(f) || f.endsWith(".md");

const cmp = (a, b) => {
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
};
const parse = (v) => v.replace(/^v/, "").split(".").map(Number);

/** ">=24.7.0 <25" 같은 단순 범위만 해석한다 (||·^·~는 쓰지 않는다) */
export function satisfies(version, range) {
  const v = parse(version);
  for (const part of range.trim().split(/\s+/)) {
    const m = part.match(/^(>=|<=|>|<|=)?(\d+(?:\.\d+){0,2})$/);
    if (!m) return null;
    const c = cmp(v, parse(m[2]));
    const op = m[1] ?? "=";
    const ok = { ">=": c >= 0, "<=": c <= 0, ">": c > 0, "<": c < 0, "=": c === 0 }[op];
    if (!ok) return false;
  }
  return true;
}

export function checkPins({ root }) {
  const errors = [];
  const read = (f) => (fs.existsSync(path.join(root, f)) ? fs.readFileSync(path.join(root, f), "utf8") : null);

  const nvmrc = read(".nvmrc")?.trim();
  if (!nvmrc || !/^\d+\.\d+\.\d+$/.test(nvmrc)) errors.push(".nvmrc에 Node 정확한 버전(x.y.z)이 없다");

  const docker = read("deploy/Dockerfile");
  if (docker && nvmrc) {
    const arg = docker.match(/^ARG NODE_VERSION=(\S+)/m)?.[1];
    const froms = [...docker.matchAll(/^FROM node:(\S+?)(?:-\w+)?(?:\s|$)/gm)].map((m) => m[1]);
    if (arg && arg !== nvmrc) errors.push(`deploy/Dockerfile: ARG NODE_VERSION=${arg} — .nvmrc(${nvmrc})와 다르다`);
    for (const tag of froms) {
      if (tag !== "${NODE_VERSION}" && tag !== nvmrc) errors.push(`deploy/Dockerfile: FROM node:${tag} — .nvmrc(${nvmrc})와 다르다`);
    }
    if (!arg && !froms.length) errors.push("deploy/Dockerfile: Node 이미지 버전을 찾지 못했다");
  }

  const wfDir = path.join(root, ".github", "workflows");
  if (fs.existsSync(wfDir)) {
    for (const f of fs.readdirSync(wfDir).filter((n) => /\.ya?ml$/.test(n))) {
      const text = fs.readFileSync(path.join(wfDir, f), "utf8");
      if (/\bnode-version:\s*\S/.test(text)) errors.push(`.github/workflows/${f}: node-version을 직접 적었다 — node-version-file: .nvmrc를 쓴다`);
      if (/setup-node/.test(text) && !/node-version-file:\s*\.nvmrc/.test(text)) errors.push(`.github/workflows/${f}: setup-node가 .nvmrc를 읽지 않는다`);
    }
  }

  const pkg = JSON.parse(read("package.json") ?? "{}");
  if (!/^pnpm@\d+\.\d+\.\d+$/.test(pkg.packageManager ?? "")) errors.push(`package.json: packageManager에 pnpm 정확한 버전이 없다 (${pkg.packageManager ?? "없음"})`);
  if (nvmrc && pkg.engines?.node) {
    const ok = satisfies(nvmrc, pkg.engines.node);
    if (ok === null) errors.push(`package.json: engines.node 범위(${pkg.engines.node})를 해석할 수 없다 — ">=x.y.z <N" 형태로 쓴다`);
    else if (!ok) errors.push(`package.json: engines.node(${pkg.engines.node})가 .nvmrc 버전 ${nvmrc}를 허용하지 않는다`);
  }

  const files = execFileSync("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
    .split("\0")
    .filter((f) => f && (CODE_EXT.test(f) || path.basename(f) === "Dockerfile") && !MODEL_ALLOWED(f) && f !== "pnpm-lock.yaml");
  for (const f of files) {
    const text = read(f);
    if (!text) continue;
    text.split(/\r?\n/).forEach((line, i) => {
      const m = line.match(MODEL_ID);
      if (m) errors.push(`${f}:${i + 1} 모델 ID 문자열 상수 '${m[0]}' — 환경변수(ANTHROPIC_MODEL_* 등)로 읽는다 (ENV-04)`);
    });
  }
  return { errors, nvmrc };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const r = checkPins({ root });
  if (r.errors.length) {
    console.error(`버전 고정 검사 실패 ${r.errors.length}건`);
    for (const e of r.errors) console.error(` - ${e}`);
    process.exit(1);
  }
  console.log(`버전 고정 검사 통과 — Node ${r.nvmrc} (.nvmrc·Dockerfile·CI·engines 일치), pnpm 고정, 코드의 모델 ID 상수 0`);
}
