// 용어사전 공개 데이터 통합 시험 (W2-d 3단계 — docs/dev/W2-d_설계.md 8.2, GLO-01 · GLO-02) — 로컬 Supabase의 실제 API(PostgREST)에 anon 키로 읽는다.
// 공개·숨긴 가짜 용어와 그 용어가 든 공개 기사를 DB에 직접 넣고(커밋 — anon 요청은 다른 연결) 본다:
//  · 기능 키 glossary가 꺼지면 색인·용어 쪽 null(404), 기사 툴팁 용어는 공개 용어만이고 용어사전 링크 0, 허브 칩 링크 0, 검색 결과 링크 0
//  · 켜면 색인에 공개 용어만(숨긴 용어 0) · 용어 쪽(숨긴 용어는 null) · 툴팁·칩·검색 결과에 용어 쪽 주소
//  · 쉬운 풀이가 없는 공개 용어는 툴팁에 0 · 공개로 바꾸면 다음 읽기부터 보인다
// 끝나면 만든 행을 지우고 기능 공개 목록을 되돌린다. 로컬 DB에서만 돈다. 용어는 시험용 가짜 낱말이다(실제 용어 풀이를 넣지 않는다).
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const M = `가짜용어${RUN.replace(/[^a-z]/g, "").slice(0, 4)}표식`;

let db;
let api;
let savedFlags;
const w = {};
const made = { people: [], articles: [], glossary: [] };

function localSupabase() {
  const out = execFileSync("supabase", ["status", "-o", "json"], {
    cwd: path.resolve(HERE, "../../../../../packages/db"),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    shell: process.platform === "win32",
  });
  const j = JSON.parse(out.slice(out.indexOf("{")));
  for (const u of [j.API_URL, j.DB_URL]) {
    if (!["127.0.0.1", "localhost", "::1"].includes(new URL(u).hostname)) throw new Error("이 시험은 로컬 Supabase에서만 돈다");
  }
  return j;
}

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
async function insert(table, cols, bucket) {
  const keys = Object.keys(cols);
  const row = await one(`insert into public.${table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, keys.map((k) => cols[k]));
  made[bucket].push(row.id);
  return row;
}
const setGlossaryFlag = async (on) => {
  const flags = { ...savedFlags, glossary: on };
  await db.query("update public.settings set value = $1 where key = 'feature_flags'", [JSON.stringify(flags)]);
};
const indexIds = (v) => v.groups.flatMap((g) => g.entries.map((e) => e.id));

beforeAll(async () => {
  const sb = localSupabase();
  process.env.NEXT_PUBLIC_SUPABASE_URL = sb.API_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = sb.ANON_KEY;
  process.env.NEXT_PUBLIC_SITE_URL = "https://e2e.example.test";
  db = new pg.Client({ connectionString: sb.DB_URL });
  await db.connect();
  savedFlags = (await one("select value from public.settings where key = 'feature_flags'")).value;

  w.shown = await insert("glossary_terms", { term: `${M}갑`, plain: "시험용 풀이 갑", definition: "시험용 뜻 갑", related: [`${M}을`, `${M}병`], section: ["tax"], visible: true }, "glossary");
  w.hidden = await insert("glossary_terms", { term: `${M}을`, plain: "시험용 풀이 을", section: ["tax"] }, "glossary");
  w.noPlain = await insert("glossary_terms", { term: `${M}병`, plain: null, jargon: false, section: ["finance"], visible: true }, "glossary");
  w.reporter = await insert("people", { slug: `it-glossary-${RUN}`, name: "용어 통합 기자", roles: ["reporter"], visibility: "public" }, "people");
  w.article = await insert(
    "articles",
    {
      slug: `it-glossary-${RUN}`,
      title: `${M} 시험 기사`,
      section: "tax",
      content_type: "explainer",
      status: "published",
      author_id: w.reporter.id,
      body: JSON.stringify({ blocks: [{ type: "paragraph", text: `${M}갑과 ${M}을과 ${M}병이 나오는 문단` }], claims: [] }),
    },
    "articles",
  );
  api = await import("./index.ts");
});

afterAll(async () => {
  if (!db) return;
  await db.query("begin");
  try {
    if (savedFlags !== undefined) await db.query("update public.settings set value = $1 where key = 'feature_flags'", [JSON.stringify(savedFlags)]);
    await db.query("delete from public.articles where id = any($1::bigint[])", [made.articles]);
    await db.query("delete from public.glossary_terms where id = any($1::bigint[])", [made.glossary]);
    await db.query("delete from public.people where id = any($1::bigint[])", [made.people]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  } finally {
    await db.end();
  }
});

describe("기능 키 glossary 꺼짐 (공개 승인 전)", () => {
  test("색인·용어 쪽은 null(404) — 공개 용어여도", async () => {
    await setGlossaryFlag(false);
    expect(await api.getGlossaryIndex(null)).toBeNull();
    expect(await api.getGlossaryTerm(Number(w.shown.id))).toBeNull();
  });
  test("기사 툴팁 용어 — 공개 용어 가운데 쉬운 풀이가 있는 것만, 용어사전 링크 0", async () => {
    await setGlossaryFlag(false);
    const a = await api.getArticleDetail(w.article.slug);
    const mine = a.glossary.filter((t) => t.term.startsWith(M));
    expect(mine).toEqual([{ id: Number(w.shown.id), term: `${M}갑`, plain: "시험용 풀이 갑", href: null }]);
  });
  test("검색 결과의 용어는 링크 0", async () => {
    await setGlossaryFlag(false);
    const r = await api.searchSite({ q: `${M}갑`, tab: "glossary", section: null, contentType: null, region: null, from: null, to: null, page: 1 });
    expect(r.items.map((i) => [i.ref, i.href])).toEqual([[String(w.shown.id), null]]);
  });
});

describe("기능 키 glossary 켜짐", () => {
  test("색인 — 공개 용어만(숨긴 용어 0), 같은 묶음, 관련 용어는 공개 용어만 링크", async () => {
    await setGlossaryFlag(true);
    const v = await api.getGlossaryIndex(null);
    const ids = indexIds(v);
    expect(ids).toContain(Number(w.shown.id));
    expect(ids).toContain(Number(w.noPlain.id));
    expect(ids).not.toContain(Number(w.hidden.id));
    const entry = v.groups.flatMap((g) => g.entries).find((e) => e.id === Number(w.shown.id));
    expect(entry).toMatchObject({ plain: "시험용 풀이 갑", definition: "시험용 뜻 갑", href: `/glossary/${w.shown.id}`, anchor: `term-${w.shown.id}` });
    expect(entry.related).toEqual([
      { label: `${M}을`, href: null },
      { label: `${M}병`, href: `#term-${w.noPlain.id}` },
    ]);
  });
  test("분야 거르개 — 지방세면 개발금융 용어 0", async () => {
    await setGlossaryFlag(true);
    const v = await api.getGlossaryIndex("tax");
    expect(indexIds(v)).toContain(Number(w.shown.id));
    expect(indexIds(v)).not.toContain(Number(w.noPlain.id));
    expect(v.tabs.map((t) => t.id)).toEqual(expect.arrayContaining(["all", "tax", "finance"]));
  });
  test("용어 쪽 — 공개 용어는 보기 값, 숨긴 용어·없는 번호는 null", async () => {
    await setGlossaryFlag(true);
    expect(await api.getGlossaryTerm(Number(w.shown.id))).toMatchObject({ id: Number(w.shown.id), term: `${M}갑`, indexHref: `/glossary#term-${w.shown.id}` });
    expect(await api.getGlossaryTerm(Number(w.hidden.id))).toBeNull();
    expect(await api.getGlossaryTerm(999999999)).toBeNull();
  });
  test("툴팁 '용어사전에서 보기'·검색 결과 링크 = 용어 쪽", async () => {
    await setGlossaryFlag(true);
    const a = await api.getArticleDetail(w.article.slug);
    expect(a.glossary.filter((t) => t.term.startsWith(M)).map((t) => t.href)).toEqual([`/glossary/${w.shown.id}`]);
    const r = await api.searchSite({ q: `${M}갑`, tab: "glossary", section: null, contentType: null, region: null, from: null, to: null, page: 1 });
    expect(r.items.map((i) => i.href)).toEqual([`/glossary/${w.shown.id}`]);
  });
  test("숨긴 용어를 공개로 바꾸면 다음 읽기부터 색인·툴팁에 보인다", async () => {
    await setGlossaryFlag(true);
    await db.query("update public.glossary_terms set visible = true where id = $1", [w.hidden.id]);
    expect(indexIds(await api.getGlossaryIndex(null))).toContain(Number(w.hidden.id));
    const a = await api.getArticleDetail(w.article.slug);
    expect(a.glossary.map((t) => t.id)).toContain(Number(w.hidden.id));
    await db.query("update public.glossary_terms set visible = false where id = $1", [w.hidden.id]);
  });
});
