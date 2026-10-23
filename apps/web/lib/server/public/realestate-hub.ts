import "server-only";
import { PUBLIC_PROJECT_COLUMNS, PROJECT_PUBLIC_LIMITS, projectCard, projectRegion, sortProjects, type ProjectCard, type PublicProjectRow } from "./project-logic";
import { COLUMNS_HREF, EMPTY_REALESTATE_HUB, HUB_COLUMN_LIMIT, hubLinkCards, hubSupplyBlock, landmarkCards, regionChips, todayKst, type RealEstateHubData } from "./realestate-hub-logic";
import { PUBLIC_SUPPLY_COLUMNS, SUPPLY_LIMITS, upcomingCards, type PublicSupplyRow } from "./supply-logic";
import { getDevMethodsList } from "./dev-methods";
import { publicDb, rowsOf } from "./db";
import { readArticleList, readPublicSettings, readRegions } from "./reads";
import { readPilotRegions } from "./region-index";

// /realestate 허브 확장 읽기 (W4 22단계 — 규칙은 realestate-hub-logic.ts). 새 표·마이그레이션 없음 — 기존 공개 뷰(public_projects·public_supply_notices·public_dev_methods…)와
// 설정(pilot_regions·feature_flags)·공개 기사 뷰만 anon 키로 읽는다. 기능 키가 꺼진 부분은 읽지 않고 0장. 한 부분을 읽지 못하면 그 부분만 0(허브 전체를 닫지 않는다).
// 상속·증여 키(inheritance_gift)는 23단계가 FEATURE_KEYS·feature_flags에 더한다 — 그 전까지 feature_flags 값에 키가 없으면 닫힘(카드 0).

/** 한 부분을 읽지 못하면 비어 있는 값 */
async function soft<T>(read: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await read();
  } catch {
    return empty;
  }
}

async function inheritanceOpen(): Promise<boolean> {
  const rows = await rowsOf<{ value: unknown }>(publicDb().from("settings").select("value").eq("key", "feature_flags"), "기능 키 상속·증여");
  const v = rows[0]?.value;
  return typeof v === "object" && v !== null && (v as Record<string, unknown>)["inheritance_gift"] === true;
}

export async function readRealEstateHub(now: Date = new Date()): Promise<RealEstateHubData> {
  const settings = await readPublicSettings();
  const f = settings.features;
  const db = publicDb();
  const today = todayKst(now);
  const [chips, projects, supply, devMethods, inherit, columns] = await Promise.all([
    f.region_hubs
      ? soft(async () => {
          const [regions, pilots] = await Promise.all([readRegions(), readPilotRegions()]);
          return regionChips(regions, pilots, today, true);
        }, EMPTY_REALESTATE_HUB.chips)
      : EMPTY_REALESTATE_HUB.chips,
    f.realestate_projects
      ? soft(async () => {
          const [rows, regions] = await Promise.all([
            rowsOf<PublicProjectRow>(db.from("public_projects").select(PUBLIC_PROJECT_COLUMNS).eq("landmark", true).limit(PROJECT_PUBLIC_LIMITS.list), "허브 대표 프로젝트"),
            readRegions(),
          ]);
          const cards: ProjectCard[] = sortProjects(rows.flatMap((r) => projectCard(r, projectRegion(r.region_code, regions, today, f.region_hubs)) ?? []));
          return landmarkCards(cards, PROJECT_PUBLIC_LIMITS.hubCards);
        }, EMPTY_REALESTATE_HUB.projects)
      : EMPTY_REALESTATE_HUB.projects,
    f.supply_notices
      ? soft(async () => {
          const [rows, regions] = await Promise.all([
            rowsOf<PublicSupplyRow>(db.from("public_supply_notices").select(PUBLIC_SUPPLY_COLUMNS).gte("apply_end", today).order("apply_end").order("id").limit(SUPPLY_LIMITS.list), "허브 분양 정보"),
            readRegions(),
          ]);
          return hubSupplyBlock(upcomingCards(rows, regions, now, f), SUPPLY_LIMITS.hubCards);
        }, EMPTY_REALESTATE_HUB.supply)
      : EMPTY_REALESTATE_HUB.supply,
    f.dev_methods ? soft(async () => (await getDevMethodsList())?.review ?? null, null) : null,
    soft(inheritanceOpen, false),
    soft(async () => {
      const { items } = await readArticleList(db, { section: "realestate", contentType: "opinion", limit: HUB_COLUMN_LIMIT });
      return { items, all: items.length > 0 ? COLUMNS_HREF : null };
    }, EMPTY_REALESTATE_HUB.columns),
  ]);
  return { chips, projects, supply, links: hubLinkCards({ devMethods: devMethods ? { reviewedOn: devMethods.reviewedOn } : null, inheritanceOpen: inherit }), columns };
}
