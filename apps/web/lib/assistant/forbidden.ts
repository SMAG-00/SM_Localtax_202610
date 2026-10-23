// 도우미 응답 금지 표현 사전 (A3) — 버전 관리되는 설정 파일 (PRD-01C 4.1 검증기). 법률 검토자가 목록을 늘린다.
// 감면·비과세 단정, 분양·투자 추천, 시세·금리 전망, 세무 자문 보장, 무료 상담 등. 편집국 금지 표현 사전(settings.forbidden_phrases)과는 따로 둔다.
export const ASSISTANT_FORBIDDEN_VERSION = "2026-10-24.1";

export const ASSISTANT_FORBIDDEN_PHRASES: readonly string[] = [
  // 감면·비과세 단정
  "감면 대상입니다",
  "감면됩니다",
  "감면받을 수 있습니다",
  "비과세됩니다",
  "비과세 대상입니다",
  "면제됩니다",
  "세금을 줄일 수 있습니다",
  // 분양·투자 추천
  "분양받으세요",
  "투자하세요",
  "매수하세요",
  "사는 것이 좋습니다",
  "투자 가치가 있습니다",
  "추천드립니다",
  // 시세·금리 전망
  "오를 것입니다",
  "오를 전망",
  "떨어질 것입니다",
  "내릴 전망",
  "금리가 오를",
  "금리가 내릴",
  // 자문 보장·무료 상담
  "세무 자문을 드립니다",
  "무료 상담",
  "책임지고",
  "틀림없이",
  "반드시 이득",
];

/** 사전 + 추가 낱말(설정 등) 합치기 — 중복 제거 */
export const mergeForbidden = (...lists: ReadonlyArray<readonly string[]>): string[] => [...new Set(lists.flat().map((s) => s.trim()).filter(Boolean))];

/** 실존 인물 이름 — A4. 김의효는 항상 포함, 더 필요하면 서버가 공개 인물 목록을 더한다 */
export const BASE_PERSON_NAMES: readonly string[] = ["김의효"];
