import type { Rate, RulesVersion, Won } from './types';
import { assertWon } from './money';

/**
 * 계산 결과 1행.
 *
 * 코딩 규약상 식별자는 영문, 사람이 읽는 라벨은 한국어를 쓴다.
 *   code   → 세목 코드      label  → 세목(한글)
 *   base   → 과세표준        rate   → 적용세율 (정액세는 null)
 *   amount → 세액           law    → 근거조문
 *   reasons → 판정근거
 */
export interface TaxItem {
  readonly code: string;
  readonly label: string;
  readonly base: Won;
  readonly rate: Rate | null;
  readonly amount: Won;
  readonly law: string;
  readonly reasons: readonly string[];
}

/**
 * 예정신고·납부 기한과 분납 안내.
 * 세액을 바꾸지 않는 **안내 정보**다. 세목(items)이 아니라 결과에 별도로 붙는다.
 */
export interface FilingInfo {
  /** 예정신고·납부 기한 (YYYY-MM-DD) */
  readonly dueDate: string;
  /** 기한 산정 근거 문구 */
  readonly dueNote: string;
  readonly installment: {
    /** 분납 가능 여부 */
    readonly available: boolean;
    /** 분납 가능한 최대 금액(원). 불가 시 0 */
    readonly maxAmount: Won;
    readonly note: string;
  };
  /** 근거조문 */
  readonly law: string;
}

export interface CalcResult {
  readonly items: readonly TaxItem[];
  readonly total: Won;
  readonly rulesVersion: RulesVersion;
  readonly engineVersion: string;
  readonly warnings: readonly string[];
  /** 신고·분납 안내 (룰셋에 filing 데이터가 있는 경우에만) */
  readonly filing?: FilingInfo;
}

/** warnings 접두어. 엔진이 판단 불가한 케이스는 계산을 거부하지 않고 이 접두어로 사유를 남긴다. */
export const EXPERT_REVIEW = '전문가 확인 필요';

/**
 * 결과를 수집하며 warnings를 누적하는 빌더.
 * 세목별 계산기는 이 빌더로만 결과를 만든다 (rulesVersion 각인 강제 — CLAUDE.md 불변 원칙 2).
 */
export class ResultBuilder {
  private readonly items: TaxItem[] = [];
  private readonly warnings: string[] = [];
  private filing?: FilingInfo;

  constructor(private readonly rulesVersion: RulesVersion) {
    if (!rulesVersion) {
      throw new Error('ResultBuilder: rulesVersion 없이 결과를 만들 수 없습니다.');
    }
  }

  /** 신고·분납 안내를 첨부한다 (세액과 무관한 안내 정보) */
  setFiling(info: FilingInfo): this {
    this.filing = info;
    return this;
  }

  add(item: TaxItem): this {
    assertWon(item.base, `${item.code}.base`);
    assertWon(item.amount, `${item.code}.amount`);
    this.items.push(item);
    return this;
  }

  /** 세액이 0이면 행을 추가하지 않는다 (비과세·면제 항목) */
  addIfPositive(item: TaxItem): this {
    if (item.amount > 0) this.add(item);
    return this;
  }

  warn(message: string): this {
    if (!this.warnings.includes(message)) this.warnings.push(message);
    return this;
  }

  /** 전문가 확인이 필요한 사유를 남긴다. 계산은 계속 진행한다. */
  warnExpert(reason: string): this {
    return this.warn(`${EXPERT_REVIEW}: ${reason}`);
  }

  /** 룰셋 항목이 REVIEW_REQUIRED면 경고를 남긴다 */
  checkReview(
    node: { REVIEW_REQUIRED?: boolean; note?: string; law: string },
    label: string,
  ): this {
    if (node.REVIEW_REQUIRED === true) {
      const note = node.note ? ` (${node.note})` : '';
      this.warn(`검수 대상 룰 적용: ${label} [${node.law}]${note}`);
    }
    return this;
  }

  build(engineVersion: string): CalcResult {
    const total = this.items.reduce((sum, item) => sum + item.amount, 0);
    return {
      items: [...this.items],
      total: assertWon(total, 'total'),
      rulesVersion: this.rulesVersion,
      engineVersion,
      warnings: [...this.warnings],
      ...(this.filing ? { filing: this.filing } : {}),
    };
  }
}
