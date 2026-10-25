import { describe, expect, test } from "vitest";
import { course as courseNode, event as eventNode } from "@ltr/structured-data";
import {
  applyLinkOf,
  courseStructured,
  parseQuoteInput,
  QUOTE_CODES,
  seminarScreenStatus,
  seminarStructured,
  type QuoteContext,
} from "./rules";

const ctx: QuoteContext = { messageMaxChars: 100, courseIds: [7, 9], consentItemCount: 2 };
const base = {
  org_name: "시험용 시청",
  org_type: "public",
  contact_name: "시험용 담당",
  email: "tester@example.test",
  course_id: "7",
  headcount: "30",
  consent_0: "on",
  consent_1: "on",
};

describe("parseQuoteInput - 위탁교육 견적 요청 입력 (BIZ-06)", () => {
  test("필수 칸을 모두 채우면 검사된 값을 돌려준다 (과정 번호가 있으면 과정 이름 칸은 비운다)", () => {
    const r = parseQuoteInput({ ...base, course_text: "버려질 이름", preferred_period: "시험용 다음 분기" }, ctx);
    expect(r).toEqual({
      ok: true,
      value: {
        org_name: "시험용 시청",
        org_type: "public",
        contact_name: "시험용 담당",
        email: "tester@example.test",
        phone: null,
        course_id: 7,
        course_text: null,
        headcount: 30,
        preferred_period: "시험용 다음 분기",
        message: null,
      },
    });
  });

  test.each([
    ["기관명 없음", { org_name: "  " }, "org_name"],
    ["기관명 81자", { org_name: "가".repeat(81) }, "org_name"],
    ["기관 종류가 목록 밖", { org_type: "government" }, "org_type"],
    ["담당자 없음", { contact_name: "" }, "contact_name"],
    ["이메일·전화 둘 다 없음", { email: "" }, "contact"],
    ["이메일 모양 틀림", { email: "tester@@example" }, "email"],
    ["전화 7자리", { email: "", phone: "010-123-4" }, "phone"],
    ["공개 과정 밖의 번호", { course_id: "8" }, "course"],
    ["과정 번호도 이름도 없음", { course_id: "" }, "course"],
    ["인원 0", { headcount: "0" }, "headcount"],
    ["인원 소수", { headcount: "2.5" }, "headcount"],
    ["인원 100001", { headcount: "100001" }, "headcount"],
    ["희망 시기 101자", { preferred_period: "가".repeat(101) }, "period_long"],
    ["문의 내용 101자 (상한 100)", { message: "가".repeat(101) }, "message_long"],
    ["문의 내용에 긴 숫자(구분 문자 우회)", { message: "계좌 110-123-456-789" }, "sensitive"],
    ["동의 하나 빠짐", { consent_1: "" }, "consent"],
  ])("거부 - %s", (_name, patch, code) => {
    const r = parseQuoteInput({ ...base, ...patch }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe(code);
      expect(QUOTE_CODES[r.code].length).toBeGreaterThan(0);
    }
  });

  test("경계 - 문의 내용 정확히 100자는 통과, 인원 1과 100000은 통과", () => {
    expect(parseQuoteInput({ ...base, message: "가".repeat(100) }, ctx).ok).toBe(true);
    expect(parseQuoteInput({ ...base, headcount: "1" }, ctx).ok).toBe(true);
    expect(parseQuoteInput({ ...base, headcount: "100000" }, ctx).ok).toBe(true);
  });

  test("과정 번호 없이 과정 이름만 적어도 받는다", () => {
    const r = parseQuoteInput({ ...base, course_id: "", course_text: "시험용 맞춤 과정" }, ctx);
    expect(r.ok && r.value.course_id).toBe(null);
    expect(r.ok && r.value.course_text).toBe("시험용 맞춤 과정");
  });

  test("결제·카드 칸이 들어와도 값에 싣지 않는다 (견적 결제 칸 0)", () => {
    const r = parseQuoteInput({ ...base, card_number: "4111111111111111", amount: "100", price: "9" }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.value).join(",")).not.toMatch(/card|amount|price|pay|fee/i);
  });
});

describe("applyLinkOf - 교육원 신청 링크 (점검 결과 반영)", () => {
  test("정상·미점검 주소는 나오고, 오류(broken)·빈 주소·http 아닌 주소는 숨긴다", () => {
    expect(applyLinkOf("https://edu.example.test/apply", "ok")).toEqual({ href: "https://edu.example.test/apply" });
    expect(applyLinkOf("https://edu.example.test/apply", "unchecked")).toEqual({ href: "https://edu.example.test/apply" });
    expect(applyLinkOf("https://edu.example.test/apply", "broken")).toBeNull();
    expect(applyLinkOf(null, "ok")).toBeNull();
    expect(applyLinkOf("javascript:alert(1)", "ok")).toBeNull();
  });
});

describe("seminarScreenStatus - 세미나 배지", () => {
  const row = { status: "published" as const, starts_at: "2026-11-10T10:00:00+09:00", ends_at: "2026-11-10T12:00:00+09:00" };
  test.each([
    ["시작 1초 전", "2026-11-10T09:59:59+09:00", "예정"],
    ["시작 시각", "2026-11-10T10:00:00+09:00", "진행"],
    ["끝 시각", "2026-11-10T12:00:00+09:00", "진행"],
    ["끝난 1초 뒤", "2026-11-10T12:00:01+09:00", "종료"],
  ])("%s -> %s", (_n, at, expected) => {
    expect(seminarScreenStatus(row, new Date(at))).toBe(expected);
  });
  test("취소·변경 확인 중은 시각과 상관없이 저장된 상태", () => {
    expect(seminarScreenStatus({ ...row, status: "cancelled" }, new Date("2030-01-01T00:00:00+09:00"))).toBe("취소");
    expect(seminarScreenStatus({ ...row, status: "changing" }, new Date("2026-11-10T11:00:00+09:00"))).toBe("변경 확인 중");
  });
});

describe("구조화 데이터 = 화면 (OPT-02)", () => {
  const origin = "https://site.example.test";
  const screen = {
    slug: "amend-basics",
    title: "시험용 개정세법 강좌",
    summary: "시험용 강좌 소개입니다.",
    audience: "시험용 담당 공무원",
    provider_name: "시험용 교육기관",
    sessions: [
      { starts_on: "2026-12-01", ends_on: "2026-12-03", mode: "onsite" as const, location_name: "시험용 강의실", status: "scheduled" as const },
      { starts_on: "2026-12-10", ends_on: null, mode: "online" as const, location_name: null, status: "cancelled" as const },
    ],
  };

  test("Course - 강좌명·제공기관·대상·진행 중인 회차만, 수강료는 없다", () => {
    const node = courseNode(courseStructured(screen, origin)) as Record<string, unknown>;
    expect(node["@type"]).toBe("Course");
    expect(node.name).toBe("시험용 개정세법 강좌");
    expect(node.url).toBe("https://site.example.test/edu/amend-basics");
    expect((node.provider as Record<string, unknown>).name).toBe("시험용 교육기관");
    const instances = node.hasCourseInstance as Record<string, unknown>[];
    expect(instances).toHaveLength(1);
    expect(instances[0]!.startDate).toBe("2026-12-01");
    expect(instances[0]!.endDate).toBe("2026-12-03");
    expect(JSON.stringify(node)).not.toMatch(/offers|price|priceCurrency/);
  });

  const seminar = {
    slug: "dev-fin-1",
    title: "시험용 개발금융 세미나",
    summary: "",
    starts_at: "2026-11-10T10:00:00+09:00",
    ends_at: "2026-11-10T12:00:00+09:00",
    venue_name: null,
    organizer_name: "시험용 주최",
    sponsored: true,
    status: "예정" as const,
    apply_url: null,
  };

  test("Event - 협찬이면 제목에 광고 표기, 상태가 취소면 EventCancelled, 변경 확인 중이면 데이터를 내지 않는다", () => {
    const node = eventNode(seminarStructured(seminar, origin)) as Record<string, unknown>;
    expect(String(node.name)).toContain("광고");
    expect(String(node.name)).toContain("시험용 개발금융 세미나");
    expect(node.eventStatus).toBe("https://schema.org/EventScheduled");
    expect(node.startDate).toBe("2026-11-10T10:00:00+09:00");
    const cancelled = eventNode(seminarStructured({ ...seminar, status: "취소" }, origin)) as Record<string, unknown>;
    expect(cancelled.eventStatus).toBe("https://schema.org/EventCancelled");
    expect(eventNode(seminarStructured({ ...seminar, status: "변경 확인 중" }, origin))).toBeNull();
  });
});
