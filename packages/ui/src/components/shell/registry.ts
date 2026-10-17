// shell 묶음 견본 등록 — PRD-00 8.6 이름(한글 그대로)과 루트 요소 data-ui 값
import type { RegistryEntry } from "../registry-type";

export const registry: RegistryEntry[] = [
  { name: "헤더", ui: "header" },
  { name: "히어로", ui: "hero" },
  { name: "바닥글", ui: "footer" },
  { name: "단계 타임라인", ui: "step-timeline" },
  { name: "세목 아코디언", ui: "tax-accordion" },
  { name: "폼 요소", ui: "form-field" },
  { name: "홈 큰 입력창", ui: "home-search" },
  { name: "데이터 출처 줄", ui: "source-line" },
  { name: "국세·지방세 배지", ui: "tax-kind-badge" },
  // 정보 목록 표시(행사안내·분양 정보)는 이 행의 변형이다 — data-ui="info-list-marker", 8.6에 따로 세지 않는다
  { name: "기사 유형 배지", ui: "article-type-badge" },
  { name: "편집 분야 배지", ui: "editorial-field-badge" },
  { name: "제휴 배지", ui: "partner-badge" },
  { name: "HOT 배지", ui: "hot-badge" },
  { name: "`확정 아님` 칩", ui: "unconfirmed-chip" },
  { name: "진행 단계 배지", ui: "progress-stage-badge" },
];
