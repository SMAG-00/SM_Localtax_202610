import "server-only";
import { isoToKstDate } from "@/lib/admin/form-utils";
import { siteUrl } from "../env";
import { getSmCalculatorCard, type OfficialLinkCard } from "./calc";
import type { ArticleListItem } from "./cards";
import { readColumnInterestLines } from "./column-disclosure";
import { publicDb, rowsOf } from "./db";
import { readArticleList, readPublicSettings, readRegions } from "./reads";
import {
  NO_FILTER,
  PROJECT_PUBLIC_LIMITS,
  PUBLIC_PROJECT_COLUMNS,
  PUBLIC_PROJECT_EVENT_COLUMNS,
  PUBLIC_STAGE_LENS_COLUMNS,
  STAGE_LIST_COLUMNS,
  filterProjects,
  hubProjectCards,
  projectBreadcrumb,
  projectCard,
  projectCrumbs,
  projectFilterChips,
  projectListHref,
  projectRegion,
  projectTimeline,
  relatedArticleIds,
  sortProjects,
  sourceCoverage,
  stageLensMap,
  type ProjectCard,
  type ProjectCrumb,
  type ProjectFilter,
  type ProjectFilterChips,
  type ProjectLinkRow,
  type PublicProjectEventRow,
  type PublicProjectRow,
  type PublicStageLensRow,
  type StageLensView,
  type StageListRow,
  type TimelineStage,
} from "./project-logic";
import { readLinkItems, safeLinkItems } from "./regional-links";
import { readProjectSupply } from "./supply";
import type { SupplyCard } from "./supply-logic";
import type { PublicLinkRow, RegionalLinkItem } from "./regional-links-logic";
import type { BreadcrumbView } from "@ltr/structured-data";
import type { RegionRow } from "./rows";

// 프로젝트 공개 화면 데이터 (W4 15단계 — 규칙은 project-logic.ts). 공개 뷰만 anon 키로 읽는다:
// public_projects(공개 프로젝트 + 공개 단계 1건 이상) · public_project_events(정정되지 않은 공개 기록 — 링크만) · public_project_stage_lists(전체 단계 목록 — …49) ·
// public_regional_links(확인된 연결 — 두 끝이 지금 공개). 기능 키 realestate_projects가 꺼져 있으면 null → 상세 404·목록은 하위 분야 목록(W3 12장 #20과 같은 방식).
// 16단계: public_project_stage_lenses(서명이 살아 있는 단계별 「지방세로 읽기」 — …50)와 SM 취득세 카드(official_links — 기능 키 sm_calculator·주소가 있을 때만).
// 둘 다 읽지 못하면 박스·카드 0으로 그리고 서버 기록에만 남긴다(프로젝트 화면은 그대로 — 12장 #109와 같은 방식).
// 17단계: public_supply_notices(그 프로젝트에 이은 공개 분양 정보 — …51, 기능 키 supply_notices). 읽지 못하면 0으로 그린다(같은 방식).

export interface ProjectListView {
  today: string;
  filter: ProjectFilter;
  /** 거른 카드 (목록 차례) */
  items: ProjectCard[];
  /** 공개 프로젝트 전체 수 (거르기 전) */
  total: number;
  chips: ProjectFilterChips;
  crumbs: ProjectCrumb[];
  breadcrumb: BreadcrumbView | null;
  /** 데이터 출처 줄 — 보이는 카드의 출처(겹침 0)·가장 이른 기준일(현재 단계 고시일)·가장 이른 정보 확인일 */
  sourceLine: { source: string; baseDate: string; checkedAt: string } | null;
}

export interface ProjectDetailView {
  today: string;
  card: ProjectCard;
  timeline: TimelineStage[];
  coverage: { recorded: number; linked: number };
  /** 관련 기사 — 확인된 연결(프로젝트 → 기사 · 기사 → 프로젝트), 공개 기사만 */
  articles: ArticleListItem[];
  /** 관련 칼럼 (21단계 — PR-14) — 같은 연결의 칼럼(opinion)만. 부동산 칼럼은 칼럼 머리와 같은 조합·시공사·신탁사 자문 줄이 붙는다(기능 키 tax_columns 켜짐일 때) */
  columns: { item: ArticleListItem; interestLine: string | null }[];
  /** 확인된 연결 — 공식 원문·다른 프로젝트·지역 허브 (기사는 관련 기사 자리) */
  links: RegionalLinkItem[];
  crumbs: ProjectCrumb[];
  breadcrumb: BreadcrumbView | null;
  /** 단계 키 → 단계별 「지방세로 읽기」 박스 (서명된 템플릿만 — 없는 단계는 키 없음) */
  lenses: Record<string, StageLensView>;
  /** 박스 옆 SM 취득세 카드 (공용 카드 — 기능 키 sm_calculator가 켜지고 주소가 있을 때만, 끊김이면 대체 안내) */
  sm: { card: OfficialLinkCard; fallbacks: OfficialLinkCard[] } | null;
  /** 분양 정보 (17단계 — 그 프로젝트에 이은 공개 항목, 청약이 끝난 항목도 기록. 기능 키 supply_notices 꺼짐 → 빈 목록) */
  supply: SupplyCard[];
}

/** 읽기 실패를 0으로 — 박스·카드는 화면의 덧붙임이라 프로젝트 화면을 막지 않는다 */
async function orEmpty<T>(where: string, load: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await load();
  } catch (err) {
    console.error(`[public] 프로젝트 화면 ${where}을(를) 읽지 못해 0으로 그립니다:`, err instanceof Error ? err.message : String(err));
    return empty;
  }
}

const kstToday = (now: Date) => isoToKstDate(now.toISOString());
/** 박스 옆 SM 계산기 카드 키 — 취득세 (1장 16단계 'SM 취득세 카드(공용 카드)' · 12장 #25와 같은 카드) */
export const LENS_SM_KEY = "acquisition";

/** 공개 프로젝트 줄 → 카드 (지역 이름·허브 주소를 붙여) — 카드 칸이 빈 줄은 빠진다 */
function cardsOf(rows: readonly PublicProjectRow[], regions: readonly RegionRow[], today: string, hubsOpen: boolean): ProjectCard[] {
  return rows.flatMap((r) => projectCard(r, projectRegion(r.region_code, regions, today, hubsOpen)) ?? []);
}

/** 출처 줄 — 출처 이름(겹침 0, 차례대로 '·')·가장 이른 기준일·가장 이른 정보 확인일 (지역 허브 데이터 출처 줄과 같은 방식 — REG-10) */
function listSourceLine(cards: readonly ProjectCard[]): { source: string; baseDate: string; checkedAt: string } | null {
  if (!cards.length) return null;
  const earliest = (xs: string[]) => xs.reduce((a, b) => (b < a ? b : a));
  return { source: [...new Set(cards.map((c) => c.source))].join(" · "), baseDate: earliest(cards.map((c) => c.stage.noticeDate)), checkedAt: earliest(cards.map((c) => c.verifiedOn)) };
}

export async function getProjectList(filter: ProjectFilter = NO_FILTER, now: Date = new Date()): Promise<ProjectListView | null> {
  const settings = await readPublicSettings();
  if (!settings.features.realestate_projects) return null;
  const db = publicDb();
  const today = kstToday(now);
  const [rows, regions, lists] = await Promise.all([
    rowsOf<PublicProjectRow>(db.from("public_projects").select(PUBLIC_PROJECT_COLUMNS).order("id", { ascending: false }).limit(PROJECT_PUBLIC_LIMITS.list), "공개 프로젝트"),
    readRegions(),
    rowsOf<StageListRow>(db.from("public_project_stage_lists").select(STAGE_LIST_COLUMNS), "프로젝트 단계 목록"),
  ]);
  const all = sortProjects(cardsOf(rows, regions, today, settings.features.region_hubs));
  const items = filterProjects(all, filter);
  const crumbs = projectCrumbs();
  return { today, filter, items, total: all.length, chips: projectFilterChips(all, filter, regions, lists), crumbs, breadcrumb: projectBreadcrumb(crumbs, siteUrl()), sourceLine: listSourceLine(items) };
}

export async function getProject(slug: string, now: Date = new Date()): Promise<ProjectDetailView | null> {
  const settings = await readPublicSettings();
  if (!settings.features.realestate_projects) return null;
  const db = publicDb();
  const today = kstToday(now);
  const [row] = await rowsOf<PublicProjectRow>(db.from("public_projects").select(PUBLIC_PROJECT_COLUMNS).eq("slug", slug).limit(1), "공개 프로젝트");
  if (!row) return null;
  const id = Number(row.id);
  const [regions, events, lists, fromRows, toRows, lensRows, sm, supply] = await Promise.all([
    readRegions(),
    rowsOf<PublicProjectEventRow>(db.from("public_project_events").select(PUBLIC_PROJECT_EVENT_COLUMNS).eq("project_id", id).order("stage_position").order("id"), "프로젝트 단계 기록"),
    rowsOf<StageListRow>(db.from("public_project_stage_lists").select(STAGE_LIST_COLUMNS).eq("project_type", row.project_type).order("stage_position"), "프로젝트 단계 목록"),
    rowsOf<PublicLinkRow>(
      db.from("public_regional_links").select("id, from_type, from_id, to_type, to_id, relation, confirmed_at").eq("from_type", "project").eq("from_id", String(id)).order("confirmed_at", { ascending: false }).limit(50),
      "프로젝트 연결",
    ),
    rowsOf<PublicLinkRow>(
      db
        .from("public_regional_links")
        .select("id, from_type, from_id, to_type, to_id, relation, confirmed_at")
        .eq("to_type", "project")
        .eq("to_id", String(id))
        .eq("from_type", "article")
        .order("confirmed_at", { ascending: false })
        .limit(50),
      "프로젝트로 오는 기사 연결",
    ),
    orEmpty(
      "단계별 「지방세로 읽기」",
      () => rowsOf<PublicStageLensRow>(db.from("public_project_stage_lenses").select(PUBLIC_STAGE_LENS_COLUMNS).eq("project_type", row.project_type).order("stage_position"), "단계별 「지방세로 읽기」"),
      [] as PublicStageLensRow[],
    ),
    orEmpty("SM 취득세 카드", () => getSmCalculatorCard(LENS_SM_KEY, settings.features), null),
    orEmpty("분양 정보", () => readProjectSupply(id, now), [] as SupplyCard[]),
  ]);
  const card = projectCard(row, projectRegion(row.region_code, regions, today, settings.features.region_hubs));
  if (!card) return null;
  const timeline = projectTimeline(lists, events);
  const articleIds = relatedArticleIds([...fromRows, ...toRows] as ProjectLinkRow[], id);
  const [articleList, links] = await Promise.all([
    readArticleList(db, { ids: articleIds, limit: PROJECT_PUBLIC_LIMITS.relatedArticles }),
    safeLinkItems("프로젝트 화면", () =>
      readLinkItems(
        fromRows.filter((r) => r.to_type !== "article"),
        now,
      ),
    ),
  ]);
  const order = new Map(articleIds.map((x, i) => [x, i]));
  const sorted = [...articleList.items].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const articles = sorted.filter((a) => a.contentType !== "opinion");
  const columnItems = sorted.filter((a) => a.contentType === "opinion");
  const interestLines = await orEmpty("부동산 칼럼 이해관계 줄", () => readColumnInterestLines(columnItems.map((c) => c.id)), new Map<number, string>());
  const columns = columnItems.map((item) => ({ item, interestLine: interestLines.get(item.id) ?? null }));
  const crumbs = projectCrumbs({ name: card.name, href: card.href });
  const lenses = stageLensMap(lensRows, row.project_type, settings.features);
  return {
    today,
    card,
    timeline,
    coverage: sourceCoverage(timeline),
    articles,
    columns,
    links,
    crumbs,
    breadcrumb: projectBreadcrumb(crumbs, siteUrl()),
    lenses,
    sm: Object.keys(lenses).length > 0 ? sm : null,
    supply,
  };
}

/**
 * 지역 허브 ③ 프로젝트 카드 (12장 #120) — 그 지역 범위(시·도 = 자기 + 하위, 시·군·구 = 자기 — #26)의 공개 프로젝트.
 * 그 지역에서 출발한 확인된 연결의 프로젝트가 먼저. 기능 키가 꺼져 있으면 0장. 더 있으면 목록(지역 거르개) 주소
 */
export async function readRegionProjects(regionCode: string, scopeCodes: readonly string[], now: Date = new Date()): Promise<{ cards: ProjectCard[]; more: string | null }> {
  const settings = await readPublicSettings();
  if (!settings.features.realestate_projects || scopeCodes.length === 0) return { cards: [], more: null };
  const db = publicDb();
  const [rows, regions, linked] = await Promise.all([
    rowsOf<PublicProjectRow>(db.from("public_projects").select(PUBLIC_PROJECT_COLUMNS).in("region_code", [...scopeCodes]).limit(PROJECT_PUBLIC_LIMITS.list), "지역 공개 프로젝트"),
    readRegions(),
    rowsOf<{ to_id: string }>(
      db.from("public_regional_links").select("to_id, confirmed_at").eq("from_type", "region").eq("from_id", regionCode).eq("to_type", "project").order("confirmed_at", { ascending: false }).limit(50),
      "지역 → 프로젝트 연결",
    ),
  ]);
  const all = cardsOf(rows, regions, kstToday(now), settings.features.region_hubs);
  const cards = hubProjectCards(
    all,
    linked.map((l) => Number(l.to_id)),
  );
  return { cards, more: all.length > cards.length ? projectListHref({ ...NO_FILTER, region: regionCode }) : null };
}
