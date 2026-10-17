import "server-only";

// 공개 데이터 함수 (docs/dev/W2-b_설계.md 5장) — 공개 화면(2~4단계)은 여기 함수만 부른다. 모두 anon 키로 읽는다(RLS가 경계).
export { getSiteChrome } from "./chrome";
export { closedHomeData, getHomeData, getHomeAmendments, type HomeData } from "./home";
export { getHubData, getCategoryList, getNewsList, type HubData, type HubTab, type CategoryListData, type NewsListData } from "./hub";
export { closedHubData } from "./hub-logic";
export { getSituationPage, type SituationPage } from "./situations";
export { getArticleDetail, type ArticleDetail, type ArticleMedia } from "./article";
export { getColumnList, COLUMN_SLUG, type ColumnListData } from "./columns";
export { readPublic, isUnavailable, UNAVAILABLE, type Unavailable } from "./fallback";
export { getPersonPage, type PersonPage } from "./people";
export { PublicDataError } from "./db";
export type { HomeSection, TrackerCard, StoryCard, AmendmentsSection } from "./home-logic";
export type { ArticleListItem, TrackerState } from "./cards";
export type { SituationCard, CheckItem, RegionChoice, RegionArticles } from "./situation-logic";
export type { NextAction, SlideView, SolvedCaseView, SponsorMark, TaxLensView, CorrectionEntry, UpdateEntry, SimilarCase } from "./article-logic";
export type { ColumnGroup } from "./column-logic";
export { closedChrome, type SiteChrome, type NavLink, type SectionMenu } from "./chrome-logic";
