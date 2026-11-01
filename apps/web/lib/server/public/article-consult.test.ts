import { describe, expect, test } from "vitest";
import { consultBox } from "./article-logic";

describe("칼럼 끝 무료상담 상자 (PO 2026-11-01)", () => {
  const open = { experts: true, expert_requests: true };
  const contact = { phone: "010-1234-5678", telHref: "tel:01012345678", kakaoUrl: null, freeScope: "첫 상담 30분 전화 무료" };

  test("칼럼이고 전문가 소개·연락 요청이 둘 다 열리면 출처 article로 여는 상자 + 바로 연락", () => {
    expect(consultBox("opinion", open, contact)).toEqual({ href: "/experts/request?source=article", directContact: contact });
    expect(consultBox("opinion", open, null)).toEqual({ href: "/experts/request?source=article", directContact: null });
  });

  test("칼럼이 아니거나 둘 중 하나라도 닫혀 있으면 상자 0 (도착 화면이 없을 때 버튼 0)", () => {
    expect(consultBox("explainer", open, contact)).toBeNull();
    expect(consultBox(null, open, contact)).toBeNull();
    expect(consultBox("opinion", { experts: true, expert_requests: false }, contact)).toBeNull();
    expect(consultBox("opinion", { experts: false, expert_requests: true }, contact)).toBeNull();
  });
});
