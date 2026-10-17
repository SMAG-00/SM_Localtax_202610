#!/usr/bin/env node
// 빌드 산출물 비밀값 검사 (ENV-03 · ENV-06)
//  서버 전용 비밀 변수(scripts/env-scopes.json의 server-secret)에 가짜 값(카나리아)을 넣고 빌드한 뒤 .next 전체를 찾는다.
//  - 카나리아 값이 산출물 어디에도 없다 (브라우저 번들은 물론, 서버 번들에도 빌드 때 값이 박히면 안 된다 — 실행 때 읽어야 한다)
//  - 브라우저 번들(.next/static)에 서버 전용 변수 이름이 없다
//  - 키 형식 문자열(service_role JWT · sb_secret_ · sk-ant- · re_ · gh*_)이 없다 — anon JWT는 공개 키라 허용
// 사용: node scripts/scan-bundle-secrets.mjs --build   (카나리아로 apps/web을 빌드하고 검사)
//       node scripts/scan-bundle-secrets.mjs           (이미 있는 apps/web/.next 검사 — 카나리아 값 검사는 하지 않음)
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEXT_EXT = /\.(js|mjs|cjs|json|html|css|map|rsc|txt|body|meta)$/;
const KEY_PATTERNS = [
  ["Supabase 새 비밀 키", /sb_secret_[A-Za-z0-9_-]{20,}/],
  ["Anthropic 키", /sk-ant-[A-Za-z0-9_-]{20,}/],
  ["Resend 키", /\bre_[A-Za-z0-9]{24,}\b/],
  ["GitHub 토큰", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
];
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

export function makeCanaries(names) {
  return Object.fromEntries(names.map((n) => [n, `canary_${n.toLowerCase()}_${crypto.randomBytes(12).toString("hex")}`]));
}

export function looksLikeServiceRoleJwt(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue; // pnpm 링크(node_modules) — 우리 산출물이 아니다
    if (e.isDirectory()) {
      // 빌드 캐시는 배포 산출물이 아니고, standalone은 같은 서버 번들의 복사본 + 외부 패키지(node_modules)다
      if (e.name === "cache" || e.name === "standalone" || e.name === "node_modules") continue;
      out.push(...walk(p));
    } else if (e.isFile() && (TEXT_EXT.test(e.name) || !path.extname(e.name))) out.push(p);
  }
  return out;
}

/** nextDir: apps/web/.next · canaries: {이름: 값} (없으면 값 검사 생략) · serverSecretNames: 브라우저 번들 이름 검사 대상 */
export function scanBuild({ nextDir, canaries = {}, serverSecretNames }) {
  const errors = [];
  if (!fs.existsSync(nextDir)) return { errors: [`빌드 폴더가 없다: ${nextDir}`], files: 0 };
  const files = walk(nextDir);
  for (const file of files) {
    const rel = path.relative(nextDir, file).split(path.sep).join("/");
    const text = fs.readFileSync(file, "utf8");
    const isClient = rel.startsWith("static/");
    for (const [name, value] of Object.entries(canaries)) {
      if (text.includes(value)) errors.push(`${rel}: 서버 전용 비밀값 ${name}가 빌드 산출물에 들어 있다${isClient ? " (브라우저 번들)" : " (빌드 때 박힘)"}`);
    }
    if (isClient) {
      for (const name of serverSecretNames) if (text.includes(name)) errors.push(`${rel}: 브라우저 번들에 서버 전용 변수 이름 ${name}가 있다 (ENV-03)`);
    }
    for (const [label, re] of KEY_PATTERNS) if (re.test(text)) errors.push(`${rel}: ${label} — 키 형식 문자열이 있다`);
    for (const m of text.matchAll(JWT)) {
      if (looksLikeServiceRoleJwt(m[0])) {
        errors.push(`${rel}: service_role JWT 형식 문자열이 있다`);
        break;
      }
    }
  }
  return { errors, files: files.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const scopes = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "env-scopes.json"), "utf8"));
  const serverSecretNames = Object.entries(scopes.vars).filter(([, s]) => s === "server-secret").map(([k]) => k);
  const nextDir = path.join(ROOT, "apps", "web", ".next");
  let canaries = {};
  if (process.argv.includes("--build")) {
    canaries = makeCanaries(serverSecretNames);
    const r = spawnSync("pnpm", ["--filter", "@ltr/web", "build"], {
      cwd: ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: { ...process.env, ...canaries },
    });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
  const r = scanBuild({ nextDir, canaries, serverSecretNames });
  if (r.errors.length) {
    console.error(`빌드 산출물 비밀값 검사 실패 ${r.errors.length}건 (값은 표시하지 않음)`);
    for (const e of r.errors) console.error(` - ${e}`);
    process.exit(1);
  }
  console.log(`빌드 산출물 비밀값 검사 통과 — 파일 ${r.files}개, 서버 전용 비밀 ${serverSecretNames.length}종 ${Object.keys(canaries).length ? "가짜 값 0" : "(값 검사 생략)"} · 브라우저 번들 변수 이름 0 · 키 형식 0`);
}
