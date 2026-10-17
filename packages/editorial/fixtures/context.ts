// 판정 문맥 견본 — 2026-10-17 기준, 초기 사전, R8 기준값, seo-lint 차단·경고 0, 유사도 통과
import { R8_THRESHOLDS, type PerspectiveKey, type PerspectiveRecord, type PublishContext } from "../src/model";
import { SEED_DICTIONARIES } from "./dictionaries";

export const BASE_CONTEXT: PublishContext = {
  today: "2026-10-17",
  dictionaries: SEED_DICTIONARIES,
  thresholds: R8_THRESHOLDS,
  seoLint: { blockers: [], warnings: [] },
  similarity: { status: "pass" },
};

/** 지역 정책 쟁점이 아닌 원고의 관점 칸 */
export const NO_PERSPECTIVES: Readonly<Record<PerspectiveKey, PerspectiveRecord | null>> = {
  local_gov: null,
  residents_taxpayers: null,
  experts: null,
};
