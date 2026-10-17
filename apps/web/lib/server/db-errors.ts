// DB 오류 → HTTP 응답 (상태 코드 + 한국어 문장). DB 제약·트리거가 막은 규칙은 409·422로, 그 밖은 500으로 숨긴다.
// 순수 함수 — 시험(db-errors.test.ts)이 직접 부른다. 원문 오류(스택·SQL)는 응답에 넣지 않는다.

export interface DbErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}

export interface MappedError {
  status: number;
  message: string;
  /** 걸린 제약 이름(있으면) — 화면이 칸을 표시할 때 쓴다 */
  constraint?: string;
}

/** 이름 있는 check 제약 → 상태와 문장 */
const CHECK_CONSTRAINTS: Record<string, [number, string]> = {
  articles_content_type_required: [422, "기사 유형(content_type)이 필요합니다 (ART-01)"],
  articles_reporting_method_reported_only: [422, "취재 방식은 보도기사(reported_news)에만 씁니다 (ART-01)"],
  articles_label_sponsored: [422, "표기(공동 기획·광고)가 있는 기사는 sponsored이어야 하고, sponsored는 표기가 있어야 합니다 (ART-10)"],
  articles_co_planned_partner: [422, "공동 기획 표기에는 제휴사가 필요합니다 (ART-10)"],
  articles_digest_link: [422, "금주 핫뉴스(digest)는 주간 회차 연결이 필요하고, 다른 유형은 회차를 연결하지 않습니다 (LG-04)"],
  articles_scheduled_publish_at: [422, "예약 발행에는 발행 시각이 필요합니다"],
  articles_update_reason: [422, "수정 종류를 고르면 수정 사유도 적어야 합니다 (ART-05)"],
  articles_solved_case_subtype: [422, "해결 사례 칸은 하위 유형이 해결 사례(solved_case)일 때만 씁니다 (CAT-05)"],
  articles_slug_check: [422, "주소(slug)에 공백·'/'를 쓸 수 없고, video·photo·popular는 예약된 이름입니다 (ART-01)"],
  article_revisions_reason: [422, "수정 종류를 고르면 수정 사유도 적어야 합니다 (ART-05)"],
  article_sources_official_required: [
    422,
    "공식 문서·데이터 출처는 출처 URL·발표기관·확인일·권리 상태가 모두 있어야 합니다 (FND-04)",
  ],
  article_sources_revision_reason: [422, "원자료 새 버전은 수정 사유가 필요합니다 (REG1-09)"],
  article_corrections_versions: [422, "정정·제목 변경은 전후 버전이, 삭제는 전 버전이 있어야 합니다 (NAV-06)"],
  story_assignments_assigned_ready: [
    409,
    "담당 기자·편집자·이해관계·전문 분야 관련성이 모두 있어야 assigned 이후 상태로 바꿀 수 있습니다 (NAV-09)",
  ],
  story_assignments_regional_ready: [
    409,
    "지역 태그가 있는 기획은 편집 분야와 공익적 질문이 있어야 assigned 이후 상태로 바꿀 수 있습니다 (REG1-17)",
  ],
  media_confirmed_complete: [422, "권리 확인 이미지는 출처·이용 조건·확인일(사진은 촬영자도)이 필요합니다"],
  partners_check: [422, "계약 종료일이 시작일보다 앞입니다 (ART-10)"],
  glossary_terms_plain_check: [422, "쉬운 풀이는 60자 이하여야 합니다 (UX-01)"],
  categories_slug_check: [422, "하위 분야 주소는 영문 소문자·숫자·'-'만 씁니다 (CAT-01)"],
};

const UNIQUE_CONSTRAINTS: Record<string, string> = {
  articles_slug_key: "같은 주소(slug)의 기사가 이미 있습니다",
  staff_roles_pkey: "이미 부여된 역할입니다",
  people_staff_user_id_key: "이 계정에는 이미 인물이 등록되어 있습니다",
  article_revisions_article_id_version_key: "다른 사람이 먼저 고쳤습니다 — 새로 불러온 뒤 다시 저장하세요",
  categories_section_slug_key: "이 분야에 같은 주소(slug)의 하위 분야가 이미 있습니다 (CAT-01)",
  categories_section_name_key: "이 분야에 같은 이름의 하위 분야가 이미 있습니다 (CAT-01)",
  glossary_terms_term_key: "이미 사전에 있는 용어입니다",
};

const FK_CONSTRAINTS: Record<string, string> = {
  articles_category_section: "하위 분야는 기사의 분야(section) 안의 것만 고를 수 있습니다 (CAT-01)",
  staff_roles_user_id_fkey: "그런 사용자 계정이 없습니다",
  article_corrections_before_revision: "정정 전 버전은 같은 기사의 수정 이력이어야 합니다",
  article_corrections_after_revision: "정정 뒤 버전은 같은 기사의 수정 이력이어야 합니다",
};

const CHECK_NAME = /violates check constraint "([^"]+)"/;
const UNIQUE_NAME = /unique constraint "([^"]+)"/;
const FK_NAME = /foreign key constraint "([^"]+)"/;
/** Postgres가 만든 영문 문장 — 그대로 보이지 않는다 */
const POSTGRES_PHRASE =
  /^(new row for relation|duplicate key value|insert or update on table|update or delete on table|null value in column|invalid input|permission denied|column |relation |function )/;

export function mapDbError(error: DbErrorLike): MappedError {
  const code = error.code ?? "";
  const message = (error.message ?? "").trim();

  if (code === "23514") {
    const name = message.match(CHECK_NAME)?.[1];
    if (name) {
      const known = CHECK_CONSTRAINTS[name];
      if (known) return { status: known[0], message: known[1], constraint: name };
      if (name.endsWith("_check")) return { status: 422, message: "허용되지 않는 값입니다 — 값 목록을 확인하세요", constraint: name };
      return { status: 422, message: "저장 규칙에 맞지 않습니다", constraint: name };
    }
    // 트리거가 낸 한국어 규칙 문장 (편집 승인·역할 겸직·기획 상태 등)
    if (message && !POSTGRES_PHRASE.test(message)) return { status: 409, message };
    return { status: 422, message: "저장 규칙에 맞지 않습니다" };
  }
  if (code === "23505") {
    const name = message.match(UNIQUE_NAME)?.[1];
    return { status: 409, message: (name && UNIQUE_CONSTRAINTS[name]) || "이미 있는 값입니다", ...(name ? { constraint: name } : {}) };
  }
  if (code === "23503") {
    const name = message.match(FK_NAME)?.[1];
    return { status: 422, message: (name && FK_CONSTRAINTS[name]) || "연결한 대상(ID)이 없습니다", ...(name ? { constraint: name } : {}) };
  }
  if (code === "23502") return { status: 422, message: "꼭 필요한 칸이 비었습니다" };
  if (code === "22P02" || code === "22007" || code === "22008" || code === "22023") return { status: 422, message: "값 형식이 틀립니다" };
  if (code === "42501") {
    // 추가만 되는 표의 수정·삭제 거부 등 — 트리거 문장은 한국어
    return { status: 409, message: message && !POSTGRES_PHRASE.test(message) ? message : "이 기록은 바꿀 수 없습니다" };
  }
  return { status: 500, message: "서버 오류가 났습니다 — 잠시 뒤 다시 시도하세요" };
}
