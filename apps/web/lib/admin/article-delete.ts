// 기사 삭제 (목록의 [삭제] 버튼, 2026-11-19 PO 요청 — 발행 이력이 없는 초안은 정정·삭제 칸이 없어 지울 수 없었다).
// 삭제 = 게재 상태 deleted (기록은 남는다). 공개 중인 기사는 버튼으로 지우지 않고 먼저 내려야 한다.

/** 삭제할 수 없는 이유 — 삭제해도 되면 null */
export function deleteBlocker(status: string): string | null {
  if (status === "deleted") return "이미 삭제된 기사입니다";
  if (status === "published" || status === "scheduled") return "공개 중(예약 포함)인 기사는 삭제할 수 없습니다 — 먼저 내려 주세요";
  return null;
}

const DELETED_MARK = "-deleted-";

/**
 * 삭제한 기사의 주소 — 원래 주소를 비워, 같은 주소(예: 편집위원 묶음의 desk-날짜)로 새 기사를 만들 수 있게 한다.
 * 이미 표시가 붙은 주소는 그대로 둔다. 결과는 DB 주소 규칙(공백·/ 없음)을 지킨다.
 */
export function deletedSlug(slug: string, id: number): string {
  return slug.includes(DELETED_MARK) ? slug : `${slug}${DELETED_MARK}${id}`;
}
