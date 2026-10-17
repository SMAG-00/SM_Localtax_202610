import "server-only";
import { isoToKstDate } from "@/lib/admin/form-utils";
import { selectNextActions, type ActionTargets, type NextAction } from "./article-logic";
import type { ArticleListItem } from "./cards";
import { SECTION_INFO, isSectionKey, type SectionKey } from "./constants";
import { publicDb, rowsOf } from "./db";
import { readArticleList, readPublicSettings, readRegions } from "./reads";
import { GLOSSARY_COLUMNS, SITUATION_COLUMNS, num, type GlossaryRow, type SituationRow } from "./rows";
import {
  codesWithin,
  inIdOrder,
  readChecklist,
  readChecks,
  readToolFeatures,
  regionArticles,
  regionChoices,
  toolActionKeys,
  toSituationCard,
  type CheckItem,
  type RegionArticles,
  type RegionChoice,
  type SituationCard,
} from "./situation-logic";

// 상황 페이지 (UX-05 · FAM-02 · CAT-03) — 공개 상황만. 연결한 기사·해결 사례·용어는 읽히는(공개) 것만 지정 순서로.
// 외부 계산기 연결 카드(01B FAM-08 — official_links W3)는 표가 생기면 붙는다 — 지금은 null.

export interface SituationPage {
  card: SituationCard;
  section: SectionKey;
  sectionName: string;
  hubHref: string;
  checks: CheckItem[];
  /** 일반적 체크리스트와 고지 (FAM-02) — 없으면 null */
  checklist: { items: string[]; notice: string } | null;
  /** 자주 틀리는 점 (상태 상자 — 있을 때만) */
  mistakes: string[];
  solvedCases: ArticleListItem[];
  articles: ArticleListItem[];
  terms: { id: number; term: string; plain: string | null }[];
  /** 지역 선택 칩 — 이 상황만(region_select). 아니면 null */
  regionSelect: { sido: RegionChoice[]; sigungu: RegionChoice[]; selected: string | null } | null;
  /** 고른 지역의 기사 (0건이면 상위 시·도 기사와 그 사실) */
  regionArticles: RegionArticles | null;
  nextActions: NextAction[];
  externalCalculator: null;
  reviewedAt: string | null;
}

const REGION_ARTICLES_LIMIT = 10;

export async function getSituationPage(slug: string, opts: { region?: string | null; now?: Date } = {}): Promise<SituationPage | null> {
  const db = publicDb();
  const today = isoToKstDate((opts.now ?? new Date()).toISOString());
  const found = await rowsOf<SituationRow>(db.from("situations").select(SITUATION_COLUMNS).eq("slug", slug).limit(1), "상황");
  const row = found[0];
  if (!row || !isSectionKey(row.section)) return null;
  const card = toSituationCard(row);
  if (!card) return null;
  const section = row.section;

  const [settings, linked, solved, terms, regions] = await Promise.all([
    readPublicSettings(),
    readArticleList(db, { ids: (row.article_ids ?? []).map(num), limit: 50 }),
    readArticleList(db, { ids: (row.solved_case_ids ?? []).map(num), subtype: "solved_case", limit: 50 }),
    (row.glossary_ids ?? []).length
      ? rowsOf<GlossaryRow>(db.from("glossary_terms").select(GLOSSARY_COLUMNS).in("id", row.glossary_ids.map(num)), "상황 용어")
      : Promise.resolve([] as GlossaryRow[]),
    row.region_select ? readRegions() : Promise.resolve([]),
  ]);

  let regionSelect: SituationPage["regionSelect"] = null;
  let regionView: RegionArticles | null = null;
  if (row.region_select) {
    const selected = opts.region ? (regions.find((r) => r.code === opts.region) ?? null) : null;
    const choices = regionChoices(regions, selected, today);
    regionSelect = { ...choices, selected: selected?.code ?? null };
    if (selected) {
      // 고른 지역과 상위 시·도(그 하위 포함) 기사를 한 번에 읽고, 고른 지역 0건이면 상위로 대신한다
      const sido = selected.level === "sido" ? selected.code : (selected.parent_code ?? selected.code);
      const { items } = await readArticleList(db, { section, regionCodes: codesWithin(sido, regions), limit: REGION_ARTICLES_LIMIT * 3 });
      const view = regionArticles(selected, regions, items);
      regionView = { ...view, items: view.items.slice(0, REGION_ARTICLES_LIMIT) };
    }
  }

  const targets: ActionTargets = {};
  for (const key of toolActionKeys(readToolFeatures(row.tool_links))) {
    if (key === "expert_finder") targets.expert_finder = { href: `/experts?field=${section}` };
    if (key === "self_calculator") targets.self_calculator = { href: "/calc" };
    // sm_calculator — official_links(01B W3)의 설정 주소로만 연다. 표가 생기기 전에는 갈 곳 없음 → 버튼 0
    // taxbot — 도우미 창의 모드(4단계 PRD-04). 주소가 없다
  }

  return {
    card,
    section,
    sectionName: SECTION_INFO[section].name,
    hubHref: SECTION_INFO[section].href,
    checks: readChecks(row.checks),
    checklist: readChecklist(row.checklist),
    mistakes: (row.mistakes ?? []).filter((m) => m.trim() !== ""),
    solvedCases: inIdOrder(row.solved_case_ids.map(num), solved.items),
    articles: inIdOrder(row.article_ids.map(num), linked.items),
    terms: inIdOrder(
      row.glossary_ids.map(num),
      terms.map((t) => ({ id: num(t.id), term: t.term, plain: t.plain })),
    ),
    regionSelect,
    regionArticles: regionView,
    nextActions: selectNextActions(settings.nextActionPriority, targets, settings.features),
    externalCalculator: null,
    reviewedAt: row.reviewed_at,
  };
}
