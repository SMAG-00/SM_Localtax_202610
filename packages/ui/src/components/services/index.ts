// services 묶음 — 이 묶음의 컴포넌트를 여기서 내보낸다 (기사 신뢰 블록 · 스토어 · 전문가 · AI 도우미 · 백오피스, PRD-00 8.6)
export { ReporterBlock, OPINION_NOTICE, type ReporterBlockProps, type PersonRef } from "./ReporterBlock";
export { CorrectionHistory, type CorrectionEntry, type CorrectionKind } from "./CorrectionHistory";
export { UpdateBanner, type UpdateBannerProps, type AmendmentStage } from "./UpdateBanner";
export { InterpretationSource, type InterpretationSourceProps, type LegalDocType } from "./InterpretationSource";
export { TaxLensBox, type TaxLensBoxProps, type TaxLensLink, type TaxLensLinkKind } from "./TaxLensBox";
export { FaqBlock, selectFaqItems, type FaqItem, type FaqSource } from "./FaqBlock";
export { KeySummary } from "./KeySummary";
export {
  ProductCard,
  type ProductCardProps,
  type StoreProductCardProps,
  type OwnProductCardProps,
  type ProductFormat,
  type ProductOrder,
  type SaleStatus,
} from "./ProductCard";
export { ExternalCalculatorCard, EXTERNAL_CALCULATOR_TITLE, type ExternalCalculatorCardProps } from "./ExternalCalculatorCard";
export { SmCalculatorCard, type SmCalculatorCardProps, type SmCalcKey } from "./SmCalculatorCard";
export { isCleanExternalUrl, isUsableLink, pickOfficialLink, type OfficialLink, type LinkStatus } from "./official-link";
export { ExpertCard, type ExpertCardProps, type ExpertCategory, type ExpertVerification } from "./ExpertCard";
export { PersonHeader, verifiedBio, type PersonHeaderProps, type PersonRole, type BioItem, type PersonBook } from "./PersonHeader";
export { AssistantLauncher, ASSISTANT_TITLE, type AssistantLauncherProps } from "./AssistantLauncher";
export { AssistantPanel, type AssistantPanelProps, type AssistantMessage, type AssistantLink } from "./AssistantPanel";
export { AnswerCard, AI_ANSWER_NOTICE, type AnswerCardProps, type AnswerCitation, type AnswerFeedback } from "./AnswerCard";
export { ProgressStatus, type ProgressStatusProps } from "./ProgressStatus";
export { OptimizationPanel, OPTIMIZATION_NOTICE, type OptimizationPanelProps, type OptimizationCheck, type OptimizationAxis, type CheckResult } from "./OptimizationPanel";
export { PartnerReadinessCard, PARTNER_READINESS_NOTICE, type PartnerReadinessCardProps } from "./PartnerReadinessCard";
export type { ExpertLinks } from "./parts";
