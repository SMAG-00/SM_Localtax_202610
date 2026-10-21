import "server-only";
import { groupColumns, type ColumnGroup } from "./column-logic";
import { SECTION_INFO, type SectionKey } from "./constants";
import { publicDb } from "./db";
import { hubTabs, type HubTab } from "./hub-logic";
import { readArticleList, readCategories, readCategoryCounts, readTopicCounts } from "./reads";
import { withSignature } from "./signature";

// 칼럼 목록 (ART-04 — `/tax/columns` · `/finance/columns`, 부동산 칼럼은 01B W4가 하위 분야를 더하면 같은 경로 규칙으로 열린다).
// 칼럼 = 그 분야의 공개 `opinion` 기사(하위 분야와 상관없이 — ART-04의 정의) · 연재마다 회차 순서 · 단독 칼럼은 끝에 최신 순.
// 칼럼은 뉴스 전체·자체 취재 목록에 나오지 않는다(그 목록은 편집 승인된 reported_news만 읽는다). 필자 체계(이해관계·자격 — 01B TX-14~17)는 W3.

/** 칼럼 목록 주소 — 하위 분야 slug `columns` (PRD-01A 3장 · CAT-01 씨앗) */
export const COLUMN_SLUG = "columns";
/** 한 화면에 읽는 칼럼 수 — 연재 묶음을 쪽으로 나누지 않는다 (넘으면 오래된 것부터 빠진다 — 쪽 넘김은 칼럼 수가 늘면 [확인 필요]) */
const COLUMN_LIMIT = 100;

export interface ColumnListData {
  section: SectionKey;
  hub: { name: string; eyebrow: string; href: string };
  category: { slug: string; name: string; intro: string | null };
  tabs: HubTab[];
  groups: ColumnGroup[];
  total: number;
  /** 칼럼 0건 — 상위 허브 안내 + noindex */
  noindex: boolean;
}

/** 칼럼 목록 — 그 분야에 공개 하위 분야 `columns`가 없으면 null (404) */
export async function getColumnList(section: SectionKey): Promise<ColumnListData | null> {
  if (section === "local") return null;
  const [categories, counts, topicCounts] = await Promise.all([readCategories(), readCategoryCounts(), readTopicCounts()]);
  const category = categories.find((c) => c.section === section && c.slug === COLUMN_SLUG);
  if (!category) return null;
  const { items } = await readArticleList(publicDb(), { section, contentType: "opinion", limit: COLUMN_LIMIT });
  // 시그니처 연재 회차는 연재 틀(설정 제목·회차·근거 링크)을 입힌다 — 기능 키 tax_columns 켜짐일 때만 (W3 8단계)
  const groups = groupColumns(await withSignature(items));
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const hub = SECTION_INFO[section];
  return {
    section,
    hub: { name: hub.name, eyebrow: hub.eyebrow, href: hub.href },
    category: { slug: category.slug, name: category.name, intro: category.intro },
    tabs: hubTabs(section, categories, counts, topicCounts),
    groups,
    total,
    noindex: total === 0,
  };
}
