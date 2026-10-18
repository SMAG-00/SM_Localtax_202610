// 많이 본 기사·상담 사례 HOT 공개 읽기 통합 시험 (W2-c 2단계 — ART-11 · HOME-05) — 로컬 Supabase에 anon 키로 읽는다 (RLS가 경계).
// 순위 표(article_rankings)에 공개·비공개 기사 행을 섞어 넣고, 공개 데이터 함수가 공개 기사만 순위 순서대로 주는지 본다.
// 시험 전 순위 행은 기억했다가 끝나면 되돌리고, 이 시험이 만든 기사·인물은 지운다. 로컬 DB에서만 돈다.
// 실행: pnpm --filter @ltr/web test:integration (scripts/ci/db-e2e.sh)
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const W_START = "2026-10-11T00:00:00Z";
const W_END = "2026-10-18T00:00:00Z";

let db;
let mod;
let saved = [];
const made = { articles: [], people: [] };
const a = {};

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
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();

async function article(label, over = {}) {
  const row = await one(
    `insert into public.articles (slug, title, summary, section, content_type, status, author_id, category_id, subtype, solved_case, first_published_at)
     values ($1, $2, '요약', 'tax', 'explainer', $3, $4, $5, $6, $7, $8) returning id`,
    [
      `it-rank-${label}-${RUN}`,
      `순위 통합 ${label}`,
      over.status ?? "published",
      a.reporter,
      over.categoryId ?? null,
      over.solvedCase ? "solved_case" : "general",
      over.solvedCase ? JSON.stringify(over.solvedCase) : null,
      (over.status ?? "published") === "published" ? daysAgo(over.days ?? 3) : null,
    ],
  );
  made.articles.push(Number(row.id));
  a[label] = Number(row.id);
  return a[label];
}

async function rank(list, ids, pinned = []) {
  for (const [i, id] of ids.entries()) {
    await db.query(
      "insert into public.article_rankings (list, rank, article_id, pinned, score, window_start, window_end, computed_at, settings_version) values ($1, $2, $3, $4, $5, $6, $7, '2026-10-18T05:05:00Z', 'it')",
      [list, i + 1, id, pinned.includes(id), 100 - i, W_START, W_END],
    );
  }
}

beforeAll(async () => {
  const sb = localSupabase();
  process.env.NEXT_PUBLIC_SUPABASE_URL = sb.API_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = sb.ANON_KEY;
  db = new pg.Client({ connectionString: sb.DB_URL });
  await db.connect();
  saved = (await db.query("select * from public.article_rankings")).rows;
  await db.query("delete from public.article_rankings");
  const person = await one("insert into public.people (slug, name, roles, visibility) values ($1, '순위 통합 기자', '{reporter}', 'public') returning id", [`it-rank-${RUN}`]);
  made.people.push(Number(person.id));
  a.reporter = Number(person.id);
  const hot = Number((await one("select id from public.categories where section = 'tax' and slug = 'interpretations'")).id);
  const solved = (n) => ({
    situation: `상황 ${n}`,
    issue: "쟁점",
    result: "결과",
    lesson: "교훈",
    resultEvidence: [{ kind: "decision", number: `조심2025지${n}`, url: `https://decisions.example.kr/${n}` }],
    conclusion: "accepted",
  });
  for (let i = 1; i <= 7; i++) await article(`p${i}`, { days: i });
  await article("draft", { status: "draft" });
  await article("held", { days: 1 });
  await article("sc1", { categoryId: hot, solvedCase: solved(1), days: 2 });
  await article("sc2", { categoryId: hot, solvedCase: solved(2), days: 3 });
  for (let i = 1; i <= 3; i++) await article(`g${i}`, { categoryId: hot, days: 10 + i });
  await article("pin", { categoryId: hot, days: 40 });
  // 많이 본 기사: p3 → 초안 → p1 → p7 → p2 → 보류될 기사 → p4 → p5 → p6
  await rank("popular", [a.p3, a.draft, a.p1, a.p7, a.p2, a.held, a.p4, a.p5, a.p6]);
  // HOT: 고정 → g2 → sc2 → g1 (sc1·g3은 점수 0 — 순위 표에 없음)
  await rank("hot", [a.pin, a.g2, a.sc2, a.g1], [a.pin]);
  mod = await import("./rankings.ts");
});

afterAll(async () => {
  if (!db) return;
  await db.query("delete from public.article_rankings where article_id = any($1::bigint[])", [made.articles]);
  await db.query("delete from public.articles where id = any($1::bigint[])", [made.articles]);
  await db.query("delete from public.people where id = any($1::bigint[])", [made.people]);
  for (const r of saved) {
    await db.query(
      "insert into public.article_rankings (list, rank, article_id, pinned, score, window_start, window_end, computed_at, settings_version) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict do nothing",
      [r.list, r.rank, r.article_id, r.pinned, r.score, r.window_start, r.window_end, r.computed_at, r.settings_version],
    );
  }
  await db.end();
});

describe("많이 본 기사 (ART-11)", () => {
  test("/news/popular — 공개 기사만 순위 순서대로, 건수는 popular_rules.list_size, 집계 시각·창 길이", async () => {
    const list = await mod.getPopularList();
    expect(list.items.map((i) => i.id)).toEqual([a.p3, a.p1, a.p7, a.p2, a.held, a.p4, a.p5, a.p6]);
    expect(list.computedAt).toMatch(/^2026-10-18T05:05:00/);
    expect(list.windowHours).toBe(168);
  });

  test("기사 사이드바 — 지금 보는 기사를 빼고 5건 (sidebar_size)", async () => {
    expect((await mod.readPopularSidebar(a.p1)).map((i) => i.id)).toEqual([a.p3, a.p7, a.p2, a.held, a.p4]);
  });

  test("발행 기사를 보류로 바꾸면 다음 집계 전에도 바로 빠진다 (RLS)", async () => {
    await db.query("update public.articles set status = 'held' where id = $1", [a.held]);
    expect((await mod.getPopularList()).items.map((i) => i.id)).not.toContain(a.held);
    expect((await mod.readPopularSidebar(a.p1)).map((i) => i.id)).toEqual([a.p3, a.p7, a.p2, a.p4, a.p5]);
  });
});

describe("상담 사례 HOT (HOME-05)", () => {
  test("해결 사례 카드는 순위의 해결 사례 → 최신 해결 사례로 채움, HOT 목록은 카드 제외·고정 맨 앞·배지, 모자라면 배지 없이 최신 상담 사례", async () => {
    const block = await mod.getHotBlock();
    expect(block.cards.map((c) => c.item.id)).toEqual([a.sc2, a.sc1]);
    expect(block.cards[0].card.result.conclusion).toBe("accepted");
    expect(block.list.map((e) => [e.item.id, e.hot, e.pinned, e.rank])).toEqual([
      [a.pin, true, true, 1],
      [a.g2, true, false, 2],
      [a.g1, true, false, 3],
      [a.g3, false, false, 4],
    ]);
    expect(block.href).toBe("/tax/interpretations");
  });
});
