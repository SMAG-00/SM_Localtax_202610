#!/usr/bin/env node
// RLS 검증 (FND-04) — 실제 DB에 접속해 확인한다.
//  1. public 스키마의 모든 테이블에 RLS가 켜져 있다
//  2. anon·authenticated 역할로 각 테이블을 읽으면 0행이거나 권한 거부다 (공개 정책이 있는 테이블은 허용 목록으로만)
// PostgREST는 anon 키 요청을 DB의 anon 역할로 실행하므로, 같은 역할로 직접 읽어 같은 결과를 본다.
// 사용: SUPABASE_DB_URL=... node scripts/verify-rls.mjs   (SUPABASE_DB_URL이 없으면 로컬 Supabase)
import { pathToFileURL } from "node:url";
import { connect } from "./db.mjs";

// 공개 읽기를 허용하는 테이블 — 공개 뷰·정책을 만들 때 여기에 이유와 함께 더한다 (지금은 없음)
export const PUBLIC_READ_ALLOWLIST = new Map();

export async function tablesWithoutRls(client) {
  const { rows } = await client.query(`
    select n.nspname || '.' || c.relname as name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
    order by 1`);
  return rows.map((r) => r.name);
}

async function publicTables(client) {
  const { rows } = await client.query(`
    select n.nspname || '.' || c.relname as name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    order by 1`);
  return rows.map((r) => r.name);
}

/** role로 읽었을 때 행이 보이는 테이블 [{ table, rows }] — 같은 연결의 savepoint 안에서 읽고 되돌린다 */
export async function exposedTables(client, role) {
  const exposed = [];
  for (const table of await publicTables(client)) {
    const [schema, name] = table.split(".");
    const ident = `"${schema.replaceAll('"', '""')}"."${name.replaceAll('"', '""')}"`;
    await client.query("savepoint rls_probe");
    try {
      await client.query(`set local role ${role}`);
      const { rows } = await client.query(`select count(*)::int as n from ${ident}`);
      if (rows[0].n > 0) exposed.push({ table, rows: rows[0].n });
    } catch (err) {
      if (err.code !== "42501") throw err; // 42501 = 권한 거부 → 접근 0
    } finally {
      await client.query("rollback to savepoint rls_probe");
    }
  }
  return exposed;
}

async function main() {
  const client = await connect();
  const errors = [];
  try {
    for (const t of await tablesWithoutRls(client)) errors.push(`${t}: RLS 꺼짐`);
    await client.query("begin");
    try {
      for (const role of ["anon", "authenticated"]) {
        for (const e of await exposedTables(client, role)) {
          if (!PUBLIC_READ_ALLOWLIST.has(e.table)) errors.push(`${e.table}: ${role}가 ${e.rows}행을 읽음`);
        }
      }
    } finally {
      await client.query("rollback");
    }
    const count = (await publicTables(client)).length;
    if (errors.length) {
      console.error(`RLS 검증 실패 ${errors.length}건`);
      for (const e of errors) console.error(` - ${e}`);
      return 1;
    }
    console.log(`RLS 검증 통과 — public 테이블 ${count}개 모두 RLS 켜짐, anon·authenticated 접근 0`);
    return 0;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
