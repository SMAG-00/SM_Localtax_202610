import "server-only";
import { buildShortcuts, parseShortcutCopy } from "./shortcuts-logic";
import { readMemberInterests } from "./member-interests";
import { readShortcutInputs } from "./shortcuts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isoToKstDate } from "@/lib/admin/form-utils";
import { latestChangedTracker, trackerState, type ArticleListItem, type TrackerSource } from "./cards";
import { LIMITS } from "./constants";
import { publicDb, rowsOf } from "./db";
import { activeCurations, closedHomeSections, homeSections, latestReports, pickStories, pickTrackers, type AmendmentsSection, type HomeSection } from "./home-logic";
import { getSignatureHome } from "./signature";
import { getHomeProduct } from "./store";
import { readHubTaxPoints } from "./hub-points";
import { fieldCardPoints } from "./hub-point-logic";
import { readArticleList, readPublicSettings } from "./reads";
import { AMENDMENT_COLUMNS, AMENDMENT_EVENT_COLUMNS, CURATION_COLUMNS, num, type AmendmentEventRow, type AmendmentRow, type CurationRow } from "./rows";
import type { ProgressStageKey } from "@ltr/ui";

// 홈 데이터 (HOME-01 · HOME-03 · HOME-04) — 섹션 순서 고정, 내용 0건 섹션은 빠진다. 금주 핫뉴스(01B W6)·김의효 칼럼·자사 상품·
// 전문가 소개(01C)는 그 작업이 표를 만들면 채운다 — 지금은 숨김.

export interface HomeData {
  /** 판정 기준 한국 날짜 */
  today: string;
  sections: HomeSection[];
  /** 공개 데이터를 읽지 못해 닫힌 홈(4대 분야 카드만)을 보이는 중 — 화면이 짧은 안내를 붙인다 */
  unavailable?: true;
}

/** 닫힌 홈 — 공개 데이터를 읽지 못할 때 공개 홈이 쓴다 (DB가 필요 없는 4대 분야 카드만) */
export function closedHomeData(now: Date = new Date()): HomeData {
  return { today: isoToKstDate(now.toISOString()), sections: closedHomeSections(), unavailable: true };
}

/** 공개 트래커와 단계 기록 → 트래커 상태 (읽을 수 있는 공개 개정안만) */
async function trackerSources(db: SupabaseClient, confirmStage: ProgressStageKey, today: string): Promise<Map<number, TrackerSource>> {
  const amendments = await rowsOf<AmendmentRow>(db.from("amendments").select(AMENDMENT_COLUMNS).order("id", { ascending: false }).limit(200), "개정 트래커");
  if (amendments.length === 0) return new Map();
  const events = await rowsOf<AmendmentEventRow>(
    db.from("amendment_events").select(AMENDMENT_EVENT_COLUMNS).in("amendment_id", amendments.map((a) => num(a.id))),
    "개정 단계 기록",
  );
  const byAmendment = new Map<number, AmendmentEventRow[]>();
  for (const e of events) byAmendment.set(num(e.amendment_id), [...(byAmendment.get(num(e.amendment_id)) ?? []), e]);
  return new Map(amendments.map((a) => [num(a.id), { amendment: a, state: trackerState(byAmendment.get(num(a.id)) ?? [], confirmStage, today) }]));
}

/** 개정 트래커 하이라이트 섹션만 — 홈 배치 화면의 '지금 홈에 보이는 모습'이 같은 함수를 쓴다 */
export async function getHomeAmendments(now: Date = new Date()): Promise<{ today: string; section: AmendmentsSection | null }> {
  const db = publicDb();
  const today = isoToKstDate(now.toISOString());
  const settings = await readPublicSettings();
  const curations = await rowsOf<CurationRow>(db.from("home_curations").select(CURATION_COLUMNS), "홈 배치");
  const trackers = activeCurations(curations, "tracker", today);
  const stories = activeCurations(curations, "story", today);
  const [sources, designatedStories, explainers] = await Promise.all([
    trackerSources(db, settings.confirmStage, today),
    readArticleList(db, { ids: stories.flatMap((s) => (s.article_id === null ? [] : [num(s.article_id)])), limit: LIMITS.storiesMax * 2 }),
    readArticleList(db, { contentType: "explainer", limit: LIMITS.storiesMax + LIMITS.storiesMin }),
  ]);
  const picked = pickTrackers(trackers, sources, latestChangedTracker([...sources.values()]), settings.features);
  const storyCards = pickStories(stories, new Map(designatedStories.items.map((a): [number, ArticleListItem] => [a.id, a])), explainers.items);
  const sections = homeSections({
    coreMessage: null,
    searchEnabled: false,
    searchChips: [],
    latestReports: [],
    weeklyHot: null,
    trackers: picked,
    stories: storyCards,
    column: null,
    product: null,
    experts: null,
  });
  return { today, section: (sections.find((s) => s.key === "amendments") as AmendmentsSection | undefined) ?? null };
}

export async function getHomeData(now: Date = new Date()): Promise<HomeData> {
  const db = publicDb();
  const settings = await readPublicSettings();
  const [latest, amendments, signature, hubPoints, homeProduct] = await Promise.all([
    readArticleList(db, { contentType: "reported_news", reportedApproved: true, limit: LIMITS.homeLatestReports }),
    getHomeAmendments(now),
    // 김의효 칼럼 영역 (BR-04 — W3 8단계): 기능 키 tax_columns + 공개 회차가 있을 때만, 아니면 빈 목록 → 섹션째 숨김
    getSignatureHome(),
    // 4대 분야 카드의 '이 분야의 지방세 포인트' 한 줄 (CORE-02 — W3 9단계): 감수 서명이 있는 분야만
    readHubTaxPoints(),
    getHomeProduct(settings.features),
  ]);
  const shortcutLinks = buildShortcuts(settings.features, await readShortcutInputs(settings.features), settings.shortcutOrder, settings.features.shortcuts ? await readMemberInterests() : []);
  const shortcutCopy = parseShortcutCopy(settings.shortcutCopy);
  const sections = homeSections({
    shortcuts: shortcutLinks.map((s) => ({ key: s.key, label: s.label, href: s.href, note: shortcutCopy[s.key] ?? null })),
    coreMessage: settings.coreMessage,
    coreHighlights: settings.coreHighlights,
    fieldPoints: fieldCardPoints(hubPoints),
    searchEnabled: settings.features.search,
    searchChips: settings.searchChips,
    latestReports: latestReports(latest.items),
    weeklyHot: null,
    trackers: amendments.section
      ? { items: amendments.section.trackers, source: amendments.section.trackerSource }
      : { items: [], source: "none" },
    stories: amendments.section?.stories ?? [],
    column: signature.length ? { key: "column", items: signature } : null,
    // 자사 상품 카드 1개 (BIZ-03 · W8): 승인된 홈 연결이 있을 때만, 없으면 섹션째 숨김. 기능 키 store 꺼짐이면 DB를 읽지 않는다
    product: homeProduct ? { key: "product", product: { id: homeProduct.id, title: homeProduct.title, href: homeProduct.detailHref, summary: homeProduct.summary, adPolicyHref: homeProduct.adPolicyHref } } : null,
    experts: null,
  });
  return { today: amendments.today, sections };
}
