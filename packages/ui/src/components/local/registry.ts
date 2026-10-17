// local 묶음 견본 등록 — PRD-00 8.6 이름(한글 그대로)과 루트 요소 data-ui 값
import type { RegistryEntry } from "../registry-type";

export const registry: RegistryEntry[] = [
  { name: "분야 허브 머리", ui: "field-hub-head" },
  { name: "지역 허브 머리", ui: "region-hub-head" },
  { name: "지자체 허브 블록", ui: "local-hub-blocks" },
  { name: "분야 필터", ui: "topic-filter" },
  { name: "지역 세금 연결 블록", ui: "region-tax-links" },
  { name: "공식 자료 카드", ui: "official-source-card" },
  { name: "핫뉴스 항목 카드", ui: "hot-news-item-card" },
  { name: "행사 카드", ui: "event-card" },
  { name: "행사 상태 배지", ui: "event-status-badge" },
  { name: "행사 달력", ui: "event-calendar" },
  { name: "분양 정보 카드", ui: "presale-info-card" },
  { name: "프로젝트 단계 타임라인", ui: "project-stage-timeline" },
  { name: "개발방법 비교표", ui: "dev-method-comparison" },
  { name: "신탁 구조도", ui: "trust-structure-diagram" },
  { name: "이슈 묶음 머리", ui: "issue-bundle-head" },
  { name: "분야 지방세 포인트 블록", ui: "field-tax-point" },
];
