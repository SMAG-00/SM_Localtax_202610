/**
 * 광고·제휴 표기 (PRD-00 8.8 · ART-10 · BIZ-08 · LG-13) — 목록·상세·공유 미리보기·메타 제목·JSON-LD에 같은 표기.
 * 화면 제목과 JSON-LD headline이 갈라지지 않게, 화면·메타도 이 함수로 제목을 만든다.
 * 표기 글자는 PRD 그대로 — 광고 "광고", 공동 기획 제휴 배지 "공동 기획 ○○"(ART-10). seo-lint 규칙 파일의 badgeFormats와 같다.
 * 제목에 붙이는 모양 "[배지] 제목"은 seo-lint markerFormat "[{badge}]"와 같다 [확인 필요: 화면 시안의 제목 표기 모양].
 */
import type { SponsorLabel } from "./models";

/** 표기 글자 — "광고" 또는 "공동 기획 ○○" (제휴사 이름이 비면 "공동 기획" — 발행 판정이 막는다) */
export function sponsorLabelText(label: SponsorLabel): string {
  if (label.kind === "광고") return "광고";
  const name = label.partnerName.trim();
  return name ? `공동 기획 ${name}` : "공동 기획";
}

/** 표기를 붙인 제목. 표기가 없으면 원 제목 그대로 */
export function displayTitle(title: string, label: SponsorLabel | undefined): string {
  return label ? `[${sponsorLabelText(label)}] ${title}` : title;
}
