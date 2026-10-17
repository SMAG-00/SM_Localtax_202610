#!/usr/bin/env node
// 마이그레이션 정적 검사 (FND-04 · FND-06)
//  1. 만든 테이블은 모두 RLS를 켠다 (같은 파일이든 뒤 파일이든). 껐다면(disable) 오류
//  2. `events`라는 이름의 표는 만들지 않는다 — 측정 표는 analytics_events, 행사 표는 local_events (PRD-00 9장)
// 사용: node scripts/lint-migrations.mjs <마이그레이션 폴더>
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RESERVED = new Map([["events", "측정 표는 analytics_events, 행사 표는 local_events를 쓴다 (PRD-00 9장)"]]);
const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const QNAME = String.raw`(${IDENT}(?:\s*\.\s*${IDENT})?)`;
const CREATE_RE = new RegExp(String.raw`\bcreate\s+(?:(?:global\s+|local\s+)?(?:temp|temporary)\s+|unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?${QNAME}`, "gi");
const RLS_RE = new RegExp(String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${QNAME}\s+(enable|disable)\s+row\s+level\s+security`, "gi");

function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/** "public"."Foo" · public.foo · foo → public.foo (따옴표 없는 이름은 소문자) */
export function normalize(name) {
  const parts = name.split(/\s*\.\s*/).map((p) => (p.startsWith('"') ? p.slice(1, -1) : p.toLowerCase()));
  return parts.length === 1 ? `public.${parts[0]}` : parts.join(".");
}

/** files: [{ name, sql }] (적용 순서대로) → { errors } */
export function lintMigrations(files) {
  const created = new Map(); // table → file
  const rls = new Map(); // table → { state, file }
  const errors = [];
  for (const { name, sql } of files) {
    const body = stripComments(sql);
    for (const m of body.matchAll(CREATE_RE)) {
      const table = normalize(m[1]);
      if (/\b(temp|temporary)\b/i.test(m[0])) continue; // 임시 테이블은 세션이 끝나면 사라진다
      created.set(table, name);
      const bare = table.split(".").pop();
      if (RESERVED.has(bare)) errors.push(`${name}: 테이블 이름 '${bare}'는 쓰지 않는다 — ${RESERVED.get(bare)}`);
    }
    for (const m of body.matchAll(RLS_RE)) {
      rls.set(normalize(m[1]), { state: m[2].toLowerCase(), file: name });
    }
  }
  for (const [table, file] of created) {
    const r = rls.get(table);
    if (!r) errors.push(`${file}: ${table} 테이블에 RLS가 켜져 있지 않다 (alter table ${table} enable row level security)`);
    else if (r.state === "disable") errors.push(`${r.file}: ${table} 테이블의 RLS를 껐다 (disable) — 모든 테이블은 RLS 기본 거부`);
  }
  return { errors };
}

export function lintMigrationDir(dir) {
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith(".sql")).sort() : [];
  const files = names.map((n) => ({ name: n, sql: fs.readFileSync(path.join(dir, n), "utf8") }));
  return { files: files.length, ...lintMigrations(files) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("사용: node scripts/lint-migrations.mjs <마이그레이션 폴더>");
    process.exit(2);
  }
  const r = lintMigrationDir(dir);
  if (r.errors.length) {
    console.error(`마이그레이션 검사 실패 ${r.errors.length}건`);
    for (const e of r.errors) console.error(` - ${e}`);
    process.exit(1);
  }
  console.log(`마이그레이션 검사 통과 — ${r.files}개 파일, 모든 테이블 RLS 켜짐`);
}
