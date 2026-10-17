// discovery 묶음 견본 등록 — PRD-00 8.6 이름(한글 그대로)과 루트 요소 data-ui 값
import type { RegistryEntry } from "../registry-type";

export const registry: RegistryEntry[] = [
  { name: "픽토그램", ui: "pictogram" },
  { name: "4대 분야 카드", ui: "field-cards" },
  { name: "상황 카드", ui: "situation-card" },
  { name: "기사 카드", ui: "article-card" },
  { name: "많이 본 기사 목록", ui: "popular-articles" },
  { name: "동영상 카드", ui: "video-card" },
  { name: "인포그래픽 블록", ui: "infographic-block" },
  { name: "해결 사례 카드", ui: "solved-case-card" },
  { name: "다음 행동 띠", ui: "next-action-band" },
];
