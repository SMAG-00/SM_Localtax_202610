// local 묶음 — 지자체·부동산·부동산개발금융 영역 컴포넌트 16종 (PRD-00 8.6)
export { FieldHubHead, type FieldHubHeadProps, type FieldHub } from "./FieldHubHead";
export { RegionHubHead, regionCrumbs, type RegionCrumb, type RegionHubHeadProps, type RegionRef } from "./RegionHubHead";
export { LocalHubBlocks, type LocalHubBlocksProps, type HubBlockContent, type HubBlockGroup } from "./LocalHubBlocks";
export { TopicFilter, TOPIC_FILTER_ITEMS, type TopicFilterProps, type LocalTopic } from "./TopicFilter";
export { RegionTaxLinks, type RegionTaxLink, type RegionTaxLinkKind } from "./RegionTaxLinks";
export { OfficialSourceCard, OFFICIAL_SOURCE_KINDS, type OfficialSourceCardProps, type OfficialSourceKind } from "./OfficialSourceCard";
export { HotNewsItemCard, type HotNewsItemCardProps } from "./HotNewsItemCard";
export { EventCard, type EventCardProps } from "./EventCard";
export { EventStatusBadge } from "./EventStatusBadge";
export { EventCalendar, type EventCalendarProps } from "./EventCalendar";
export {
  computeEventStatus,
  isPastEvent,
  isPublishableEvent,
  needsRecheck,
  FESTIVAL_CATEGORY,
  LOCAL_EVENT_STATUSES,
  type LocalEvent,
  type LocalEventStatus,
} from "./events";
export { PresaleInfoCard, type PresaleInfoCardProps } from "./PresaleInfoCard";
export { ProjectStageTimeline, type ProjectStage, type ProjectStageRecord } from "./ProjectStageTimeline";
export { DevMethodComparison, DEV_METHODS, type DevMethodComparisonProps, type DevMethodEntry, type DevMethodFact, type DevMethodId } from "./DevMethodComparison";
export { TrustStructureDiagram, type TrustStructureDiagramProps, type StructureNode, type StructureFlow } from "./TrustStructureDiagram";
export { IssueBundleHead, type IssueBundleHeadProps, type IssueArticle, type IssueField } from "./IssueBundleHead";
export { FieldTaxPoint, type FieldTaxPointProps } from "./FieldTaxPoint";
export type { SourceRights } from "./shared";
