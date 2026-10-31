// 이번 주 카드뉴스 초안 만들기 통합 시험 — 로컬 Supabase(PostgREST·DB 함수 article_stats_totals)에 service_role로 실제로 읽고 쓴다.
// 다른 시험 행과 겹치지 않게 아주 먼 주(2031년 1월)에 공개 기사·시간 단위 집계를 넣고, 초안 기사·첫 수정 이력·감사 로그를 DB에서 확인한다.
//  · 조회 순 3건 (카드뉴스 기사·8일 전 기사·초안 기사는 조회가 많아도 빠짐) · 같은 날 두 번째는 slug -2
//  · 집계 행이 없으면 최신 순 + "조회수 기록이 없어 최신 순으로 골랐습니다" · 기사가 3건 미만인 주는 422 + 한국어 이유, 기사 행 0
// 만든 계정·인물·기사·집계·수정 이력·감사 로그는 끝나면 지운다 (추가만 되는 표는 트리거를 끈 세션으로). 로컬 DB에서만 돈다.
// 실행: pnpm --filter @ltr/web test:integration (scripts/ci/db-e2e.sh)
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
// 2031-01-12(일) 12:00 KST
const NOW = new Date("2031-01-12T03:00:00.000Z");
const H = 3_600_000;
const D = 24 * H;
const at = (ms) => new Date(NOW.getTime() - ms).toISOString();

let db;
let sb;
let mod;
let userId;
let personId;
const made = { articles: [] };
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

async function article(label, { ago, status = "published", format = "general", section = "tax" }) {
  const row = await one(
    `insert into public.articles (slug, title, summary, section, content_type, status, author_id, format, first_published_at)
     values ($1, $2, $3, $4, 'explainer', $5, $6, $7, $8) returning id`,
    [`it-wcn-${label}-${RUN}`, `주간 카드 ${label} ${RUN}`, `요약 ${label}`, section, status, personId, format, status === "published" ? at(ago) : null],
  );
  a[label] = Number(row.id);
  made.articles.push(a[label]);
  return a[label];
}

/** 시간 단위 집계 한 행 — 사람 조회 views (UTC 정시) */
async function views(id, hourAgo, n) {
  const hour = new Date(Math.floor((NOW.getTime() - hourAgo * H) / H) * H).toISOString();
  await db.query("insert into public.article_stats (article_id, hour, views_all, views_human) values ($1, $2, $3, $3)", [id, hour, n]);
}

const draftRow = (id) => one("select slug, title, status, format, content_type, section, author_id, body, lead_media_id from public.articles where id = $1", [id]);

beforeAll(async () => {
  const s = localSupabase();
  process.env.NEXT_PUBLIC_SUPABASE_URL = s.API_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = s.ANON_KEY;
  db = new pg.Client({ connectionString: s.DB_URL });
  await db.connect();
  sb = createClient(s.API_URL, s.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const u = await sb.auth.admin.createUser({ email: `it-wcn-${RUN}@example.test`, password: `It-${RUN}-pw!9`, email_confirm: true });
  if (u.error) throw u.error;
  userId = u.data.user.id;
  personId = Number((await one("insert into public.people (slug, name, roles, visibility, staff_user_id) values ($1, '주간 카드 시험 기자', '{reporter}', 'public', $2) returning id", [`it-wcn-${RUN}`, userId])).id);

  await article("p1", { ago: 1 * D });
  await article("p2", { ago: 2 * D, section: "realestate" });
  await article("p3", { ago: 3 * D, section: "realestate" });
  await article("p4", { ago: 4 * D });
  await article("card", { ago: 1 * D, format: "cardnews" });
  await article("old", { ago: 8 * D });
  await article("draft", { ago: 0, status: "draft" });
  await views(a.p1, 10, 5);
  await views(a.p2, 30, 30);
  await views(a.p2, 40, 20);
  await views(a.p3, 50, 20);
  await views(a.card, 5, 999);
  await views(a.old, 190, 999);
  await views(a.draft, 2, 999);
  mod = await import("./weekly-cardnews-draft.ts");
});

afterAll(async () => {
  if (!db) return;
  const ids = made.articles;
  await db.query("begin");
  await db.query("set local session_replication_role = replica");
  await db.query("delete from public.audit_logs where actor = $1", [`user:${userId}`]);
  await db.query("delete from public.article_revisions where article_id = any($1::bigint[])", [ids]);
  await db.query("delete from public.seo_checks where target_type = 'article' and target_id = any($1::text[])", [ids.map(String)]);
  await db.query("delete from public.article_stats where article_id = any($1::bigint[])", [ids]);
  await db.query("delete from public.articles where id = any($1::bigint[])", [ids]);
  await db.query("delete from public.people where id = $1", [personId]);
  await db.query("commit");
  if (userId) await sb.auth.admin.deleteUser(userId);
  await db.end();
});

describe("이번 주 카드뉴스 초안 만들기", () => {
  test("조회 순 3건으로 카드뉴스 5장 초안 — 작성자 = 계정의 인물, 상태 초안, 첫 수정 이력·감사 로그 1건", async () => {
    const r = await mod.createWeeklyCardNewsDraft(sb, { userId }, { now: NOW, siteBase: "https://news.example.test" });
    made.articles.push(r.article.id);
    expect(r.mode).toBe("views");
    expect(r.note).toBe("지난 7일 사람 조회 수가 많은 순으로 골랐습니다");
    expect(r.range).toBe("2031.01.05 ~ 01.12");
    expect(r.picked.map((p) => [p.id, p.views])).toEqual([[a.p2, 50], [a.p3, 20], [a.p1, 5]]);

    const row = await draftRow(r.article.id);
    expect(row).toMatchObject({ slug: "weekly-cardnews-20310112", status: "draft", format: "cardnews", content_type: "explainer", section: "realestate", author_id: String(personId), lead_media_id: null });
    const slides = row.body.blocks.filter((b) => b.type === "slide");
    expect(slides.map((b) => b.title)).toEqual(["이번 주 지방세·부동산 소식 3", `주간 카드 p2 ${RUN}`, `주간 카드 p3 ${RUN}`, `주간 카드 p1 ${RUN}`, "더 많은 소식은 사이트에서 읽을 수 있습니다"]);
    expect(slides[1].text).toBe(`요약 p2\n기사 보기: https://news.example.test/news/it-wcn-p2-${RUN}`);

    expect((await one("select count(*)::int n from public.article_revisions where article_id = $1", [r.article.id])).n).toBe(1);
    const audit = await one("select action, reason, after from public.audit_logs where actor = $1 and target = $2", [`user:${userId}`, `articles:${r.article.id}`]);
    expect(audit.action).toBe("article.create");
    expect(audit.reason).toBe("이번 주 카드뉴스 초안 만들기 (2031.01.05 ~ 01.12) — 지난 7일 사람 조회 수가 많은 순으로 골랐습니다");
    expect(audit.after.weeklyCardNews.picked.map((p) => p.id)).toEqual([a.p2, a.p3, a.p1]);
  });

  test("집계 행이 없으면 최신 순으로 고르고 그렇게 알린다 — 같은 날 두 번째 초안은 slug에 -2", async () => {
    await db.query("delete from public.article_stats where article_id = any($1::bigint[])", [made.articles]);
    const r = await mod.createWeeklyCardNewsDraft(sb, { userId }, { now: NOW, siteBase: null });
    made.articles.push(r.article.id);
    expect(r.mode).toBe("latest");
    expect(r.note).toBe("조회수 기록이 없어 최신 순으로 골랐습니다");
    expect(r.picked.map((p) => p.id)).toEqual([a.p1, a.p2, a.p3]);
    expect((await draftRow(r.article.id)).slug).toBe("weekly-cardnews-20310112-2");
  });

  test("기사가 3건보다 적은 주는 422와 한국어 이유 — 기사 행을 만들지 않는다", async () => {
    const before = (await one("select count(*)::int n from public.articles where author_id = $1", [personId])).n;
    const later = new Date(NOW.getTime() + 30 * D);
    await expect(mod.createWeeklyCardNewsDraft(sb, { userId }, { now: later, siteBase: null })).rejects.toMatchObject({
      status: 422,
      message: "지난 7일(2031.02.04 ~ 02.11) 동안 발행한 기사가 0건이라 카드뉴스를 만들 수 없습니다 — 표지·기사·마무리 5장을 채우려면 기사가 3건 있어야 합니다",
    });
    expect((await one("select count(*)::int n from public.articles where author_id = $1", [personId])).n).toBe(before);
  });

  test("계정에 연결된 인물이 없으면 409 — 기사 행 0", async () => {
    await expect(mod.createWeeklyCardNewsDraft(sb, { userId: "00000000-0000-4000-8000-000000000000" }, { now: NOW, siteBase: null })).rejects.toMatchObject({ status: 409 });
  });
});
