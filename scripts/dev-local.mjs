#!/usr/bin/env node
// 이 PC에서 사이트를 띄웁니다 (개발용, http://localhost:3001).
//   pnpm dev:local
// - 이 PC의 시험용 DB(로컬 Supabase, Docker)에 연결합니다. 꺼져 있으면 먼저 켭니다.
// - 이 PC에서만 쓰는 시험용 관리자 계정을 처음 한 번 만들고, 이메일·비밀번호를 비밀보관 폴더(문서\SM_Localtax_비밀보관\개발용주소-관리자-로그인.txt)에 적습니다.
//   폴더는 LTR_SECRETS_DIR로 바꿀 수 있고, 폴더가 없으면 data-src/local-admin.txt(저장소에 안 올라감)에 적습니다.
// - AI 도우미 키·모델은 apps/web/.env.local에서 Next가 읽습니다. 운영 DB·운영 계정에는 닿지 않습니다.
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_DIR = path.join(ROOT, "packages", "db");
/** 비밀번호는 한곳(비밀보관 폴더)에 둡니다 (2026-10-24 PO "비밀번호를 한곳에 보관하자") */
const SECRETS_DIR = process.env.LTR_SECRETS_DIR ?? path.join(os.homedir(), "Documents", "SM_Localtax_비밀보관");
const ADMIN_FILE = fs.existsSync(SECRETS_DIR) ? path.join(SECRETS_DIR, "개발용주소-관리자-로그인.txt") : path.join(ROOT, "data-src", "local-admin.txt");
const ADMIN_EMAIL = "po@local.test";
const shell = process.platform === "win32";

function supabaseStatus() {
  try {
    const out = execFileSync("supabase", ["status", "-o", "json"], { cwd: DB_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], shell });
    return JSON.parse(out.slice(out.indexOf("{")));
  } catch {
    return null;
  }
}

let status = supabaseStatus();
if (!status) {
  console.log("시험용 DB(로컬 Supabase)를 켭니다 — Docker Desktop이 켜져 있어야 합니다…");
  execFileSync("supabase", ["start", "-x", "vector,logflare,edge-runtime,imgproxy,realtime,studio"], { cwd: DB_DIR, stdio: "inherit", shell });
  status = supabaseStatus();
}
if (!status) {
  console.error("시험용 DB에 연결하지 못했습니다. Docker Desktop을 켠 뒤 다시 실행해 주세요.");
  process.exit(1);
}

/** 이 PC 전용 시험용 관리자 — 이미 있으면 그대로 둡니다.
 *  시험용 DB를 초기화(db reset)하면 계정만 사라지고 로그인 정보 파일은 남으므로, 파일의 비밀번호로 계정을 다시 만듭니다 */
async function ensureLocalAdmin() {
  const saved = fs.existsSync(ADMIN_FILE) ? /비밀번호:\s*(\S+)/.exec(fs.readFileSync(ADMIN_FILE, "utf8"))?.[1] : undefined;
  const password = saved ?? crypto.randomBytes(12).toString("base64url");
  const res = await fetch(`${status.API_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: status.SERVICE_ROLE_KEY, authorization: `Bearer ${status.SERVICE_ROLE_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password, email_confirm: true }),
  });
  if (!res.ok && res.status !== 422) {
    console.error(`시험용 관리자 계정을 만들지 못했습니다 (HTTP ${res.status})`);
    return;
  }
  if (res.status === 422) {
    console.log(`시험용 관리자 계정(${ADMIN_EMAIL})이 이미 있습니다. 비밀번호를 잊었으면 시험용 DB를 초기화하세요(supabase db reset).`);
    return;
  }
  if (saved) {
    console.log(`시험용 관리자 계정을 다시 만들었습니다(시험용 DB 초기화 뒤) — 로그인 정보는 ${ADMIN_FILE} 그대로입니다.`);
    return;
  }
  fs.mkdirSync(path.dirname(ADMIN_FILE), { recursive: true });
  fs.writeFileSync(ADMIN_FILE, `이 PC 전용 시험용 관리자 (http://localhost:3001/admin)\n이메일: ${ADMIN_EMAIL}\n비밀번호: ${password}\n`, "utf8");
  console.log(`시험용 관리자 계정을 만들었습니다 — 로그인 정보는 ${ADMIN_FILE}에 있습니다.`);
}
await ensureLocalAdmin();

const env = {
  ...process.env,
  NEXT_PUBLIC_SITE_URL: "http://localhost:3001",
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  SITE_INDEXING: "off",
  ADMIN_EMAILS: ADMIN_EMAIL,
  AUDIT_ADMIN_EMAILS: ADMIN_EMAIL,
  GUARD_SECRET: crypto.randomBytes(24).toString("hex"),
  ASSISTANT_ENABLED: process.env.ASSISTANT_ENABLED ?? "on",
  // 메일은 로컬 Supabase 수신함(Mailpit)으로만 보낸다 — E2E와 같은 설정 (e2e/lib/mail.mjs)
  ...localMailEnv(),
};

function localMailEnv() {
  const toml = fs.readFileSync(path.join(ROOT, "packages", "db", "supabase", "config.toml"), "utf8");
  const smtpPort = /^smtp_port\s*=\s*(\d+)/m.exec(toml.slice(toml.indexOf("[local_smtp]")))?.[1];
  if (!smtpPort) return {};
  return { MAIL_FROM: "선명 <noreply@local.test>", MAIL_SMTP_HOST: "127.0.0.1", MAIL_SMTP_PORT: smtpPort };
}
console.log("사이트를 띄웁니다 → http://localhost:3001 (관리 화면 /admin). 끄려면 Ctrl+C");
const child = spawn("pnpm", ["--filter", "@ltr/web", "dev"], { cwd: ROOT, env, stdio: "inherit", shell });
child.on("exit", (code) => process.exit(code ?? 0));
