// 개발방법 비교 공개 데이터 통합 시험 (W4 19단계 — docs/dev/W4_설계.md 1장 19단계, PRD-01B PR-09)
// 로컬 Supabase에 anon 키로 읽는다 (경계 = 공개 뷰 public_dev_methods · public_dev_method_compare · public_dev_method_facts — 키 dev_methods 켜짐 + 방법 서명 + 비교 항목 6칸 서명).
// 서명이 있는 정상 경로(7개 고정 순서·사실 행·상세·관련 프로젝트)는 계정·감수위원이 필요해 E2E w4-dev-methods가 다룬다. 여기서는 데이터 함수의 닫힌 쪽을 본다:
//  · 키 꺼짐 → 목록·상세 null (공개 뷰는 0행) · 키만 켜도(서명 0) 공개 방법 0 → null ('준비 중' 화면 0) · 모양 밖 주소 null
// 시험은 키를 DB 트리거를 건너뛰어(운영 설정 화면 검사는 7개 서명을 요구한다) 켰다가 끝에 되돌린다. 방법 7행은 건드리지 않는다.
// 실행: pnpm --filter @ltr/web test:integration
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let db;
let methods;
let saved;

function localSupabase() {
  const out = execFileSync("supabase", ["status", "-o", "json"], {
    cwd: path.resolve(HERE, "../../../../../packages/db"),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    shell: process.platform === "win32",
  });
  const j = JSON.parse(out.slice(out.indexOf("{")));
  for (const u of [j.API_URL, j.DB_URL]) {
    const host = new URL(u).hostname;
    if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error("이 시험은 로컬 Supabase에서만 돈다");
  }
  return j;
}


const one = async (sql, params) => (await db.query(sql, params)).rows[0];
async function setFlag(on) {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("update public.settings set value = jsonb_set(value, '{dev_methods}', $1::jsonb) where key = 'feature_flags'", [JSON.stringify(on)]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

beforeAll(async () => {
  const sb = localSupabase();
  process.env.NEXT_PUBLIC_SUPABASE_URL = sb.API_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = sb.ANON_KEY;
  process.env.NEXT_PUBLIC_SITE_URL = "https://e2e.example.test";
  db = new pg.Client({ connectionString: sb.DB_URL });
  await db.connect();
  saved = (await one("select value from public.settings where key = 'feature_flags'")).value;
  expect(saved.dev_methods).toBe(false);
  expect((await one("select count(*)::int n from public.dev_method_compare")).n).toBe(0);
  methods = await import("./dev-methods.ts");
});

afterAll(async () => {
  if (db) {
    await setFlag(false);
    expect((await one("select value from public.settings where key = 'feature_flags'")).value).toEqual(saved);
    await db.end();
  }
});

describe("개발방법 공개 데이터 — 닫힌 쪽", () => {
  test("키 꺼짐 → 목록·상세 null", async () => {
    await setFlag(false);
    expect(await methods.getDevMethodsList()).toBeNull();
    expect(await methods.getDevMethod("trust")).toBeNull();
  });

  test("키만 켜고 서명이 없으면 공개 방법 0 → 목록·상세 null (빈 비교표·준비 중 화면 0)", async () => {
    await setFlag(true);
    expect(await methods.getDevMethodsList()).toBeNull();
    for (const slug of ["redevelopment", "trust", "rapid-planning"]) expect(await methods.getDevMethod(slug)).toBeNull();
  });

  test("공개 뷰 세 개 모두 anon 키로 읽히고 서명 전엔 0행 (작성자·서명자 계정 칸 0)", async () => {
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    for (const view of ["public_dev_methods", "public_dev_method_compare", "public_dev_method_facts"]) {
      const res = await fetch(`${base}/rest/v1/${view}?select=*`, { headers: { apikey: key, authorization: `Bearer ${key}` } });
      expect(res.status, view).toBe(200);
      const rows = await res.json();
      expect(rows, view).toEqual([]);
    }
    const cols = (await db.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = any($1)", [["public_dev_methods", "public_dev_method_compare", "public_dev_method_facts"]])).rows.map((r) => r.column_name);
    expect(cols.filter((c) => /drafted_by|reviewed_by|recorded_by|score|rank|recommend/.test(c))).toEqual([]);
  });
});
