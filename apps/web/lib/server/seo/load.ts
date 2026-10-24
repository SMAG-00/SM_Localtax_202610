import "server-only";
import { brand } from "@ltr/ui";
import { indexingSwitchProblems, parseNewsSitemapHours, indexnowEnabled } from "@/lib/seo/settings";
import { type ArticleLite, type ImageEntry, type UrlEntry, lastmodOf } from "@/lib/seo/sitemap";
import { siteIndexing, siteUrl } from "../env";
import { publicDb, rowsOf } from "../public/db";
import { parseFeatures } from "../public/settings";
import { SECTION_INFO, categoryHref } from "../public/constants";
import { absolute } from "../articles/mapping";
import { adminClient } from "../supabase";

// 사이트맵·RSS·robots.txt가 읽는 것 (W7 · OPT-01·08). 설정은 service_role로 읽고(크롤러 정책 등은 공개 읽기 목록에 없다), 공개 페이지 목록은 anon 공개 뷰(RLS가 경계)로만 읽는다.
//  · 색인 관문: SITE_INDEXING=on + 사이트 주소 + 크롤러 정책이 갖춰져야 연다. 하나라도 빠지면 닫힌 쪽(robots.txt 전체 차단, 사이트맵·RSS 404).

export interface SeoSettings {
  featureFlags: ReturnType<typeof parseFeatures>;
  crawlerPolicy: unknown;
  newsHours: number;
  indexnow: boolean;
}

export async function loadSeoSettings(): Promise<SeoSettings | null> {
  const db = adminClient();
  if (!db) return null;
  const { data, error } = await db.from("settings").select("key, value").in("key", ["feature_flags", "crawler_policy", "news_sitemap_hours", "indexnow"]);
  if (error) {
    console.error("[seo] 설정을 읽지 못했습니다:", error.code, error.message);
    return null;
  }
  const byKey = new Map((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
  return {
    featureFlags: parseFeatures(byKey.get("feature_flags")),
    crawlerPolicy: byKey.get("crawler_policy"),
    newsHours: parseNewsSitemapHours(byKey.get("news_sitemap_hours")),
    indexnow: indexnowEnabled(byKey.get("indexnow")),
  };
}

export interface IndexingGate {
  open: boolean;
  site: string | undefined;
  settings: SeoSettings | null;
  /** 닫힌 사유 (관리자 전환 점검 화면용) */
  problems: string[];
}

export async function indexingGate(): Promise<IndexingGate> {
  const site = siteUrl();
  const problems: string[] = [];
  if (!siteIndexing()) problems.push("SITE_INDEXING이 on이 아닙니다");
  if (!site) problems.push("사이트 주소(NEXT_PUBLIC_SITE_URL)가 없습니다");
  const settings = await loadSeoSettings();
  if (!settings) problems.push("설정을 읽지 못했습니다");
  else problems.push(...indexingSwitchProblems(settings.crawlerPolicy));
  return { open: problems.length === 0, site, settings, problems };
}

const PAGE = 1000;
async function allRows<T>(read: (from: number, to: number) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>, context: string, max = 200_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const rows = await rowsOf<T>(read(from, from + PAGE - 1) as never, context);
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

const ARTICLE_COLUMNS = "id, slug, title, summary, section, content_type, label, first_published_at, substantive_updated_at, lead_media_id, category_id";
export type ArticleSitemapRow = ArticleLite & { id: number };

/** 공개 기사 전부 — 공개 뷰(발행 + 대표 이미지 권리 확인 + 무료)만 */
export async function loadPublicArticles(): Promise<ArticleSitemapRow[]> {
  const db = publicDb();
  return allRows<ArticleSitemapRow>((a, b) => db.from("public_articles").select(ARTICLE_COLUMNS).order("id").range(a, b), "사이트맵 기사");
}

/** 고정 주소 — 기능 키가 켜진 것만 (닫힌 기능의 주소는 사이트맵에 없다) */
const FIXED_PAGES: ReadonlyArray<{ path: string; feature?: keyof ReturnType<typeof parseFeatures> }> = [
  { path: "/" },
  { path: SECTION_INFO.tax.href },
  { path: SECTION_INFO.realestate.href },
  { path: SECTION_INFO.finance.href },
  { path: SECTION_INFO.local.href },
  { path: "/news" },
  { path: "/tax/amendments", feature: "amendments" },
  { path: "/tax/interpretations", feature: "interpretations" },
  { path: "/glossary", feature: "glossary" },
  { path: "/experts", feature: "experts" },
];

/** 일반 사이트맵 주소 전부 */
export async function loadSitemapEntries(settings: SeoSettings, articles: readonly ArticleSitemapRow[]): Promise<UrlEntry[]> {
  const db = publicDb();
  const [cats, counts, regions, profiles, people, events, experts] = await Promise.all([
    rowsOf<{ id: number; section: string; slug: string }>(db.from("categories").select("id, section, slug"), "사이트맵 하위 분야"),
    rowsOf<{ category_id: number; article_count: number }>(db.from("public_category_article_counts").select("category_id, article_count"), "사이트맵 하위 분야 기사 수"),
    rowsOf<{ path: string; last_published_at: string | null }>(db.from("public_region_index").select("path, last_published_at"), "사이트맵 지역 허브"),
    rowsOf<{ person_id: number }>(db.from("public_profile_pages").select("person_id"), "사이트맵 인물 동의"),
    rowsOf<{ id: number; slug: string }>(db.from("public_people").select("id, slug"), "사이트맵 인물"),
    rowsOf<{ slug: string }>(db.from("public_local_events").select("slug").limit(2000), "사이트맵 행사"),
    rowsOf<{ slug: string }>(db.from("public_expert_profiles").select("slug").limit(500), "사이트맵 전문가"),
  ]);
  const entries: UrlEntry[] = [];
  const seen = new Set<string>();
  const add = (e: UrlEntry) => {
    if (!seen.has(e.path)) {
      seen.add(e.path);
      entries.push(e);
    }
  };
  for (const f of FIXED_PAGES) if (!f.feature || settings.featureFlags[f.feature]) add({ path: f.path });
  const withArticles = new Set(counts.filter((c) => c.article_count > 0).map((c) => c.category_id));
  for (const c of cats) {
    if (withArticles.has(c.id) && (c.section === "tax" || c.section === "realestate" || c.section === "finance")) add({ path: categoryHref(c.section, c.slug) });
  }
  for (const r of regions) add({ path: r.path, ...(r.last_published_at ? { lastmod: new Date(r.last_published_at).toISOString() } : {}) });
  for (const a of articles) add({ path: `/news/${a.slug}`, lastmod: lastmodOf(a) });
  const consented = new Set(profiles.map((p) => p.person_id));
  for (const p of people) if (consented.has(p.id)) add({ path: `/people/${p.slug}` });
  for (const e of events) add({ path: `/local/events/${e.slug}` });
  for (const x of experts) add({ path: `/experts/profile/${x.slug}` });
  return entries;
}

/** 이미지 사이트맵 — 대표 이미지 권리가 확인된 공개 기사만(공개 뷰가 이미 거른다) */
export async function loadImageEntries(articles: readonly ArticleSitemapRow[], site: string): Promise<ImageEntry[]> {
  const ids = [...new Set(articles.flatMap((a) => (a.lead_media_id === null ? [] : [a.lead_media_id])))];
  if (ids.length === 0) return [];
  const db = publicDb();
  const media: { id: number; path: string }[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    media.push(...(await rowsOf<{ id: number; path: string }>(db.from("media").select("id, path").in("id", ids.slice(i, i + 200)), "사이트맵 이미지")));
  }
  const pathOf = new Map(media.map((m) => [Number(m.id), m.path]));
  return articles.flatMap((a) => {
    const path = a.lead_media_id === null ? undefined : pathOf.get(Number(a.lead_media_id));
    return path ? [{ path: `/news/${a.slug}`, imageUrl: absolute(site, path), title: a.title }] : [];
  });
}

export const PUBLICATION_NAME = brand.productName;
