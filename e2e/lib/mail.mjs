// E2E 공용 — 로컬 Supabase의 메일 수신함(Mailpit)
// SMTP 포트·웹 포트는 packages/db/supabase/config.toml([local_smtp] smtp_port·port)에서 읽는다 — 시험 서버(MAIL_SMTP_*)와 수신함 조회가 같은 값을 쓴다.
// CI와 로컬이 같은 config.toml로 supabase start를 하므로 포트가 같다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TARGET } from "./local.mjs";

const CONFIG = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "packages", "db", "supabase", "config.toml");

export function localMail() {
  const toml = fs.readFileSync(CONFIG, "utf8");
  const section = toml.slice(toml.indexOf("[local_smtp]"));
  const smtp = /^smtp_port\s*=\s*(\d+)/m.exec(section)?.[1];
  const web = /^port\s*=\s*(\d+)/m.exec(section)?.[1];
  if (!smtp || !web) throw new Error("config.toml [local_smtp]에 smtp_port·port가 필요합니다");
  return { smtpPort: Number(smtp), httpBase: `http://127.0.0.1:${web}` };
}

/** 시험 서버에 줄 메일 환경변수 — 로컬 수신함으로 보낸다. Docker 컨테이너에서는 호스트 이름을 바꿔 쓴다 */
export function mailEnv(overrides = {}) {
  const { smtpPort } = localMail();
  return {
    MAIL_FROM: "선명 <noreply@e2e.example.test>",
    MAIL_SMTP_HOST: TARGET === "docker" ? "host.docker.internal" : "127.0.0.1",
    MAIL_SMTP_PORT: String(smtpPort),
    ...overrides,
  };
}

async function api(pathname, init) {
  const r = await fetch(`${localMail().httpBase}${pathname}`, init);
  if (!r.ok) throw new Error(`수신함 조회 실패 (${r.status}) ${pathname}`);
  return r.json();
}

/** 받는 사람 주소로 온 메일 목록(최신순) — 본문 포함 */
export async function inboxFor(address) {
  const list = await api(`/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
  return Promise.all((list.messages ?? []).map((m) => api(`/api/v1/message/${m.ID}`)));
}

/** 받는 사람 주소로 count통 이상 올 때까지 기다린다 (기본 20초) */
export async function waitForMail(address, count = 1, timeoutMs = 20_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const mails = await inboxFor(address);
    if (mails.length >= count) return mails;
    if (Date.now() > end) throw new Error(`메일이 ${timeoutMs}ms 안에 ${count}통 도착하지 않음 (${mails.length}통)`);
    await new Promise((r) => setTimeout(r, 400));
  }
}
