import "server-only";
import { publicDb, rowsOf } from "./db";
import { readArticleList } from "./reads";
import {
  EMPTY_REGIONAL_OFFICIAL,
  REGIONAL_ARTICLE_TYPES,
  REGION_OFFICIAL_LIMITS,
  REVIEWED_EXPLAINER_TYPES,
  regionalOfficial,
  type CardArticle,
  type RegionSourceRow,
  type RegionalOfficial,
} from "./region-official-logic";
import { SOURCE_COLUMNS, num } from "./rows";

// 지자체 허브 ⑤ 공식 자료/해설·지역 세금 연결 블록의 읽기 (W4 9단계 — 규칙은 region-official-logic.ts). 공개 데이터 함수라 anon 키로만 읽는다:
//  · 공개 지역 기사(public_articles — 지역 태그 + 편집 분야, 광고·금주 핫뉴스 제외) 최근 50건 → 그 기사들의 공식 자료 출처(article_sources — 공개 기사의 행만, RLS)
//    → 열린 원문 검수 표시(뷰 public_source_reviews — 6단계)
//  · 최근 해설·가이드 30건 → 감수 표시(뷰 article_review_marks — W3 7단계, 서명 기록으로만 계산)
// 새 표·뷰를 읽지 않는다 — 모두 마이그레이션 …08·…35·…41·…42의 공개 읽기 그대로 (원격에 이미 있다).
// codes = null이면 전국(/local — 지역 태그가 있는 모든 공개 지역 기사).

const SOURCE_READ_COLUMNS = `${SOURCE_COLUMNS}, snapshot_id`;

export async function readRegionalOfficial(codes: readonly string[] | null): Promise<RegionalOfficial> {
  if (codes !== null && codes.length === 0) return EMPTY_REGIONAL_OFFICIAL;
  const db = publicDb();
  let pool = db
    .from("public_articles")
    .select("id, slug, title")
    .in("content_type", [...REGIONAL_ARTICLE_TYPES])
    .not("editorial_field", "is", null);
  pool = codes === null ? pool.filter("region_codes", "neq", "{}") : pool.overlaps("region_codes", [...codes]);
  const [articleRows, explainers] = await Promise.all([
    rowsOf<{ id: number; slug: string; title: string }>(
      pool.order("first_published_at", { ascending: false }).order("id", { ascending: false }).limit(REGION_OFFICIAL_LIMITS.articlePool),
      "지역 공식 자료 기사",
    ),
    readArticleList(db, {
      ...(codes === null ? { regionTagged: true } : { regionCodes: codes }),
      contentTypes: REVIEWED_EXPLAINER_TYPES,
      hasEditorialField: true,
      limit: REGION_OFFICIAL_LIMITS.explainerPool,
    }),
  ]);
  const articles = new Map<number, CardArticle>(articleRows.map((a) => [num(a.id), { id: num(a.id), title: a.title, href: `/news/${a.slug}` }]));
  const ids = [...articles.keys()];
  const explainerIds = explainers.items.map((a) => a.id);
  const [sources, reviews, marks] = await Promise.all([
    ids.length
      ? rowsOf<RegionSourceRow>(db.from("article_sources").select(SOURCE_READ_COLUMNS).in("article_id", ids).in("kind", ["official_doc", "dataset"]).order("id"), "지역 공식 자료")
      : Promise.resolve([]),
    ids.length ? rowsOf<{ source_id: number }>(db.from("public_source_reviews").select("source_id").in("article_id", ids), "지역 공식 자료 검토 중") : Promise.resolve([]),
    explainerIds.length
      ? rowsOf<{ article_id: number }>(db.from("article_review_marks").select("article_id").in("article_id", explainerIds).eq("state", "shown"), "감수 해설 표시")
      : Promise.resolve([]),
  ]);
  return regionalOfficial({
    sources,
    articles,
    reviewing: new Set(reviews.map((r) => num(r.source_id))),
    explainerPool: explainers.items,
    shown: new Set(marks.map((m) => num(m.article_id))),
  });
}
