// DB 접속 주소 — 환경변수 SUPABASE_DB_URL(CI 전용)이 있으면 그것을 쓰고, 없으면 로컬 Supabase(supabase/config.toml의 [db] port)로 접속한다.
// 로컬 Supabase의 접속 문자열은 비밀이 아니다 (ENV-05). staging·prod 주소는 CI 비밀값으로만 넘긴다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const CONFIG = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "supabase", "config.toml");

export function localDbUrl() {
  const toml = fs.readFileSync(CONFIG, "utf8");
  const db = toml.split(/^\[/m).find((s) => s.startsWith("db]"));
  const port = db?.match(/^port\s*=\s*(\d+)/m)?.[1];
  if (!port) throw new Error(`${CONFIG}에서 [db] port를 찾지 못했습니다`);
  return `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;
}

export function dbUrl() {
  return process.env.SUPABASE_DB_URL || localDbUrl();
}

export function isLocal(url) {
  const host = new URL(url).hostname;
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export async function connect(url = dbUrl()) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}
