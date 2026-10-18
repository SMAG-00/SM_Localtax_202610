// DB 오류 → HTTP 응답 시험 — 제약·트리거 문장은 409·422 한국어로, 그 밖은 500(원문 숨김)
import { describe, expect, test } from "vitest";
import { mapDbError } from "./db-errors";

describe("DB 오류 변환", () => {
  test("상황 카드 제약 (UX-05) — 공개 조건은 409, 모양은 422, 주소·허브 자리 중복은 409, 허브 상한 트리거 문장은 그대로", () => {
    expect(mapDbError({ code: "23514", message: 'new row for relation "situations" violates check constraint "situations_publish_ready"' })).toMatchObject({
      status: 409,
      message: expect.stringContaining("먼저 내린 뒤 고치고 다시 감수"),
      constraint: "situations_publish_ready",
    });
    expect(mapDbError({ code: "23514", message: 'new row for relation "situations" violates check constraint "situations_checks_shape"' })).toMatchObject({
      status: 422,
      message: expect.stringContaining("3개 이하"),
    });
    expect(mapDbError({ code: "23505", message: 'duplicate key value violates unique constraint "situations_slug_key"' })).toMatchObject({
      status: 409,
      message: expect.stringContaining("같은 주소(slug)의 상황"),
    });
    expect(mapDbError({ code: "23505", message: 'duplicate key value violates unique constraint "situations_hub_slot_unique"' })).toMatchObject({ status: 409, constraint: "situations_hub_slot_unique" });
    const limit = "허브 상황 카드는 분야마다 4장까지입니다 — 자리 5는 지정할 수 없습니다 (UX-05)";
    expect(mapDbError({ code: "23514", message: limit })).toEqual({ status: 409, message: limit });
  });
  test("검색 별칭·동의어 사전 제약 (W2-d) — 모양은 422, 같은 정규형 낱말은 409", () => {
    expect(mapDbError({ code: "23514", message: 'new row for relation "situations" violates check constraint "situations_aliases_shape"' })).toMatchObject({
      status: 422,
      message: expect.stringContaining("검색 별칭은 20개까지"),
      constraint: "situations_aliases_shape",
    });
    for (const name of ["search_synonyms_term_check", "search_synonyms_term_key", "search_synonyms_shape"]) {
      const r = mapDbError({ code: "23514", message: `new row for relation "search_synonyms" violates check constraint "${name}"` });
      expect(r).toMatchObject({ status: 422, constraint: name });
      expect(r.message).not.toMatch(/new row|violates/);
    }
    expect(mapDbError({ code: "23505", message: 'duplicate key value violates unique constraint "search_synonyms_term_key_unique"' })).toMatchObject({
      status: 409,
      message: expect.stringContaining("같은 낱말이 이미 동의어 사전에"),
    });
  });

  test("트리거가 낸 한국어 규칙 문장은 409로 그대로", () => {
    const message = "편집 승인 역할(editor)과 편집국 외 역할은 한 사람에게 함께 줄 수 없습니다 (ACC-04 — 이미 ad_ops, 새로 editor)";
    expect(mapDbError({ code: "23514", message })).toEqual({ status: 409, message });
  });
  test("이름 있는 check 제약은 정한 상태·문장으로", () => {
    expect(mapDbError({ code: "23514", message: 'new row for relation "article_sources" violates check constraint "article_sources_official_required"' })).toEqual({
      status: 422,
      message: "공식 문서·데이터 출처는 출처 URL·발표기관·확인일·권리 상태가 모두 있어야 합니다 (FND-04)",
      constraint: "article_sources_official_required",
    });
    expect(mapDbError({ code: "23514", message: 'new row for relation "story_assignments" violates check constraint "story_assignments_assigned_ready"' }).status).toBe(409);
  });
  test("모르는 값 목록 제약은 422, 영문 원문은 내보내지 않는다", () => {
    const mapped = mapDbError({ code: "23514", message: 'new row for relation "articles" violates check constraint "articles_format_check"' });
    expect(mapped).toEqual({ status: 422, message: "허용되지 않는 값입니다 — 값 목록을 확인하세요", constraint: "articles_format_check" });
  });
  test("중복·외래 키·형식", () => {
    expect(mapDbError({ code: "23505", message: 'duplicate key value violates unique constraint "articles_slug_key"' })).toMatchObject({ status: 409, message: "같은 주소(slug)의 기사가 이미 있습니다" });
    expect(mapDbError({ code: "23503", message: 'insert or update on table "articles" violates foreign key constraint "articles_category_section"' })).toMatchObject({
      status: 422,
      message: expect.stringContaining("CAT-01"),
    });
    expect(mapDbError({ code: "22P02", message: "invalid input syntax for type bigint" })).toEqual({ status: 422, message: "값 형식이 틀립니다" });
  });
  test("분야·용어 중복과 제휴사 계약 기간 — 4-2 편집 화면의 DB 제약도 한국어 문장으로", () => {
    expect(mapDbError({ code: "23505", message: 'duplicate key value violates unique constraint "categories_section_slug_key"' })).toEqual({
      status: 409,
      message: "이 분야에 같은 주소(slug)의 하위 분야가 이미 있습니다 (CAT-01)",
      constraint: "categories_section_slug_key",
    });
    expect(mapDbError({ code: "23505", message: 'duplicate key value violates unique constraint "glossary_terms_term_key"' }).message).toBe("이미 사전에 있는 용어입니다");
    expect(mapDbError({ code: "23514", message: 'new row for relation "partners" violates check constraint "partners_check"' })).toMatchObject({ status: 422, message: expect.stringContaining("계약 종료일") });
  });
  test("권한 오류의 영문 원문은 숨기고, 추가만 되는 표의 트리거 문장은 보인다", () => {
    expect(mapDbError({ code: "42501", message: "permission denied for table audit_logs" })).toEqual({ status: 409, message: "이 기록은 바꿀 수 없습니다" });
    expect(mapDbError({ code: "42501", message: "article_revisions는 추가만 할 수 있습니다 (UPDATE 거부)" }).message).toContain("추가만");
  });
  test("모르는 오류는 500이고 원문을 싣지 않는다", () => {
    const mapped = mapDbError({ code: "XX000", message: "internal error at /var/lib/postgres secret" });
    expect(mapped.status).toBe(500);
    expect(mapped.message).not.toContain("secret");
    expect(mapDbError({}).status).toBe(500);
  });
});
