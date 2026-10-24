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
  openBlockLinks,
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
import { CONTENT_TYPE_NAMES, LIMITS, POLICY_LINKS, SECTION_INFO, amendmentHref, categoryHref, isSectionKey, partnerHref, personHref, situationHref, type SectionKey } from "./constants";
import { publicDb, rowsOf } from "./db";
import { linkedAmendments } from "./amendments";
import { approvedBioMap, profilePageIds } from "./brand";
import { readTipTerms } from "./glossary";
import type { TipTerm } from "@/lib/site/glossary-tips";
import { firstPlayableVideo, type MediaView } from "./media-logic";
import { getLensNationalCard } from "./inheritance-gift";
import type { LinkPair } from "./inheritance-gift-logic";
import { readPopularSidebar } from "./rankings";
import { readArticleLinks } from "./regional-links";
import type { RegionalLinkItem } from "./regional-links-logic";
import { readArticleList, readCategories, readPublicSettings, readRegions } from "./reads";
import {
  ARTICLE_DETAIL_COLUMNS,
  CORRECTION_COLUMNS,
  MEDIA_COLUMNS,
  PARTNER_COLUMNS,
  PERSON_COLUMNS,
  REVISION_COLUMNS,
  SOURCE_COLUMNS,
  num,
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

/** 그림 한 장 — 출처(credit, 없으면 촬영자) · 포토 기사 사진마다 촬영자·이용 조건(ART-09) · 원본 크기(알면 img width·height — 자리 확보, 원본 비율) */
export type ArticleMedia = MediaView;

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
  /** 제휴사 (ART-10) — 공개 제휴사가 지정된 기사만. 제휴사 프로필 링크·partner_content_viewed(제휴사) 측정에 쓴다 */
  partner: { id: number; name: string; href: string } | null;
  editorialField: string | null;
  /** 화면 제목 — 표기가 있으면 "[배지] 제목" (ART-10) */
  title: string;
  summary: string;
  /** 칼럼 연재 (ART-04) */
  /** 연재 줄 — 시그니처 연재 회차는 기사 상세 화면이 연재 틀(설정 제목·근거 링크)로 바꿔 넣는다 (W3 8단계) */
  series: { title: string; episode: number; basisHref?: string | null } | null;
  /** href가 null이면 인물 페이지가 없는 사람(동의서 없음·철회 — BR-07) — 이름만 보이고 링크·구조화 데이터 url 0. bio는 증빙 승인 약력만(BR-01) */
  author: { name: string; slug: string; href: string | null; beat: string | null; bio: string[]; kind: "opinion" | "explainer" | "guide" | "report" } | null;
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
  /** 출처 — 대체되지 않은 판만. under_review = 열린 원문 검수 항목이 있음(W4 6단계 REG1-13 — 공개 뷰 public_source_reviews, 화면 '검토 중') */
  sources: (PublicSourceRow & { under_review: boolean })[];
  corrections: CorrectionEntry[];
  updates: UpdateEntry[];
  amendment: { title: string; href: string | null; stage: TrackerState; banner: { stageLabel: string; changedAt: string } | null } | null;
  taxLens: TaxLensView | null;
  /** 「지방세로 읽기」 박스 옆 국세 연결 카드 (FAM-08 · W4 23단계) - 박스 세목에 상속세·증여세가 있고 inheritance_gift가 켜졌을 때만 */
  lensNational: LinkPair | null;
  /** 면책 — 하위 분야의 면책 대상 값 (ART-02) */
  disclaimer: boolean;
  similarCases: SimilarCase[];
  nextActions: NextAction[];
  related: ArticleListItem[];
  /** 확인된 지역 연결 (W4 13단계 — REG1-10) — 편집자가 확인한 연결 중 도착 화면이 지금 열린 것만(기사·공식 원문·지역 허브). 후보 0 */
  links: RegionalLinkItem[];
  /** 자사 상품 카드 (01C BIZ-03) — 01C 전 null */
  product: null;
  /** 많이 본 기사 사이드바 (ART-11) — 지금 보는 기사를 뺀 popular_rules.sidebar_size건, 집계 전이면 빈 목록 */
  popular: ArticleListItem[];
  policyLinks: { key: string; label: string; href: string }[];
  /** 본문 툴팁 용어 (GLO-02 — W2-d 3단계) — 쉬운 풀이가 있는 공개 용어. 화면이 본문 첫 등장에만 붙인다(lib/site/glossary-tips.ts) */
  glossary: TipTerm[];
  /** 공유 미리보기 — 카드뉴스는 첫 장 글을 설명으로 (ART-03 '공유 미리보기에 첫 장') */
  share: { title: string; description: string; image: string | null; url: string };
  view: ArticleView;
  facts: RenderedFacts;
}

const SIMILAR_POOL = 20;
const TAG_POOL = 30;

export function mediaOf(m: PublicMediaRow, site: string | undefined): ArticleMedia {
  return {
    id: num(m.id),
    src: absolute(site, m.path),
    alt: m.alt ?? "",
    credit: m.credit ?? m.photographer ?? null,
    photographer: m.photographer ?? null,
    license: m.license ?? null,
    width: m.width ?? null,
    height: m.height ?? null,
  };
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

  const [settings, categories, regions, people, partner, media, sources, corrections, revisions, tagRows, situation, popular, glossary, reviewing, links] = await Promise.all([
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
    readPopularSidebar(id),
    readTipTerms(),
    // 원문 검수 중인 출처 번호 (W4 6단계 — 마이그레이션 …42 뷰. 기능 키와 상관없이 늘 읽는다)
    rowsOf<{ source_id: number }>(db.from("public_source_reviews").select("source_id").eq("article_id", id), "원문 검수 표시"),
    // 확인된 지역 연결 (W4 13단계 — 마이그레이션 …48 공개 뷰). 읽지 못하면 연결 0(기사 화면은 그대로)
    readArticleLinks(id, now),
  ]);

  const category = a.category_id === null ? undefined : categories.find((c) => num(c.id) === num(a.category_id));
  const person = a.author_id === null ? undefined : people.find((p) => num(p.id) === num(a.author_id));
  // 기자 소개 약력은 증빙 승인 항목만, 인물 페이지 링크는 동의서(profile_page)가 있는 사람만 (W3 7단계 — BR-01·07)
  const [authorBio, authorPages] = person ? await Promise.all([approvedBioMap([num(person.id)]), profilePageIds([num(person.id)])]) : [new Map<number, unknown>(), new Set<number>()];
  const authorHasPage = person ? authorPages.has(num(person.id)) : false;
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
  const [tagged, sameSection, solvedCases, sameAmendment, sameCategory, amendmentRows] = await Promise.all([
    readArticleList(db, { ids: topTagged, limit: TAG_POOL }),
    readArticleList(db, { section, limit: SIMILAR_POOL }),
    readArticleList(db, { section, subtype: "solved_case", limit: SIMILAR_POOL }),
    a.amendment_id === null ? Promise.resolve({ items: [], total: 0 }) : readArticleList(db, { amendmentId: num(a.amendment_id), limit: LIMITS.related + 1 }),
    a.category_id === null ? Promise.resolve({ items: [], total: 0 }) : readArticleList(db, { categoryId: num(a.category_id), limit: LIMITS.related + 4 }),
    // 연결된 개정안 — 기사 머리의 단일 지정(amendment_id) + 연결 표 article_amendments (W3 4단계). 공개 개정안만 읽힌다(RLS)
    linkedAmendments(db, id, a.amendment_id === null ? null : num(a.amendment_id)),
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

  // 여러 개정안에 연결되면 배너가 뜨는 것 중 가장 최근에 바뀐 하나(없으면 첫째)를 보인다
  const states = amendmentRows.map((m) => ({ m, s: trackerState(m.events, settings.confirmStage, today) }));
  const withBanner = states
    .filter((x) => stageBanner(x.s, { firstPublishedAt: a.first_published_at, substantiveUpdatedAt: a.substantive_updated_at }))
    .sort((x, y) => Date.parse(y.s.recordedAt ?? "") - Date.parse(x.s.recordedAt ?? ""));
  const picked = withBanner[0] ?? states[0];
  const amendment = picked?.m;
  const stage = picked?.s ?? null;

  // 공동 기획 배지·JSON-LD 표기 제목의 제휴사 이름 = 기사가 들고 있는 배지 이름 — 제휴사가 비공개·계약 종료로 바뀌어도 그대로 (ART-10).
  // 제휴사 프로필 링크·제휴 콘텐츠 측정은 공개 제휴사(partnerRow)만
  const badgeName = a.partner_badge_name;
  const viewSource = {
    article: a,
    author: person ? { name: person.name, slug: authorHasPage ? person.slug : null } : null,
    partner: badgeName ? { name: badgeName } : null,
    media: media.map((m) => ({ id: num(m.id), path: m.path, rights_status: "confirmed" })),
  };
  const view = toArticleView(viewSource, { siteUrl: site, publisherName: brand.operatorName, now: now.toISOString() });
  const facts = renderedFacts(view);
  const supersededSources = new Set(sources.flatMap((s) => (s.supersedes_id === null ? [] : [num(s.supersedes_id)])));
  const underReview = new Set(reviewing.map((r) => num(r.source_id)));
  const { slides, rest } = splitCardNews(a.format, openBlockLinks(publicBlocks(body.blocks, readable), settings.features));
  const mediaViews = Object.fromEntries(media.map((m) => [num(m.id), mediaOf(m, site)]));
  const lead = a.lead_media_id === null ? null : (mediaViews[num(a.lead_media_id)] ?? null);
  const badge = sponsorBadgeOf(a.label, badgeName);
  // 동영상 기사의 공유 이미지는 저장한 썸네일 (SEO-03 '동영상 기사는 저장한 썸네일이 공유 이미지') — 없으면 대표 이미지
  const video = a.format === "video" ? firstPlayableVideo(rest, readable) : null;
  const shareImage = (video?.thumbnailMediaId ? mediaViews[num(video.thumbnailMediaId)]?.src : undefined) ?? view.mainImage?.url ?? null;
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
    sponsor: sponsorMark(a.label, badgeName),
    partner: partnerRow ? { id: num(partnerRow.id), name: partnerRow.name, href: partnerHref(num(partnerRow.id)) } : null,
    editorialField: a.editorial_field,
    title,
    summary: a.summary ?? "",
    series: a.content_type === "opinion" && a.series_title && a.series_episode !== null ? { title: a.series_title, episode: Number(a.series_episode) } : null,
    author: person
      ? { name: person.name, slug: person.slug, href: authorHasPage ? personHref(person.slug) : null, beat: person.beat, bio: publicBio(authorBio.get(num(person.id)) ?? []), kind: reporterKind(a.content_type) }
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
    sources: sources.filter((s) => !supersededSources.has(num(s.id))).map((s) => ({ ...s, under_review: underReview.has(num(s.id)) })),
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
    lensNational: await getLensNationalCard(taxLensSlot(lens, a.version, a.legal_basis_date, settings.features, reviewers)?.topics ?? [], settings.features.inheritance_gift),
    disclaimer: category?.needs_disclaimer === true,
    similarCases,
    nextActions: selectNextActions(settings.nextActionPriority, targets, settings.features),
    related,
    links,
    product: null,
    popular,
    // 정책 링크 7종 + [광고·제휴 문의](page_advertise) — 모두 실제로 열린 기능일 때만 (W2-e 6.4)
    policyLinks: [
      ...POLICY_LINKS.filter((p) => settings.features[p.feature]).map((p) => ({ key: p.key, label: p.label, href: p.href })),
      ...(settings.features.page_advertise ? [{ key: "advertise", label: "광고·제휴 문의", href: "/about/advertise" }] : []),
    ],
    glossary,
    share: { title, description: shareDescription(a.summary ?? "", slides, badge), image: shareImage, url: view.url },
    view,
    facts,
  };
}
