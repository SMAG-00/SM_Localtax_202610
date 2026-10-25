import "server-only";
import { buildChrome, type SiteChrome } from "./chrome-logic";
import { readMemberInterests } from "./member-interests";
import { readShortcutInputs } from "./shortcuts";
import { readCategories, readCategoryCounts, readCompanyInfo, readPublicSettings, readTopicCounts } from "./reads";

// 공개 화면 틀 (HOME-02 · HELP-05) — 상단 메뉴 4 · 하위 메뉴(분야 데이터 · 지자체뉴스는 편집 분야) · 유틸 메뉴(기능 키) · 정책 링크(기능 키)
export async function getSiteChrome(): Promise<SiteChrome> {
  const [settings, categories, counts, topicCounts, company] = await Promise.all([readPublicSettings(), readCategories(), readCategoryCounts(), readTopicCounts(), readCompanyInfo()]);
  const shortcutInputs = await readShortcutInputs(settings.features);
  // 회원의 관심 분야는 바로가기 순서에만 쓴다 - 키 shortcuts가 꺼져 있으면 읽지 않는다 (member-interests.ts)
  const interests = settings.features.shortcuts ? await readMemberInterests() : [];
  return buildChrome(categories, counts, settings.features, topicCounts, company, shortcutInputs, settings.shortcutOrder, interests);
}
