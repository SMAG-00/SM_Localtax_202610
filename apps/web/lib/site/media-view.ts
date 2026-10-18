// 형식 콘텐츠·제휴사 화면 값 (ART-07 인포그래픽 · ART-08 동영상 · ART-09 포토 · ART-10 제휴사) — 순수 함수 (시험 media-view.test.ts, docs/dev/W2-c_설계.md 8.4)
//  · 인포그래픽: 저장한 같은 내용(표·목록) → 화면 컴포넌트 값. 절차 흐름 템플릿의 목록은 번호 목록
//  · 사진 한 장의 출처 줄 — 포토 기사는 촬영·출처·이용 조건, 다른 기사는 '사진·그림 ○○'(W2-b 그대로)
//  · 측정 속성: video_played(기사 번호) · partner_content_viewed(제휴사·기사 번호) — 수집 API 검사(W2-c 설계 2.2)를 지나는 모양
import type { InfographicData as StoredInfographicData, InfographicTemplate } from "@ltr/editorial";
import type { InfographicData as UiInfographicData } from "@ltr/ui";

export const VIDEO_LIST_COPY = {
  eyebrow: "VIDEO",
  title: "동영상",
  intro: "편집국이 만든 동영상 기사입니다. 누르기 전에는 유튜브에 연결하지 않습니다.",
  empty: "아직 공개된 동영상 기사가 없습니다.",
  /** 목록 부분의 제목 — 화면 읽기용(sr-only). 머리 h1 다음 카드 제목(h3)으로 건너뛰지 않게 (접근성 heading-order) */
  listHeading: "동영상 기사 목록",
} as const;

export const PHOTO_LIST_COPY = {
  eyebrow: "PHOTO",
  title: "포토",
  intro: "사진으로 전하는 기사입니다. 사진마다 출처와 이용 조건을 적습니다.",
  empty: "아직 공개된 포토 기사가 없습니다.",
  /** 목록 부분의 제목 — 화면 읽기용(sr-only), 동영상 목록과 같은 이유 */
  listHeading: "포토 기사 목록",
} as const;

export const PARTNER_COPY = {
  eyebrow: "PARTNER",
  /** 제휴사가 기사에 미치는 영향의 선 (ART-10 '광고주·제휴사는 기사 승인·정렬·취재 결론을 바꾸지 못한다') */
  independence: "제휴사는 기사 승인·순서·취재 결론에 관여하지 않습니다.",
  site: "제휴사 누리집",
} as const;

export function partnerListTitle(total: number): string {
  return total > 0 ? `제휴 기사 ${total}건` : "아직 공개된 제휴 기사가 없습니다";
}

/** 인포그래픽 같은 내용 → 화면 컴포넌트 값. 표 캡션(화면 읽기용)은 블록 캡션, 없으면 대체 텍스트 */
export function infographicView(block: { caption: string; alt: string; template: InfographicTemplate; data: StoredInfographicData }): UiInfographicData {
  if (block.data.kind === "list") return { kind: "list", items: block.data.items, ordered: block.template === "flow" };
  return { kind: "table", caption: block.caption.trim() || block.alt.trim(), columns: block.data.columns, rows: block.data.rows };
}

/** 인포그래픽 그림 아래 줄 — 단위·출처(표기했을 때) · 그림 출처(이미지 기록) */
export function infographicNotes(chart: { unit: string; source: string } | null, credit: string | null): string[] {
  const out: string[] = [];
  if (chart && (chart.unit.trim() || chart.source.trim())) out.push([chart.unit.trim() && `단위 ${chart.unit.trim()}`, chart.source.trim() && `출처 ${chart.source.trim()}`].filter(Boolean).join(" · "));
  if (credit?.trim()) out.push(`그림 ${credit.trim()}`);
  return out;
}

/** 포토 기사 사진 한 장의 표기 줄 (ART-09 '사진마다 저작권·촬영자 표기') — 촬영 · 출처 · 이용 조건, 빈 칸은 뺀다 */
export function photoCreditLine(m: { photographer: string | null; credit: string | null; license: string | null }): string {
  return [m.photographer?.trim() && `촬영 ${m.photographer.trim()}`, m.credit?.trim() && `출처 ${m.credit.trim()}`, m.license?.trim() && `이용 조건 ${m.license.trim()}`].filter(Boolean).join(" · ");
}

/** 동영상 카드 제목 — 블록 설명(캡션), 없으면 기사 제목 */
export function videoTitle(caption: string, articleTitle: string): string {
  return caption.trim() || articleTitle;
}

export function videoPlayedProps(articleId: number): { article_id: number } {
  return { article_id: articleId };
}

export function partnerViewedProps(partnerId: number, articleId: number): { partner_id: number; article_id: number } {
  return { partner_id: partnerId, article_id: articleId };
}
