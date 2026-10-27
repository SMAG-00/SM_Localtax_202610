import { describe, expect, test } from "vitest";
import { parseApproveInput, parseCaseInput, parseClassifyReview, parseUnpublishInput } from "./solved";
import { parseQuestionInput } from "./logic";

const base = { question_id: 7, situation: "상황 문장", issue: "쟁점 문장", result: "결과 문장", lesson: "교훈 문장" };

describe("해결 사례 입력", () => {
  test("정상 입력은 네 칸을 그대로 돌려준다", () => {
    expect(parseCaseInput(base)).toEqual({ ok: true, value: { questionId: 7, situation: "상황 문장", issue: "쟁점 문장", result: "결과 문장", lesson: "교훈 문장" } });
  });
  test("401자는 거부하고 400자는 통과한다", () => {
    expect(parseCaseInput({ ...base, lesson: "가".repeat(400) }).ok).toBe(true);
    expect(parseCaseInput({ ...base, lesson: "가".repeat(401) }).ok).toBe(false);
  });
  test("이메일 모양이 들어 있으면 거부한다", () => {
    const r = parseCaseInput({ ...base, situation: "문의는 someone@example.com 으로" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain("situation");
  });
  test("질문 번호가 없으면 거부한다", () => {
    expect(parseCaseInput({ ...base, question_id: 0 }).ok).toBe(false);
  });
  test("가림 확인 체크 없이는 승인 입력이 거부된다", () => {
    expect(parseApproveInput({ id: 3 }).ok).toBe(false);
    expect(parseApproveInput({ id: 3, mask_confirmed: "true" }).ok).toBe(false);
    expect(parseApproveInput({ id: 3, mask_confirmed: true })).toEqual({ ok: true, value: { id: 3 } });
  });
  test("내림에는 사유가 필요하다", () => {
    expect(parseUnpublishInput({ id: 3, reason: "" }).ok).toBe(false);
    expect(parseUnpublishInput({ id: 3, reason: "철회 요청" })).toEqual({ ok: true, value: { id: 3, reason: "철회 요청" } });
  });
  test("분류 수락은 세목이 있어야 하고 거절은 세목이 없어야 한다", () => {
    expect(parseClassifyReview({ id: 1, decision: "accepted" }).ok).toBe(false);
    expect(parseClassifyReview({ id: 1, decision: "rejected", final_tax_type: "재산세" }).ok).toBe(false);
    expect(parseClassifyReview({ id: 1, decision: "accepted", final_tax_type: "재산세" })).toEqual({ ok: true, value: { id: 1, decision: "accepted", finalTaxType: "재산세" } });
    expect(parseClassifyReview({ id: 1, decision: "rejected" })).toEqual({ ok: true, value: { id: 1, decision: "rejected", finalTaxType: null } });
  });
});

describe("질문 입력의 해결 사례 동의 칸", () => {
  const q = { tax_type: "재산세", title: "질문 제목", body: "질문 내용입니다", warning_confirmed: true };
  test("기본은 동의 꺼짐이다", () => {
    const r = parseQuestionInput(q);
    expect(r.ok && r.value.solvedConsent).toBe(false);
  });
  test("true일 때만 켜지고 문자열 'true'는 꺼짐이다", () => {
    const on = parseQuestionInput({ ...q, solved_consent: true });
    const str = parseQuestionInput({ ...q, solved_consent: "true" });
    expect(on.ok && on.value.solvedConsent).toBe(true);
    expect(str.ok && str.value.solvedConsent).toBe(false);
  });
});
