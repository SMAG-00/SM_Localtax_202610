#!/usr/bin/env node
// 환경변수 규칙 검사 — ENV-02 파일 · ENV-03 노출 차단 · ENV-05 변수 범위
//  - .env.example: 모든 키의 값은 비어 있고, 범위 주석([공개]·[서버]·[서버 전용]·[CI 전용])이 범위 목록 파일과 같다
//  - 범위 목록(scripts/env-scopes.json)의 변수는 모두 .env.example에 있다 (platform 목록 제외)
//  - NEXT_PUBLIC_ 접두어 ⇔ 공개 범위 (비밀값에 NEXT_PUBLIC_ 금지)
//  - .gitignore가 .env·.env*.local을 막고, 커밋 대상 파일에 .env 계열이 없다 (.env.example 제외)
//  - 코드가 읽는 process.env 이름은 모두 범위 목록에 있다. 아무도 읽지 않는 변수는 경고
// 사용: node scripts/check-env.mjs [저장소 루트]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const LABELS = { 공개: "public", 서버: "server", "서버 전용": "server-secret", "CI 전용": "ci" };
const LABEL_OF = Object.fromEntries(Object.entries(LABELS).map(([k, v]) => [v, k]));
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const SKIP_DIR = /(^|\/)(node_modules|\.next|dist|coverage|__tests__)(\/|$)/;
const ENV_FILE = /(^|\/)\.env(\.[^/]*)?$/;

export function parseEnvExample(text) {
  const entries = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const m = line.match(/^([A-Z][A-Z0-9_]*)=([^#]*?)\s*(?:#\s*(.*))?$/);
    if (!m) {
      entries.push({ line: i + 1, bad: raw });
      return;
    }
    const tag = m[3]?.match(/^\[([^\]]+)\]/)?.[1];
    entries.push({ line: i + 1, key: m[1], value: m[2].trim(), scope: tag ? LABELS[tag] ?? `?${tag}` : null });
  });
  return entries;
}

function trackedFiles(root) {
  return execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
}

export function envReads(source) {
  const names = new Set();
  for (const m of source.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)) names.add(m[1]);
  for (const m of source.matchAll(/process\.env\[\s*["'`]([A-Z_][A-Z0-9_]*)["'`]\s*\]/g)) names.add(m[1]);
  for (const m of source.matchAll(/\{([^{}]*)\}\s*=\s*process\.env\b/g)) {
    for (const part of m[1].split(",")) {
      const name = part.split(/[:=]/)[0].trim();
      if (/^[A-Z_][A-Z0-9_]*$/.test(name)) names.add(name);
    }
  }
  return names;
}

export function checkEnv({ root }) {
  const errors = [];
  const warnings = [];
  const scopes = JSON.parse(fs.readFileSync(path.join(root, "scripts", "env-scopes.json"), "utf8"));
  const vars = scopes.vars ?? {};
  const platform = new Set(scopes.platform ?? []);

  // .env.example
  const examplePath = path.join(root, ".env.example");
  const entries = fs.existsSync(examplePath) ? parseEnvExample(fs.readFileSync(examplePath, "utf8")) : [];
  if (!entries.length) errors.push(".env.example이 없거나 비어 있다");
  const inExample = new Map();
  for (const e of entries) {
    if (e.bad !== undefined) {
      errors.push(`.env.example:${e.line} 형식이 아니다 — ${e.bad.trim()}`);
      continue;
    }
    inExample.set(e.key, e.scope);
    if (e.value) errors.push(`.env.example:${e.line} ${e.key}에 값이 있다 — 값은 비워 두고 기본값은 주석에 적는다 (ENV-02)`);
    if (!e.scope) errors.push(`.env.example:${e.line} ${e.key}에 범위 주석이 없다 — # [공개]·[서버]·[서버 전용]·[CI 전용]`);
    else if (e.scope.startsWith("?")) errors.push(`.env.example:${e.line} ${e.key}의 범위 '${e.scope.slice(1)}'를 알 수 없다`);
    else if (!(e.key in vars)) errors.push(`${e.key}: .env.example에는 있지만 범위 목록(scripts/env-scopes.json)에 없다`);
    else if (vars[e.key] !== e.scope)
      errors.push(`${e.key}: 범위가 다르다 — .env.example [${LABEL_OF[e.scope]}] · 범위 목록 [${LABEL_OF[vars[e.key]] ?? vars[e.key]}]`);
  }
  for (const [key, scope] of Object.entries(vars)) {
    if (!LABEL_OF[scope]) errors.push(`${key}: 범위 목록의 범위 '${scope}'를 알 수 없다`);
    if (!inExample.has(key)) errors.push(`${key}: 범위 목록에 있지만 .env.example에 없다`);
    const isPublicName = key.startsWith("NEXT_PUBLIC_");
    if (isPublicName && scope !== "public")
      errors.push(`${key}: NEXT_PUBLIC_ 접두어는 브라우저에 공개된다 — [${LABEL_OF[scope] ?? scope}] 변수에 쓸 수 없다 (ENV-03)`);
    if (!isPublicName && scope === "public") errors.push(`${key}: [공개] 변수는 NEXT_PUBLIC_ 접두어가 있어야 브라우저에서 읽힌다`);
  }

  // .gitignore · 커밋 대상
  const gitignore = fs.existsSync(path.join(root, ".gitignore"))
    ? fs.readFileSync(path.join(root, ".gitignore"), "utf8").split(/\r?\n/).map((l) => l.trim())
    : [];
  for (const need of [".env", ".env*.local"]) {
    if (!gitignore.includes(need)) errors.push(`.gitignore에 '${need}'가 없다 (ENV-02)`);
  }
  const tracked = trackedFiles(root);
  for (const f of tracked) {
    if (ENV_FILE.test(f) && !f.endsWith(".env.example")) errors.push(`${f}: 환경변수 파일이 커밋 대상이다 — 값은 .env.local·Vercel·GitHub Secrets에만 둔다 (ENV-02)`);
  }

  // 코드가 읽는 이름
  const reads = new Map(); // name → first file
  for (const f of tracked) {
    if (!CODE_EXT.test(f) || SKIP_DIR.test(f)) continue;
    const full = path.join(root, f);
    if (!fs.existsSync(full)) continue;
    for (const name of envReads(fs.readFileSync(full, "utf8"))) if (!reads.has(name)) reads.set(name, f);
  }
  for (const [name, file] of reads) {
    if (!(name in vars) && !platform.has(name)) errors.push(`${file}: 범위 목록에 없는 환경변수 ${name}를 읽는다 — scripts/env-scopes.json과 .env.example에 범위와 함께 더한다 (ENV-05)`);
  }
  for (const key of Object.keys(vars)) {
    if (!reads.has(key)) warnings.push(`${key}: 아직 아무 코드도 읽지 않는다`);
  }
  return { errors, warnings, vars: Object.keys(vars).length, reads: reads.size };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const r = checkEnv({ root });
  for (const w of r.warnings) console.log(`경고 — ${w}`);
  if (r.errors.length) {
    console.error(`환경변수 검사 실패 ${r.errors.length}건`);
    for (const e of r.errors) console.error(` - ${e}`);
    process.exit(1);
  }
  console.log(`환경변수 검사 통과 — 범위 목록 ${r.vars}개, 코드가 읽는 이름 ${r.reads}개`);
}
