// shell 묶음 — 이 묶음의 컴포넌트를 여기서 내보낸다 (PRD-00 8.6 — 헤더·히어로·바닥글·단계 타임라인·세목 아코디언·폼 요소·홈 큰 입력창·표시 배지)
export { Header, HEADER_SECTIONS, HEADER_UTILITIES, type HeaderProps, type HeaderSectionKey, type HeaderUtilityKey } from "./Header";
export type { HeaderNavLink } from "./HeaderNav";
export { Hero, type HeroProps } from "./Hero";
export { HeroMedia } from "./HeroMedia";
export {
  HERO_AI_LABEL,
  HERO_IMAGE_FIELDS,
  HERO_MEDIA_DIR,
  HERO_MEDIA_KEYS,
  HERO_MOBILE_MAX_WIDTH,
  HERO_PLAYBACK_LABELS,
  HERO_VIDEO_FIELDS,
  canPlayHeroVideo,
  heroMediaErrors,
  isHeroMediaPath,
  parseHeroMedia,
  pickHeroVideo,
  resolveHeroMedia,
  type HeroMediaEntry,
  type HeroMediaField,
  type HeroMediaKey,
  type HeroMediaSettings,
  type ResolvedHeroMedia,
} from "./hero-media-logic";
export { Footer, type FooterProps, type FooterLink, type FooterInfo } from "./Footer";
export { StepTimeline, type StepTimelineItem } from "./StepTimeline";
export { TaxAccordion, type TaxAccordionItem } from "./TaxAccordion";
export {
  TextField,
  SelectField,
  CheckboxField,
  RadioField,
  type TextFieldProps,
  type SelectFieldProps,
  type SelectFieldOption,
  type CheckboxFieldProps,
  type RadioFieldProps,
  type RadioFieldOption,
} from "./FormField";
export { HomeSearch, type HomeSearchProps } from "./HomeSearch";
export { SourceLine, type SourceLineProps } from "./SourceLine";
export { TaxKindBadge, type TaxKindBadgeKind } from "./TaxKindBadge";
export {
  ArticleTypeBadge,
  InfoListMarker,
  ARTICLE_TYPE_BADGE_LABELS,
  ARTICLE_TYPE_BADGE_ORDER,
  INFO_LIST_MARKER_LABELS,
  type ArticleTypeBadgeKind,
  type InfoListMarkerKind,
} from "./ArticleTypeBadge";
export { EditorialFieldBadge, EDITORIAL_FIELD_BADGE_LABELS, type EditorialFieldBadgeKind } from "./EditorialFieldBadge";
export { PartnerBadge } from "./PartnerBadge";
export { HotBadge } from "./HotBadge";
export { UnconfirmedChip } from "./UnconfirmedChip";
export {
  ProgressStageBadge,
  resolveProgressStage,
  PROGRESS_STAGE_ORDER,
  PROGRESS_STAGE_LABELS,
  type ProgressStageBadgeProps,
  type ProgressStageEvent,
  type ProgressStageKey,
  type ProgressStageResult,
} from "./ProgressStageBadge";
