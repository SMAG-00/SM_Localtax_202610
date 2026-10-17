// discovery 묶음 — 찾기·읽기 컴포넌트 9종 (PRD-00 8.6): 픽토그램 · 4대 분야 카드 · 상황 카드 · 기사 카드 · 많이 본 기사 목록 · 동영상 카드 · 인포그래픽 블록 · 해결 사례 카드 · 다음 행동 띠
export { Pictogram, PICTOGRAMS, PICTOGRAM_NAMES, type PictogramProps, type PictogramName, type PictogramGroup } from "./Pictogram";
export { FieldCards, type FieldCardsProps } from "./FieldCards";
export type { FieldSection } from "./fields";
export { SituationCard, type SituationCardProps } from "./SituationCard";
export { ArticleCard, type ArticleCardProps, type ArticleFormat } from "./ArticleCard";
export { PopularArticles, type PopularArticlesProps, type PopularArticleItem } from "./PopularArticles";
export { VideoCard, type VideoCardProps, type VideoEmbedUrl } from "./VideoCard";
export { InfographicBlock, type InfographicBlockProps, type InfographicData } from "./InfographicBlock";
export { SolvedCaseCard, type SolvedCaseCardProps, type SolvedCaseConclusion, type SolvedCaseBasis } from "./SolvedCaseCard";
export { NextActionBand, type NextActionBandProps, type NextActionItem, type SimilarCaseItem } from "./NextActionBand";
