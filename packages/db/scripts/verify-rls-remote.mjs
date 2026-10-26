#!/usr/bin/env node
// 원격 DB RLS 검증 (FND-04 — "RLS 검증 스크립트를 실제 staging DB에 실행") — 시험·운영 프로젝트 모두
//  1. DB 목록(Management API로 SQL 조회): public 표마다 RLS 켜짐, anon이 실행할 수 있는 함수는 허용 목록뿐
//  2. 실제 API(PostgREST)에 anon 키로 요청: 표마다 0행이거나 거부, 비공개 함수 호출 거부
// 필요: Supabase CLI 로그인(로컬) 또는 SUPABASE_ACCESS_TOKEN(CI). anon 키는 공개 키지만 화면에 찍지 않는다.
// 사용: node scripts/verify-rls-remote.mjs [staging|production|all]   (기본 all)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PUBLIC_READ_ALLOWLIST } from "./verify-rls.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..", "..");
const DB_DIR = path.join(HERE, "..");
const shell = process.platform === "win32";

// anon(공개 키)이 실행해도 되는 함수 — 데이터를 읽지 않는 상태 확인(FND-06)과, 공개 행만 돌려주는 통합 검색(W2-d — security invoker라
// 부르는 역할의 RLS·칸 권한이 그대로 걸린다, docs/dev/W2-d_설계.md 7장), 통합 검색이 부르는 지역 + 주제 분류(W4 10단계 — security invoker,
// 공개 행정구역과 공개 설정 search_topics 한 줄만 읽는다, docs/dev/W4_설계.md 11.9)
// + AI 도우미 익명 호출 함수 5개(W7b — security definer, 입력 모양 검사 후 마스킹본만 기록, docs/dev/W7b_설계.md 2행)
export const ANON_EXECUTE_ALLOWED = new Set([
  "health_ping",
  "search_public",
  "search_classify",
  "assistant_runtime",
  "assistant_rate_hit",
  "assistant_register_prompt",
  "assistant_record_turn",
  "assistant_feedback",
  // W10-d - 해석 DB 검색 함수 2개(security invoker - 공개 뷰 public_legal_docs·public_links만 읽는다, docs/dev/W10-d_설계.md)
  "search_legal_docs",
  "legal_doc_type_counts",
  // W12-a - 근거형 AI 검색 함수 2개(security definer - 필터·등급은 함수 안 SQL, 본문 읽기는 이 함수로만, docs/dev/W12-a_설계.md)
  "agent_search",
  "agent_premium_hint",
  // W12-e - 공개 단계·범위 플래그 값만 돌려주는 공개 판정 함수(security definer, 리포트·지표·승인자 0, docs/dev/W12-e_설계.md)
  "public_ask_gate",
  // W12-b - 지방세봇 기록·런타임 함수 4개(security definer, 입력 모양 검사, 표 직접 읽기·쓰기 0, docs/dev/W12-b_설계.md)
  "agent_register_prompt",
  "agent_runtime",
  "agent_session_state",
  "agent_record_turn",
]);

/** 응답 판정 — 빈 배열·401·403·404는 차단, 행이 있는 200은 노출, 그 밖은 오류 */
export function classify(status, body) {
  if (status === 401 || status === 403 || status === 404) return "blocked";
  if (status === 200 && Array.isArray(body)) return body.length === 0 ? "blocked" : "exposed";
  if (status === 200) return "exposed";
  return "error";
}

/** anon 키로 표·함수를 직접 부른다 → { checked, exposed, errors } */
export async function probeRest(restBase, anonKey, tables, functions) {
  const headers = { apikey: anonKey, authorization: `Bearer ${anonKey}`, "content-type": "application/json" };
  const exposed = [];
  const errors = [];
  for (const t of tables) {
    const res = await fetch(`${restBase}/rest/v1/${encodeURIComponent(t)}?select=*&limit=1`, { headers });
    const body = await res.json().catch(() => null);
    const v = classify(res.status, body);
    if (v === "exposed") exposed.push(t);
    if (v === "error") errors.push(`${t}: 응답 ${res.status}`);
  }
  for (const f of functions) {
    const res = await fetch(`${restBase}/rest/v1/rpc/${encodeURIComponent(f)}`, { method: "POST", headers, body: "{}" });
    const body = await res.json().catch(() => null);
    // 함수는 실행 자체가 되면(200·204, 또는 인자 오류 400) 노출이다 — 권한이 없으면 401·403·404
    if (res.status === 401 || res.status === 403 || res.status === 404) continue;
    if (res.status === 400 && /permission denied/i.test(JSON.stringify(body))) continue;
    exposed.push(`rpc/${f}`);
  }
  return { checked: tables.length + functions.length, exposed, errors };
}

function cli(args) {
  const r = spawnSync("supabase", args, { cwd: DB_DIR, encoding: "utf8", shell, env: process.env });
  if (r.status !== 0) throw new Error(`supabase ${args.slice(0, 3).join(" ")} 실패: ${(r.stderr || "").split("\n").slice(-3).join(" ")}`);
  return r.stdout;
}

/** SQL은 파일로 넘긴다 — 명령줄 인자로 넘기면 Windows 셸에서 공백마다 잘린다 */
function query(ref, sql) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ltr-sql-"));
  const file = path.join(dir, "q.sql");
  fs.writeFileSync(file, sql);
  try {
    const out = cli(["db", "query", "--linked", "--project-ref", ref, "-o", "json", "-f", file]);
    const start = Math.min(...["[", "{"].map((c) => out.indexOf(c)).filter((i) => i >= 0));
    const j = JSON.parse(out.slice(start));
    return Array.isArray(j) ? j : (j.rows ?? j.result ?? []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function verify(target, ref) {
  const problems = [];
  const tables = query(ref, "select c.relname as name, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p') order by 1");
  for (const t of tables) if (!t.rls) problems.push(`${t.name}: RLS 꺼짐`);
  const fns = query(ref, "select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE') order by 1");
  for (const f of fns) if (!ANON_EXECUTE_ALLOWED.has(f.name)) problems.push(`함수 ${f.name}: anon이 실행할 수 있다`);
  const allFns = query(ref, "select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1").map((f) => f.name);

  const keysOut = cli(["projects", "api-keys", "--project-ref", ref, "-o", "json"]);
  const keys = JSON.parse(keysOut.slice(keysOut.indexOf("["), keysOut.lastIndexOf("]") + 1));
  const anon = keys.find((k) => k.name === "anon")?.api_key;
  if (!anon) throw new Error(`${target}: anon 키를 찾지 못했다`);
  // 공개 읽기 허용 표(verify-rls.mjs PUBLIC_READ_ALLOWLIST — 공개 행만 정책으로 연다)는 행이 보이는 것이 정상이라 노출 판정에서 뺀다
  const probeTables = tables.map((t) => t.name).filter((n) => !PUBLIC_READ_ALLOWLIST.has(`public.${n}`));
  const probe = await probeRest(`https://${ref}.supabase.co`, anon, probeTables, allFns.filter((n) => !ANON_EXECUTE_ALLOWED.has(n)));
  for (const e of probe.exposed) problems.push(`${e}: anon 키로 읽히거나 실행된다`);
  for (const e of probe.errors) problems.push(e);
  return { tables: tables.length, functions: allFns.length, probed: probe.checked, problems };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const refs = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "config", "environments.json"), "utf8")).supabaseRef;
  const which = process.argv[2] ?? "all";
  const targets = Object.entries({ staging: refs.staging, production: refs.production }).filter(([t]) => which === "all" || which === t);
  if (!targets.length) {
    console.error("사용: node scripts/verify-rls-remote.mjs [staging|production|all]");
    process.exit(2);
  }
  let failed = 0;
  for (const [target, ref] of targets) {
    const r = await verify(target, ref);
    if (r.problems.length) {
      failed++;
      console.error(`${target}: 실패 ${r.problems.length}건`);
      for (const p of r.problems) console.error(` - ${p}`);
    } else {
      console.log(`${target}: 통과 — 표 ${r.tables}개 RLS 켜짐, 함수 ${r.functions}개 중 anon 실행은 허용 목록만, 실제 API에 anon 키로 ${r.probed}건 요청 → 접근 0`);
    }
  }
  process.exit(failed ? 1 : 0);
}
