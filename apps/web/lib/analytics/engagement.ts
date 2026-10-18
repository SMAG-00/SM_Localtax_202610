// 30초 이상 열람 (`article_engaged` — PRD-01A 12장 "30초 이상 화면에 머문 조회", GROW-01 분야별 유효 방문의 분자). 순수 모듈 — 시계는 입력으로 받는다.
// 화면이 보이는 동안의 시간만 더한다(탭이 숨으면 멈춘다 — 설계 9장 #14). 기준에 닿으면 한 번만 참. 29초는 0, 30초는 1.

/** PRD 정의 값 — 운영 조정값이 아니라 지표 정의라 코드에 둔다 (설계 6장) */
export const ENGAGED_MS = 30_000;

export class EngagementClock {
  private visibleSince: number | null;
  private accumulated = 0;
  private fired = false;

  constructor(now: number, visible: boolean, private readonly thresholdMs = ENGAGED_MS) {
    this.visibleSince = visible ? now : null;
  }

  /** 보인 시간 합 (ms) */
  visibleMs(now: number): number {
    return this.accumulated + (this.visibleSince === null ? 0 : Math.max(0, now - this.visibleSince));
  }

  /** 탭이 보이게·숨게 바뀜 */
  setVisible(now: number, visible: boolean): void {
    if (visible && this.visibleSince === null) this.visibleSince = now;
    if (!visible && this.visibleSince !== null) {
      this.accumulated += Math.max(0, now - this.visibleSince);
      this.visibleSince = null;
    }
  }

  /** 기준까지 남은 시간 — 숨은 동안·이미 보낸 뒤에는 null (타이머를 걸지 않는다) */
  remaining(now: number): number | null {
    if (this.fired || this.visibleSince === null) return null;
    return Math.max(0, this.thresholdMs - this.visibleMs(now));
  }

  /** 기준에 닿았으면 처음 한 번만 true */
  reached(now: number): boolean {
    if (this.fired || this.visibleMs(now) < this.thresholdMs) return false;
    this.fired = true;
    return true;
  }
}
