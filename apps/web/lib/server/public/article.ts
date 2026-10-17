import "server-only";
import { brand } from "@ltr/ui";
import type { ArticleView, RenderedFacts } from "@ltr/structured-data";
import { isoToKstDate } from "@/lib/admin/form-utils";
import { readStoredBody, readStoredSolvedCase, readStoredTaxLens, type StoredBlock } from "../articles/content";
import { absolute, renderedFacts, toArticleView } from "../articles/mapping";
import { siteUrl } from "../env";
import {
  blockMediaIds,
  publicBio,
  correctionEntries,
  publicBlocks,
  reporterKind,
  selectNextActions,
  selectRelated,
  selectSimilarCases,
  shareDescription,
  solvedCaseView,
  splitCardNews,
  sponsorMark,
  stageBanner,
  taxLensSlot,
  updateEntries,
  type ActionTargets,
  type CorrectionEntry,
  type NextAction,
  type SimilarCase,
  type SlideView,
  type SolvedCaseView,
  type SponsorMark,
  type TaxLensView,
  type UpdateEntry,
} from "./article-logic";
import { regionLabel, sponsorBadgeOf, trackerState, type ArticleListItem, type TrackerState } from "./cards";
import { CONTENT_TYPE_NAMES, LIMITS, POLICY_LINKS, SECTION_INFO, amendmentHref, categoryHref, isSectionKey, personHref, situationHref, type SectionKey } from "./constants";
import { publicDb, rowsOf } from "./db";
import { readArticleList, readCategories, readPublicSettings, readRegions } from "./reads";
import {
  AMENDMENT_COLUMNS,
  AMENDMENT_EVENT_COLUMNS,
  ARTICLE_DETAIL_COLUMNS,
  CORRECTION_COLUMNS,
  MEDIA_COLUMNS,
  PARTNER_COLUMNS,
  PERSON_COLUMNS,
  REVISION_COLUMNS,
  SOURCE_COLUMNS,
  num,
  type AmendmentEventRow,
  type AmendmentRow,
  type CorrectionRow,
  type PublicArticleRow,
  type PublicMediaRow,
  type PublicPartnerRow,
  type PublicPersonRow,
  type PublicSourceRow,
  type RevisionRow,
} from "./rows";

// 기사 상세 보기 모양 (ART-02~06 · CAT-04 · CAT-05 · TX-08 · CORE-01) — docs/dev/W2-b_설계.md 5장. 4단계 화면이 이 값만으로 그린다.
// 화면 제목·저자·날짜·대표 이미지·JSON-LD는 편집국 점검과 같은 함수(toArticleView·renderedFacts)에서 나온다 (OPT-02).
// 이미지 주소는 화면과 JSON-LD가 같은 함수(absolute)로 만든다 — 대표 이미지 주소가 갈라지지 않게.

export interface ArticleMedia {
  id: number;
  src: string;
  alt: string;
  credit: string | null;
}

export interface ArticleDetail {
  id: number;
  slug: string;
  version: number;
  section: SectionKey;
  sectionName: string;
  sectionHref: string;
  subsection: { name: string; slug: string; href: string } | null;
  contentType: string | null;
  typeLabel: string | null;
  format: string | null;
  sponsorBadge: string | null;
  /** 표기 — 목록 카드와 같은 배지 (광고 = 유형 배지 '광고', 공동 기획 = 제휴 배지) */
  sponsor: SponsorMark;
  editorialField: string | null;
  /** 화면 제목 — 표기가 있으면 "[배지] 제목" (ART-10) */
  title: string;
  summary: string;
  /** 칼럼 연재 (ART-04) */
  series: { title: string; episode: number } | null;
  author: { name: string; slug: string; href: string; beat: string | null; bio: string[]; kind: "opinion" | "explainer" | "guide" | "report" } | null;
  firstPublishedAt: string | null;
  substantiveUpdatedAt: string | null;
  legalBasisDate: string | null;
  regionLabel: string | null;
  /** 본문 블록 — 카드뉴스 장은 빼고, 권리 확인되어 읽히는 이미지만 */
  blocks: StoredBlock[];
  /** 카드뉴스 장 (ART-03) — 형식이 카드뉴스일 때만, 아니면 빈 목록 */
  slides: SlideView[];
  /** 본문·대표 이미지 — 번호 → 화면 값 */
  media: Record<number, ArticleMedia>;
  leadImage: ArticleMedia | null;
  /** 해결 사례 카드 (CAT-05) — 4칸·결론·근거가 다 있을 때만 */
  solvedCase: SolvedCaseView | null;
  sources: PublicSourceRow[];
  corrections: CorrectionEntry[];
  updates: UpdateEntry[];
  amendment: { title: string; href: string | null; stage: TrackerState; banner: { stageLabel: string; changedAt: string } | null } | null;
  taxLens: TaxLensView | null;
  /** 면책 — 하위 분야의 면책 대상 값 (ART-02) */
  disclaimer: boolean;
  similarCases: SimilarCase[];
  nextActions: NextAction[];
  related: ArticleListItem[];
  /** 자사 상품 카드 (01C BIZ-03) — 01C 전 null */
  product: null;
  /** 많이 본 기사 (W2-c ART-11) — 전에는 빈 목록 */
  popular: ArticleListItem[];
  policyLinks: { key: string; label: string; href: string }[];
  /** 공유 미리보기 — 카드뉴스는 첫 장 글을 설명으로 (ART-03 '공유 미리보기에 첫 장') */
  share: { title: string; description: string; image: string | null; url: string };
  view: ArticleView;
  facts: RenderedFacts;
}

const SIMILAR_POOL = 20;
const TAG_POOL = 30;

function mediaOf(m: PublicMediaRow, site: string | undefined): ArticleMedia {
  return { id: num(m.id), src: absolute(site, m.path), alt: m.alt ?? "", credit: m.credit ?? m.photographer ?? null };
}

export async function getArticleDetail(slug: string, now: Date = new Date()): Promise<ArticleDetail | null> {
  const db = publicDb();
  const found = await rowsOf<PublicArticleRow>(db.from("public_articles").select(ARTICLE_DETAIL_COLUMNS).eq("slug", slug).limit(1), "기사");
  const a = found[0];
  // 금주 핫뉴스(digest)는 주간 페이지 경로에서 그린다 (ART-02 · 01B LG-01) — 기사 상세 0
  if (!a || !isSectionKey(a.section) || a.content_type === "digest") return null;
  const id = num(a.id);
  const section = a.section;
  const today = isoToKstDate(now.toISOString());
  const site = siteUrl();
  const body = readStoredBody(a.body);
  const lens = readStoredTaxLens(a.tax_lens);
  const mediaIds = [...new Set([...(a.lead_media_id === null ? [] : [String(a.lead_media_id)]), ...blockMediaIds(body.blocks)])];
  // 기자와 「지방세로 읽기」 서명 감수위원 — 공개 인물만 읽힌다(RLS). 비공개 감수위원이면 박스 0 (BR-03)
  const personIds = [...new Set([a.author_id, lens?.reviewed_by ?? null].filter((x): x is number => x !== null).map(num))];

  const [settings, categories, regions, people, partner, media, sources, corrections, revisions, tagRows, situation] = await Promise.all([
    readPublicSettings(),
    readCategories(),
    readRegions(),
    personIds.length ? rowsOf<PublicPersonRow>(db.from("public_people").select(PERSON_COLUMNS).in("id", personIds), "기자") : Promise.resolve([]),
    a.partner_id === null ? Promise.resolve([]) : rowsOf<PublicPartnerRow>(db.from("partners").select(PARTNER_COLUMNS).eq("id", a.partner_id), "제휴사"),
    mediaIds.length ? rowsOf<PublicMediaRow>(db.from("media").select(MEDIA_COLUMNS).in("id", mediaIds.map(Number)), "이미지") : Promise.resolve([]),
    rowsOf<PublicSourceRow>(db.from("article_sources").select(SOURCE_COLUMNS).eq("article_id", id).order("id"), "출처"),
    rowsOf<CorrectionRow>(db.from("article_corrections").select(CORRECTION_COLUMNS).eq("article_id", id), "정정 이력"),
    rowsOf<RevisionRow>(db.from("article_revisions").select(REVISION_COLUMNS).eq("article_id", id), "수정 이력"),
    rowsOf<{ tag_id: number }>(db.from("article_tags").select("tag_id").eq("article_id", id), "태그"),
    rowsOf<{ slug: string }>(db.from("situations").select("slug").contains("article_ids", [id]).order("sort").limit(1), "연결 상황"),
  ]);

  const category = a.category_id === null ? undefined : categories.find((c) => num(c.id) === num(a.category_id));
  const person = a.author_id === null ? undefined : people.find((p) => num(p.id) === num(a.author_id));
  const reviewers = new Map(people.map((p) => [num(p.id), p.name]));
  const partnerRow = partner[0];
  const readable = new Set(media.map((m) => String(m.id)));
  const regionMap = new Map(regions.map((r) => [r.code, r]));

  // 비슷한 사례 후보 — 태그가 겹치는 공개 기사 + 같은 분야 최신 + 같은 분야 해결 사례 (ART-06)
  const tagIds = tagRows.map((t) => num(t.tag_id));
  const shared = new Map<number, number>();
  if (tagIds.length) {
    const overlaps = await rowsOf<{ article_id: number }>(db.from("article_tags").select("article_id").in("tag_id", tagIds).neq("article_id", id).limit(500), "태그 겹침");
    for (const o of overlaps) shared.set(num(o.article_id), (shared.get(num(o.article_id)) ?? 0) + 1);
  }
  const topTagged = [...shared.entries()].sort((x, y) => y[1] - x[1] || y[0] - x[0]).slice(0, TAG_POOL).map(([k]) => k);
  const [tagged, sameSection, solvedCases, sameAmendment, sameCategory, amendmentRows, eventRows] = await Promise.all([
    readArticleList(db, { ids: topTagged, limit: TAG_POOL }),
    readArticleList(db, { section, limit: SIMILAR_POOL }),
    readArticleList(db, { section, subtype: "solved_case", limit: SIMILAR_POOL }),
    a.amendment_id === null ? Promise.resolve({ items: [], total: 0 }) : readArticleList(db, { amendmentId: num(a.amendment_id), limit: LIMITS.related + 1 }),
    a.category_id === null ? Promise.resolve({ items: [], total: 0 }) : readArticleList(db, { categoryId: num(a.category_id), limit: LIMITS.related + 4 }),
    a.amendment_id === null ? Promise.resolve([]) : rowsOf<AmendmentRow>(db.from("amendments").select(AMENDMENT_COLUMNS).eq("id", a.amendment_id), "개정 트래커"),
    a.amendment_id === null
      ? Promise.resolve([])
      : rowsOf<AmendmentEventRow>(db.from("amendment_events").select(AMENDMENT_EVENT_COLUMNS).eq("amendment_id", a.amendment_id), "개정 단계 기록"),
  ]);

  const similarCases = selectSimilarCases({ id, section }, [...solvedCases.items, ...tagged.items, ...sameSection.items], shared);
  const related = selectRelated(
    { id, section, categoryId: a.category_id === null ? null : num(a.category_id), amendmentId: a.amendment_id === null ? null : num(a.amendment_id) },
    [...sameAmendment.items, ...sameCategory.items, ...sameSection.items],
    new Set(similarCases.map((s) => s.id)),
  );

  // 다음 행동 버튼 갈 곳 (ART-06) — SM 계산기는 official_links(01B W3) 설정 주소로만, 그 전에는 없음
  const firstRegion = a.region_codes?.length ? regionMap.get(a.region_codes[0]!) : undefined;
  const sido = firstRegion?.parent_code ? regionMap.get(firstRegion.parent_code) : firstRegion;
  const targets: ActionTargets = {
    situation: situation[0] ? { href: situationHref(situation[0].slug) } : null,
    same_section: { href: category ? categoryHref(section, category.slug) : SECTION_INFO[section].href },
    local_news: firstRegion && sido ? { href: firstRegion === sido ? `/local/${sido.slug}` : `/local/${sido.slug}/${firstRegion.slug}` } : null,
    expert_finder: { href: `/experts?field=${section}` },
    self_calculator: { href: "/calc" },
  };

  const amendment = amendmentRows[0];
  const stage = amendment ? trackerState(eventRows, settings.confirmStage, today) : null;

  const viewSource = {
    article: a,
    author: person ? { name: person.name, slug: person.slug } : null,
    partner: partnerRow ? { name: partnerRow.name } : null,
    media: media.map((m) => ({ id: num(m.id), path: m.path, rights_status: "confirmed" })),
  };
  const view = toArticleView(viewSource, { siteUrl: site, publisherName: brand.productName, now: now.toISOString() });
  const facts = renderedFacts(view);
  const supersededSources = new Set(sources.flatMap((s) => (s.supersedes_id === null ? [] : [num(s.supersedes_id)])));
  const { slides, rest } = splitCardNews(a.format, publicBlocks(body.blocks, readable));
  const mediaViews = Object.fromEntries(media.map((m) => [num(m.id), mediaOf(m, site)]));
  const lead = a.lead_media_id === null ? null : (mediaViews[num(a.lead_media_id)] ?? null);
  const badge = sponsorBadgeOf(a.label, partnerRow?.name);
  const title = facts.title ?? a.title;

  return {
    id,
    slug: a.slug,
    version: a.version,
    section,
    sectionName: SECTION_INFO[section].name,
    sectionHref: SECTION_INFO[section].href,
    subsection: category ? { name: category.name, slug: category.slug, href: categoryHref(section, category.slug) } : null,
    contentType: a.content_type,
    typeLabel: a.content_type ? (CONTENT_TYPE_NAMES[a.content_type] ?? null) : null,
    format: a.format !== "general" ? a.format : null,
    sponsorBadge: badge,
    sponsor: sponsorMark(a.label, partnerRow?.name),
    editorialField: a.editorial_field,
    title,
    summary: a.summary ?? "",
    series: a.content_type === "opinion" && a.series_title && a.series_episode !== null ? { title: a.series_title, episode: Number(a.series_episode) } : null,
    author: person
      ? { name: person.name, slug: person.slug, href: personHref(person.slug), beat: person.beat, bio: publicBio(person.bio_items), kind: reporterKind(a.content_type) }
      : null,
    firstPublishedAt: a.first_published_at,
    substantiveUpdatedAt: a.substantive_updated_at,
    legalBasisDate: a.legal_basis_date,
    regionLabel: regionLabel(a.region_codes ?? [], regionMap),
    blocks: rest,
    slides,
    media: mediaViews,
    leadImage: lead,
    solvedCase: a.subtype === "solved_case" ? solvedCaseView(readStoredSolvedCase(a.solved_case)) : null,
    sources: sources.filter((s) => !supersededSources.has(num(s.id))),
    corrections: correctionEntries(corrections),
    updates: updateEntries(revisions),
    amendment:
      amendment && stage
        ? {
            title: amendment.title,
            href: settings.features.amendments ? amendmentHref(amendment.slug) : null,
            stage,
            banner: stageBanner(stage, { firstPublishedAt: a.first_published_at, substantiveUpdatedAt: a.substantive_updated_at }),
          }
        : null,
    taxLens: taxLensSlot(lens, a.version, a.legal_basis_date, settings.features, reviewers),
    disclaimer: category?.needs_disclaimer === true,
    similarCases,
    nextActions: selectNextActions(settings.nextActionPriority, targets, settings.features),
    related,
    product: null,
    popular: [],
    policyLinks: POLICY_LINKS.filter((p) => settings.features[p.feature]).map((p) => ({ key: p.key, label: p.label, href: p.href })),
    share: { title, description: shareDescription(a.summary ?? "", slides, badge), image: view.mainImage?.url ?? null, url: view.url },
    view,
    facts,
  };
}
