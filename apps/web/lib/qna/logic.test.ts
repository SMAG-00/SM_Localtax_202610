import { describe, expect, test } from "vitest";
import { isGovEmail, parseAnswerInput, parseQuestionInput, parseReportInput, parseStripCriteria, reportDueAt, selectStrip, type ActivityRow } from "./logic";

const row = (id: number, accepted: number, answered: number, extra: Partial<ActivityRow> = {}): ActivityRow => ({
  expertProfileId: id,
  name: `전문가${id}`,
  answeredCount: answered,
  acceptedCount: accepted,
  acceptanceRate: answered === 0 ? 0 : accepted / answered,
  ...extra,
});

describe("활동 전문가 띠 선정 (QNA-08)", () => {
  const criteria = { minAccepted: 2, minRate: 0.5, stripSize: 3 };

  test("기준이 비어 있으면 띠는 비어 있다", () => {
    expect(parseStripCriteria({})).toBeNull();
    expect(selectStrip([row(1, 5, 5)], parseStripCriteria({}))).toEqual([]);
  });

  test("최소 채택 수 경계 - 1건은 제외, 2건은 포함", () => {
    expect(selectStrip([row(1, 1, 1), row(2, 2, 2)], criteria).map((r) => r.expertProfileId)).toEqual([2]);
  });

  test("최소 채택률 경계 - 0.5 미만 제외, 0.5 포함", () => {
    const rows = [row(1, 2, 5), row(2, 2, 4)];
    expect(selectStrip(rows, criteria).map((r) => r.expertProfileId)).toEqual([2]);
  });

  test("채택 수 내림차순, 같으면 채택률, 그래도 같으면 프로필 번호 오름차순 - 입력 순서와 무관", () => {
    const rows = [row(9, 3, 3), row(4, 3, 3), row(7, 4, 5), row(2, 3, 4)];
    const a = selectStrip(rows, { ...criteria, stripSize: 5 }).map((r) => r.expertProfileId);
    const b = selectStrip([...rows].reverse(), { ...criteria, stripSize: 5 }).map((r) => r.expertProfileId);
    expect(a).toEqual([7, 4, 9, 2]);
    expect(b).toEqual(a);
  });

  test("제재 중인 전문가는 기준을 넘어도 제외, 인원은 strip_size까지", () => {
    const rows = [row(1, 9, 9, { sanctioned: true }), row(2, 5, 5), row(3, 4, 4), row(4, 3, 3), row(5, 2, 2)];
    expect(selectStrip(rows, criteria).map((r) => r.expertProfileId)).toEqual([2, 3, 4]);
  });

  test("strip_size는 3~5만 인정", () => {
    expect(parseStripCriteria({ strip_size: 2, min_accepted: 1, min_rate: 0.5 })).toBeNull();
    expect(parseStripCriteria({ strip_size: 6, min_accepted: 1, min_rate: 0.5 })).toBeNull();
    expect(parseStripCriteria({ strip_size: 5, min_accepted: 1, min_rate: 0.5 })).toEqual({ minAccepted: 1, minRate: 0.5, stripSize: 5 });
  });

  test("공휴일 목록이 있으면 건너뛴다 - 금요일 접수 + 월요일 공휴일 = 화요일, 목록이 비면 월요일", () => {
    const fri = new Date("2026-10-23T05:00:00Z");
    expect(reportDueAt(fri, ["2026-10-26"]).toISOString()).toBe("2026-10-27T05:00:00.000Z");
    expect(reportDueAt(fri, []).toISOString()).toBe("2026-10-26T05:00:00.000Z");
  });
});

describe("공무원 인증 도메인 (EXP-01)", () => {
  const domains = ["go.kr"];
  test.each([
    ["a@go.kr", true],
    ["a@seoul.go.kr", true],
    ["A@Seoul.GO.KR", true],
    ["a@notgo.kr", false],
    ["a@go.kr.evil.com", false],
    ["go.kr", false],
    ["", false],
  ])("%s -> %s", (email, expected) => {
    expect(isGovEmail(email, domains)).toBe(expected);
  });
  test("목록이 비면 아무도 인정하지 않는다", () => {
    expect(isGovEmail("a@go.kr", [])).toBe(false);
  });
});

describe("질문·답변·신고 입력", () => {
  const base = { tax_type: "취득세", title: "취득세 질문입니다", body: "일반 설명 질문입니다", warning_confirmed: true };

  test("개인정보 경고를 확인하지 않으면 등록 거부", () => {
    expect(parseQuestionInput({ ...base, warning_confirmed: false }).ok).toBe(false);
  });

  test("제목 경계 - 1자 거부, 2자 허용, 120자 허용, 121자 거부", () => {
    expect(parseQuestionInput({ ...base, title: "가" }).ok).toBe(false);
    expect(parseQuestionInput({ ...base, title: "가나" }).ok).toBe(true);
    expect(parseQuestionInput({ ...base, title: "가".repeat(120) }).ok).toBe(true);
    expect(parseQuestionInput({ ...base, title: "가".repeat(121) }).ok).toBe(false);
  });

  test("이메일·전화번호가 있으면 가려 저장하고 게시 보류, 가리기 전 값은 남지 않는다", () => {
    const r = parseQuestionInput({ ...base, body: "연락은 test@example.test 또는 010-1234-5678 로 주세요" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.held).toBe(true);
    expect(r.value.body.text).not.toContain("test@example.test");
    expect(r.value.body.text).not.toContain("1234");
    expect(r.value.maskedKinds).toEqual(expect.arrayContaining(["email", "phone"]));
  });

  test("개인정보가 없으면 보류하지 않는다", () => {
    const r = parseQuestionInput(base);
    expect(r.ok && r.value.held).toBe(false);
  });

  test("답변 본문 길이 경계", () => {
    expect(parseAnswerInput({ body: "가" }).ok).toBe(false);
    expect(parseAnswerInput({ body: "가나" }).ok).toBe(true);
    expect(parseAnswerInput({ body: "가".repeat(4001) }).ok).toBe(false);
  });

  test("신고 입력 - 사유 목록 밖·잘못된 대상 거부, 메모는 가린다", () => {
    expect(parseReportInput({ target_type: "question", target_id: 1, reason: "spam" }).ok).toBe(false);
    expect(parseReportInput({ target_type: "user", target_id: 1, reason: "ad" }).ok).toBe(false);
    expect(parseReportInput({ target_type: "answer", target_id: 0, reason: "ad" }).ok).toBe(false);
    const r = parseReportInput({ target_type: "answer", target_id: 3, reason: "pii", note: "x@example.test 노출" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.note).not.toContain("x@example.test");
  });

  test("신고 처리 목표 - 금요일 접수는 월요일, 수요일 접수는 목요일 (같은 시각)", () => {
    expect(reportDueAt(new Date("2026-10-23T05:00:00Z")).toISOString()).toBe("2026-10-26T05:00:00.000Z");
    expect(reportDueAt(new Date("2026-10-21T05:00:00Z")).toISOString()).toBe("2026-10-22T05:00:00.000Z");
  });
});
