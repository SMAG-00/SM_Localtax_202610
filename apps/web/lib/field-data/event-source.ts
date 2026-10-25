import { licenseBadge } from "@/lib/admin/official-source-rules";

// 행사 상세의 연동 출처 줄 (W10-h - PRD-02 LG-15). 순수 함수 (시험 event-source.test.ts).
//  · 공공누리 유형 글자: 기록된 유형이 있을 때만 (수동 입력 행사는 유형 칸이 비어 줄이 없다)
//  · 이미지: https 주소이고 DB 뷰가 권리 확인분만 내려 준 값일 때만 그린다 - 미확인이면 이미지 주소가 오지 않으므로 렌더 0 (여기서도 한 번 더 막는다)

export interface EventSourceInput {
  license_type?: string | null;
  image_url?: string | null;
}

export interface EventSourceInfo {
  licenseLabel: string | null;
  imageUrl: string | null;
}

export function eventSourceInfo(row: EventSourceInput): EventSourceInfo {
  const image = row.image_url?.trim() ?? "";
  return {
    licenseLabel: licenseBadge(row.license_type ?? null),
    imageUrl: /^https:\/\/[^\s"'<>]+$/i.test(image) ? image : null,
  };
}
