// 30초 이상 열람 시험 (GROW-01 분야별 유효 방문 — "기사 29초 열람은 0, 30초 열람은 1")
import { describe, expect, test } from "vitest";
import { ENGAGED_MS, EngagementClock } from "./engagement";

const S = 1000;

describe("30초 열람 시계", () => {
  test("29초는 아직 아님(남은 1초), 30초에 한 번 — 그 뒤로는 다시 참이 아니다", () => {
    const c = new EngagementClock(0, true);
    expect(c.reached(29 * S)).toBe(false);
    expect(c.remaining(29 * S)).toBe(1 * S);
    expect(c.reached(30 * S - 1)).toBe(false);
    expect(c.reached(30 * S)).toBe(true);
    expect(c.reached(31 * S)).toBe(false);
    expect(c.remaining(31 * S)).toBeNull();
  });

  test("탭이 숨은 시간은 세지 않는다 — 보임 20초 + 숨김 60초 + 보임 9초 = 29초(0) → 10초째 1", () => {
    const c = new EngagementClock(0, true);
    c.setVisible(20 * S, false);
    expect(c.remaining(50 * S)).toBeNull();
    expect(c.reached(80 * S)).toBe(false);
    c.setVisible(80 * S, true);
    expect(c.visibleMs(89 * S)).toBe(29 * S);
    expect(c.reached(89 * S)).toBe(false);
    expect(c.remaining(89 * S)).toBe(1 * S);
    expect(c.reached(90 * S)).toBe(true);
  });

  test("숨은 채 열린 탭(뒤에서 연 기사)은 보일 때부터 센다", () => {
    const c = new EngagementClock(0, false);
    expect(c.reached(100 * S)).toBe(false);
    c.setVisible(100 * S, true);
    expect(c.reached(129 * S)).toBe(false);
    expect(c.reached(130 * S)).toBe(true);
  });

  test("같은 상태를 두 번 알려도 시간이 겹치거나 빠지지 않는다", () => {
    const c = new EngagementClock(0, true);
    c.setVisible(10 * S, true);
    c.setVisible(15 * S, false);
    c.setVisible(16 * S, false);
    expect(c.visibleMs(40 * S)).toBe(15 * S);
  });

  test("기준은 PRD 정의 30초", () => {
    expect(ENGAGED_MS).toBe(30_000);
  });
});
