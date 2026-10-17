// 편집국 화면 이름표 — DB 값 → 쉬운 한국어 이름 (UX-01 말투). 값 목록은 W2-a 설계 §2와 같다 (labels.test.ts가 값 목록과 대조).
// 브라우저에서도 쓰는 순수 모듈이다 — 서버 전용 모듈을 불러오지 않는다.

export const SECTION_LABELS = { tax: "지방세", realestate: "부동산", finance: "부동산개발금융", local: "지자체뉴스" } as const;

export const CONTENT_TYPE_LABELS = {
  reported_news: "보도",
  explainer: "해설",
  guide: "가이드",
  opinion: "칼럼",
  sponsored: "광고·협찬",
  digest: "금주 핫뉴스",
} as const;

export const REPORTING_METHOD_LABELS = { quantitative: "정량형", qualitative: "정성형", mixed: "혼합형" } as const;

export const FORMAT_LABELS = { general: "일반", cardnews: "카드뉴스", infographic: "인포그래픽", video: "동영상", photo: "포토" } as const;

/** 표기 — 하나만 고른다 (ART-10) */
export const LABEL_LABELS = { none: "표기 없음", co_planned: "공동 기획", ad: "광고" } as const;

export const ARTICLE_STATUS_LABELS = {
  draft: "초안",
  in_review: "검토 중",
  approved: "편집 승인됨",
  scheduled: "예약됨",
  published: "발행됨",
  held: "보류",
  deleted: "삭제됨",
} as const;

export const EDITORIAL_STATUS_LABELS = { pending: "승인 대기", approved: "승인", rejected: "반려", held: "보류" } as const;

export const TAX_REVIEW_STATUS_LABELS = { not_required: "대상 아님", pending: "감수 대기", approved: "감수 완료", rejected: "반려", held: "보류" } as const;

/** 발행 뒤 수정 종류 (ART-05) */
export const UPDATE_KIND_LABELS = { substantive: "실질 수정", typo: "오탈자", correction: "정정" } as const;

export const SOURCE_KIND_LABELS = {
  official_doc: "공식 문서",
  dataset: "공공 데이터",
  press_release: "보도자료",
  interview: "인터뷰",
  field: "현장 취재",
  photo: "사진",
  other: "기타",
} as const;

export const EVIDENCE_TYPE_LABELS = {
  dataset: "원자료(데이터)",
  document: "문서",
  interview: "인터뷰",
  field: "현장 기록",
  photo: "사진",
  calculation: "계산 기록",
} as const;

export const EVIDENCE_RIGHTS_LABELS = { unconfirmed: "권리 미확인", confirmed: "권리 확인", restricted: "이용 제한" } as const;
export const VERIFICATION_LABELS = { pending: "확인 전", verified: "확인됨", rejected: "확인 실패" } as const;

export const REVIEW_KIND_LABELS = { desk_edit: "편집 승인", tax_review: "세무 감수", sponsor_check: "광고 표기 확인" } as const;
export const REVIEW_DECISION_LABELS = { approve: "승인", reject: "반려", hold: "보류" } as const;

export const CORRECTION_KIND_LABELS = {
  correction: "정정",
  rebuttal: "반론",
  follow_up: "추후보도",
  deletion: "삭제",
  title_change: "제목 변경",
} as const;

export const BLOCK_TYPE_LABELS = {
  paragraph: "문단",
  table: "표",
  image: "이미지",
  quote: "인용",
  callout: "상자",
  infographic: "인포그래픽",
  video: "동영상",
  faq: "자주 묻는 질문",
  key_summary: "핵심 요약",
  slide: "카드뉴스 장",
} as const;

/** 해결 사례 결과의 결론 배지 (CAT-05) — 공개 화면 해결 사례 카드와 같은 글자 */
export const SOLVED_CASE_CONCLUSION_LABELS = { accepted: "인용", partial: "일부 인용", rejected: "기각", dismissed: "각하", interpretation: "해석" } as const;

export const CALLOUT_KIND_LABELS = { info: "정보", tip: "절세 체크포인트", caution: "주의", mistake: "자주 틀리는 점" } as const;

export const CLAIM_KIND_LABELS = { fact: "사실", tax_calculation: "세금 계산", legal: "법률 주장" } as const;

export const QUOTE_CONSENT_LABELS = { full: "인용 동의", partial: "일부만 동의", none: "동의 안 함" } as const;
export const ANONYMITY_LABELS = { named: "실명", anonymous: "익명" } as const;

export const TAX_LENS_LINK_LABELS = { explainer: "해설", calculator: "계산기", book: "도서", expert: "전문가" } as const;

export const PERSPECTIVE_STATUS_LABELS = { interviewed: "취재함", no_response: "접촉했으나 응답 없음" } as const;

/** 서비스 역할 7종 (ACC-04) — 편집국 외 역할은 '편집'이라는 말을 쓰지 않는다 */
export const ROLE_LABELS = {
  reporter: "기자",
  editor: "편집 책임자",
  reviewer: "세무 감수위원",
  ad_ops: "광고·협찬 담당",
  store_ops: "스토어·구독 담당",
  brand_ops: "브랜드 관리 담당",
  expert_ops: "전문가 담당",
} as const;

/** 기사 기획 상태 7종 (NAV-09) */
export const ASSIGNMENT_STATUS_LABELS = {
  idea: "아이디어",
  assigned: "배정",
  reporting: "취재 중",
  fact_check: "사실 확인",
  review: "검토",
  published: "발행",
  held: "보류",
} as const;

/** 편집 분야 4종 (REG1-17) */
export const EDITORIAL_FIELD_LABELS = {
  local_tax: "지방세",
  realestate: "부동산 세금",
  local_finance: "지방재정",
  urban_policy: "도시·부동산 정책",
} as const;

export type Option = { value: string; label: string };

/** 값의 이름 — 모르는 값은 그대로, 빈 값은 '없음' */
export function labelOf(labels: Readonly<Record<string, string>>, value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "없음";
  return labels[value] ?? value;
}

/** 선택 목록 — 이름표 순서. only를 주면 그 값만 */
export function optionsOf(labels: Readonly<Record<string, string>>, only?: readonly string[]): Option[] {
  return Object.entries(labels)
    .filter(([value]) => !only || only.includes(value))
    .map(([value, label]) => ({ value, label }));
}
