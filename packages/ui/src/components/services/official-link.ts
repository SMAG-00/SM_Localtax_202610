// 공식 연결 주소 (`official_links`) — 주소는 코드가 아니라 설정값이다 (TX-01 · FAM-08). 점검 상태는 TX-03 배치가 갱신한다
import { isCleanExternalUrl } from "./format";

export { isCleanExternalUrl };

export type LinkStatus = "ok" | "broken" | "unchecked";

export type OfficialLink = {
  /** 설정에 저장된 주소 — 화면은 이 글자 그대로 쓴다 (덧붙이기 0) */
  url: string;
  status: LinkStatus;
  /** 링크 확인일 */
  checkedAt: string;
  /** 대체 안내의 이름 (예: 국세청 공식 안내) — 없으면 카드의 기본 이름 */
  label?: string;
};

/** 쓸 수 있는 연결인가 — 점검 실패가 아니고 쿼리·조각 없는 http(s) 주소 */
export function isUsableLink(link: OfficialLink | null | undefined): link is OfficialLink {
  return !!link && link.status !== "broken" && isCleanExternalUrl(link.url);
}

/** 원래 연결 → 대체 안내 → 없음(null) 순으로 고른다 — 빈 링크 0 */
export function pickOfficialLink(primary: OfficialLink, fallback: OfficialLink | null | undefined): { link: OfficialLink; isFallback: boolean } | null {
  if (isUsableLink(primary)) return { link: primary, isFallback: false };
  if (isUsableLink(fallback)) return { link: fallback, isFallback: true };
  return null;
}
