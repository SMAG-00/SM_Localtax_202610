// services 묶음 견본 등록 — PRD-00 8.6 이름(한글 그대로)과 루트 요소 data-ui 값
import type { RegistryEntry } from "../registry-type";

export const registry: RegistryEntry[] = [
  { name: "기자 소개 블록", ui: "reporter-block" },
  { name: "정정 이력 블록", ui: "correction-history" },
  { name: "갱신 배너", ui: "update-banner" },
  { name: "해석 원문 블록", ui: "interpretation-source" },
  { name: "「지방세로 읽기」 박스", ui: "tax-lens-box" },
  { name: "FAQ 블록", ui: "faq-block" },
  { name: "핵심 요약 상자", ui: "key-summary" },
  { name: "상품 카드", ui: "product-card" },
  { name: "외부 계산기 연결 카드", ui: "external-calculator-card" },
  { name: "SM 계산기 카드", ui: "sm-calculator-card" },
  { name: "전문가 카드", ui: "expert-card" },
  { name: "인물 페이지 머리", ui: "person-header" },
  { name: "AI 도우미 런처", ui: "assistant-launcher" },
  { name: "AI 도우미 패널", ui: "assistant-panel" },
  { name: "답변 카드", ui: "answer-card" },
  { name: "진행 상태", ui: "progress-status" },
  { name: "최적화 점검 패널", ui: "optimization-panel" },
  { name: "제휴 준비 지표 카드", ui: "partner-readiness-card" },
];
