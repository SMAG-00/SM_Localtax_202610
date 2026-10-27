import { describe, expect, it } from "vitest";
import { groupDueByUser, isKstMonday, kstDay, notifyToken, renderBriefingMail, renderDigest, verifyNotifyToken, weekPeriod } from "./logic";
import { parseBriefingMax, selectBriefingItems, type BriefingCandidate } from "../briefing/select";

const U = "11111111-2222-3333-4444-555555555555";

describe("weekPeriod", () => {
  it("한국 날짜 기준 ISO 주차 - 월요일 00:00 KST(일요일 15:00 UTC)부터 새 주차", () => {
    expect(weekPeriod(new Date("2026-10-25T14:59:00Z"))).toBe("2026-W43");
    expect(weekPeriod(new Date("2026-10-25T15:00:00Z"))).toBe("2026-W44");
  });
  it("연말·연초 경계 - 2026-12-31은 2026-W53, 2027-01-03(일)도 W53, 01-04(월)는 2027-W01", () => {
    expect(weekPeriod(new Date("2026-12-31T00:00:00Z"))).toBe("2026-W53");
    expect(weekPeriod(new Date("2027-01-03T00:00:00Z"))).toBe("2026-W53");
    expect(weekPeriod(new Date("2027-01-04T00:00:00Z"))).toBe("2027-W01");
  });
});

describe("한국 날짜·월요일 판정", () => {
  it("UTC 일요일 23:15는 한국 월요일 08:15", () => {
    const t = new Date("2026-10-25T23:15:00Z");
    expect(kstDay(t)).toBe("2026-10-26");
    expect(isKstMonday(t)).toBe(true);
    expect(isKstMonday(new Date("2026-10-26T23:15:00Z"))).toBe(false);
  });
});

describe("수신 거부 토큰", () => {
  it("맞는 비밀이면 회원 번호를 돌려주고, 다른 비밀·변조·형식 오류는 null", () => {
    const t = notifyToken("secret-a", U);
    expect(verifyNotifyToken("secret-a", t)).toBe(U);
    expect(verifyNotifyToken("secret-b", t)).toBeNull();
    expect(verifyNotifyToken("secret-a", t.slice(0, -1) + (t.endsWith("A") ? "B" : "A"))).toBeNull();
    expect(verifyNotifyToken("secret-a", "x")).toBeNull();
    expect(verifyNotifyToken("", t)).toBeNull();
  });
});

describe("묶음 메일", () => {
  it("항목 줄과 수신 거부 링크를 담고 건수가 제목에 나온다", () => {
    const rows = [
      { kind: "region" as const, label: "시험용 지역 기사", link: "/news/a" },
      { kind: "law" as const, label: "시험용 조문", link: "/law/1" },
    ];
    const m = renderDigest(rows, "https://x.test", "https://x.test/notifications/unsubscribe?t=1");
    expect(m.subject).toContain("2건");
    expect(m.text).toContain("https://x.test/news/a");
    expect(m.text).toContain("수신 거부: https://x.test/notifications/unsubscribe?t=1");
  });
  it("브리핑 메일에도 수신 거부 링크와 기준일", () => {
    const m = renderBriefingMail("2026-W44", [{ title: "시험용", link: "/news/b", basisOn: "2026-10-26" }], "https://x.test", "https://x.test/u");
    expect(m.text).toContain("기준일 2026-10-26");
    expect(m.text).toContain("수신 거부: https://x.test/u");
  });
  it("회원별로 묶는다", () => {
    const g = groupDueByUser([
      { id: 1, user_id: "a", kind: "region", label: "x", link: "/x", mail: true },
      { id: 2, user_id: "b", kind: "region", label: "y", link: "/y", mail: true },
      { id: 3, user_id: "a", kind: "law", label: "z", link: "/z", mail: true },
    ]);
    expect(g.get("a")?.map((r) => r.id)).toEqual([1, 3]);
    expect(g.get("b")?.length).toBe(1);
  });
});

describe("selectBriefingItems", () => {
  const c = (type: BriefingCandidate["type"], id: number, reason: BriefingCandidate["reason"], basisOn: string): BriefingCandidate => ({ type, id, reason, basisOn });
  const set = [c("article", 3, "interest", "2026-10-20"), c("article", 1, "region", "2026-10-21"), c("article", 2, "saved_search", "2026-10-19"), c("case_summary", 9, "case_summary", "2026-10-22"), c("article", 4, "region", "2026-10-23")];
  it("이유 우선순위, 최신, 번호 순이고 입력 순서가 달라도 결과가 같다", () => {
    const a = selectBriefingItems(set, 10);
    expect(a.map((i) => `${i.type}:${i.id}`)).toEqual(["article:2", "article:4", "article:1", "article:3", "case_summary:9"]);
    expect(selectBriefingItems([...set].reverse(), 10)).toEqual(a);
  });
  it("상한 경계 - max 1이면 1건, max 0·음수·소수는 빈 목록", () => {
    expect(selectBriefingItems(set, 1)).toHaveLength(1);
    expect(selectBriefingItems(set, 0)).toEqual([]);
    expect(selectBriefingItems(set, -1)).toEqual([]);
    expect(selectBriefingItems(set, 1.5)).toEqual([]);
  });
  it("같은 기사가 여러 이유로 오면 우선순위 높은 이유 하나만", () => {
    const r = selectBriefingItems([c("article", 5, "interest", "2026-10-20"), c("article", 5, "saved_search", "2026-10-20")], 5);
    expect(r).toEqual([{ type: "article", id: 5, reason: "saved_search", basis_on: "2026-10-20" }]);
  });
  it("번호·기준일 모양이 틀린 후보는 버린다, 후보가 없으면 빈 목록", () => {
    expect(selectBriefingItems([c("article", 0, "region", "2026-10-20"), c("article", 1, "region", "10/20")], 5)).toEqual([]);
    expect(selectBriefingItems([], 5)).toEqual([]);
  });
  it("정책 값 읽기 - 비어 있거나 틀리면 0", () => {
    expect(parseBriefingMax({ max_items: 8 })).toBe(8);
    expect(parseBriefingMax({})).toBe(0);
    expect(parseBriefingMax({ max_items: "8" })).toBe(0);
    expect(parseBriefingMax({ max_items: 51 })).toBe(0);
    expect(parseBriefingMax(null)).toBe(0);
  });
});
