// 분야 데이터 연동 공통 모양 (W10-h — PR-06 · LG-15 · DF-06). 순수 타입이며 DB·환경변수를 읽지 않는다.
export const FIELD_TARGETS = ["project_stage", "supply_notice", "local_event", "finance_indicator", "finance_regulation", "finance_case_entry"] as const;
export type FieldTarget = (typeof FIELD_TARGETS)[number];

export const KOGL_TYPES = ["kogl_1", "kogl_2", "kogl_3", "kogl_4", "unmarked"] as const;
export type KoglType = (typeof KOGL_TYPES)[number];

/** 후보 한 건 — review_items.payload 로 들어가는 모양 (DB 함수 field_candidate_problem 이 같은 모양을 검사한다) */
export interface FieldCandidate {
  target: FieldTarget;
  sourceItemId: string;
  /** fields 의 sha256(16진) — 값이 바뀌면 달라진다 */
  valueHash: string;
  /** 원천이 알려 준 공공누리 유형. 없으면 null (null 후보는 만들어지지만 승인할 수 없다) */
  koglType: KoglType | null;
  /** 이전 후보와 달라진 칸 이름 (처음이면 빈 목록) */
  changedFields: string[];
  fields: Record<string, string | number | boolean | (string | Record<string, unknown>)[]>;
}

export interface FieldSourceSpec {
  sourceKey: string;
  target: FieldTarget;
  /** 요청 기본 주소. 실제 값은 이용 조건·실응답 견본 확인 뒤에 채운다 [확인 필요] — 비어 있으면 요청 0 */
  baseUrl: string | null;
  /** 어느 인증키 변수를 쓰는가 (값은 환경변수, 여기에는 이름만) */
  keyName: "DATA_API_KEY" | "DATA_API_DART_KEY";
  /** 인증키를 싣는 요청 변수 이름 [확인 필요] */
  keyParam: string;
  /** 키 말고 붙일 요청 변수 [확인 필요] */
  params: Record<string, string>;
  /** 응답 JSON 안 목록 위치 힌트(첫 키) */
  listRoot: string;
  /** 원천 항목 번호 필드 이름 [확인 필요] */
  idField: string;
  /** 원천 필드 이름 → 후보 칸 이름. 표에 없는 원천 필드는 버린다 (가격류 칸이 후보에 실리지 않는 길) */
  fieldMap: Record<string, string>;
  /** 원천 필드가 없을 때 고정으로 넣는 칸 */
  fixedFields?: Record<string, string | number | boolean>;
  /** 공공누리 유형 필드 이름과 값 대응 [확인 필요] */
  koglField?: string;
  koglMap?: Record<string, KoglType>;
  /** 행사 이미지: 원천이 이미지 이용 권리를 명시한 경우만 true. 기본 false → 이미지 없이 공개 */
  imageRightsConfirmed?: boolean;
}

export type FieldFetch = (url: string) => Promise<{ status: number; text: string }>;

export interface FieldSnapshot {
  sourceKey: string;
  externalId: string;
  /** 인증키 변수를 지운 주소 */
  url: string;
  payload: string;
  contentHash: string;
  httpStatus: number;
}

export interface FieldStore {
  /** 같은 원천 항목의 가장 최근 후보 (값 해시와 칸) */
  latest(sourceKey: string, sourceItemId: string): Promise<{ valueHash: string; fields: Record<string, unknown> } | null>;
  /** 프로젝트 연결(project_source_links) — 단계 후보의 프로젝트 slug */
  projectSlugFor(sourceKey: string, sourceItemId: string): Promise<string | null>;
  /** 스냅샷 + 후보(검수 항목) 1건. 같은 키는 만들지 않고 created=false (원천 ID 멱등) */
  commitCandidate(input: { spec: FieldSourceSpec; snapshot: FieldSnapshot; candidate: FieldCandidate; title: string }): Promise<{ created: boolean }>;
  /** 원천 조회 실패 — 같은 날 한 건의 pipeline_failure 항목만, 공개 자료는 그대로 */
  recordSourceFailure(input: { sourceKey: string; day: string; message: string }): Promise<void>;
}

export interface FieldCollectSummary {
  sourceKey: string;
  listed: number;
  dropped: number;
  unmatched: number;
  known: number;
  candidates: number;
  failed: number;
}
