import type { Won } from './types';
import type { Ruleset } from './schema';
import { ResultBuilder, type CalcResult } from './result';
import { taxOf } from './brackets';
import { floorWon } from './money';
import { ENGINE_VERSION } from './version';
import { pct } from './acquisition';
import { formatWon } from './money';

export interface OligopolyInput {
  /** 법인이 보유한 부동산등의 장부가액 합계 (원) */
  readonly bookValue: Won;
  /** 취득 전 지분율 (0~1) */
  readonly beforeRatio: number;
  /** 취득 후 지분율 (0~1) */
  readonly afterRatio: number;
  /**
   * 최초로 과점주주가 되는 경우인지.
   * 미지정 시 beforeRatio가 threshold 이하이고 afterRatio가 초과하면 최초로 본다.
   */
  readonly isFirstTime?: boolean;
}

/**
 * 과점주주 간주취득세 (지방세법 §7⑤).
 *
 * - 판정: 취득 후 지분율이 50%를 **초과**해야 과점주주다. 정확히 50%는 해당하지 않는다.
 * - 최초 과점주주: 취득 후 지분율 전체가 과세표준 산정에 쓰인다.
 * - 이미 과점주주: 지분 **증가분**만 과세한다. 지분이 늘지 않으면 과세하지 않는다.
 *
 * 순수 함수. 네트워크·파일 I/O·LLM 호출 없음 (CLAUDE.md 불변 원칙 1).
 */
export function calcOligopoly(input: OligopolyInput, ruleset: Ruleset): CalcResult {
  const rb = new ResultBuilder(ruleset.version);
  const oli = ruleset.oligopoly;

  validateRatio(input.beforeRatio, 'beforeRatio');
  validateRatio(input.afterRatio, 'afterRatio');

  const threshold = oli.threshold;
  const isOligopoly = input.afterRatio > threshold;

  // ── 과점주주 판정 ────────────────────────────────────────
  if (!isOligopoly) {
    rb.add({
      code: 'OLIGOPOLY_DEEMED_ACQ',
      label: '간주취득세',
      base: 0,
      rate: 0,
      amount: 0,
      law: oli.deemed_acquisition.law,
      reasons: [
        `취득 후 지분율 ${pctOf(input.afterRatio)} ≤ ${pctOf(threshold)} → 과점주주 아님 → 간주취득세 없음`,
      ],
    });
    return rb.build(ENGINE_VERSION);
  }

  // ── 과세 지분율 산정 ──────────────────────────────────────
  const wasOligopoly = input.beforeRatio > threshold;
  const firstTime = input.isFirstTime ?? !wasOligopoly;

  let taxableRatio: number;
  const reasons: string[] = [];

  if (firstTime) {
    taxableRatio = input.afterRatio;
    reasons.push(
      `최초로 과점주주가 됨 (${pctOf(input.beforeRatio)} → ${pctOf(input.afterRatio)}) → 취득 후 지분율 전체 ${pctOf(taxableRatio)}가 과세대상`,
    );
  } else {
    taxableRatio = input.afterRatio - input.beforeRatio;
    if (taxableRatio <= 0) {
      rb.add({
        code: 'OLIGOPOLY_DEEMED_ACQ',
        label: '간주취득세',
        base: 0,
        rate: 0,
        amount: 0,
        law: oli.deemed_acquisition.law,
        reasons: [
          `이미 과점주주이며 지분 증가분이 없음 (${pctOf(input.beforeRatio)} → ${pctOf(input.afterRatio)}) → 간주취득세 없음`,
        ],
      });
      return rb.build(ENGINE_VERSION);
    }
    reasons.push(
      `이미 과점주주 (${pctOf(input.beforeRatio)}) → 증가분 ${pctOf(taxableRatio)}만 과세`,
    );
    rb.warnExpert(
      '과거에 과점주주였다가 지분이 낮아진 뒤 다시 취득한 경우, 과세표준은 "종전 최고 지분율" 대비 증가분으로 산정합니다. ' +
        '이 엔진은 직전 지분율만 보므로 지분 변동 이력이 있으면 전문가 확인이 필요합니다.',
    );
  }

  const taxableRatioRounded = Math.round(taxableRatio * 1e10) / 1e10;
  const base = floorWon(input.bookValue * taxableRatioRounded);
  reasons.push(
    `과세표준 = 부동산등 장부가액 ${formatWon(input.bookValue)} × ${pctOf(taxableRatioRounded)} = ${formatWon(base)}`,
  );

  // ── 간주취득세 본세 ───────────────────────────────────────
  rb.checkReview(oli.deemed_acquisition, '과점주주 간주취득세');
  const rate = oli.deemed_acquisition.rate ?? 0;
  const mainTax = taxOf(base, rate);
  rb.add({
    code: 'OLIGOPOLY_DEEMED_ACQ',
    label: '간주취득세',
    base,
    rate,
    amount: mainTax,
    law: oli.deemed_acquisition.law,
    reasons: [...reasons, `중과기준세율 ${pct(rate)} 적용`],
  });

  // ── 지방교육세 (부과 여부는 룰셋 플래그로 제어) ────────────
  const edu = oli.surtax.local_education;
  rb.checkReview(edu, '간주취득세 지방교육세');
  if (edu.applies) {
    const eduRate = edu.rate ?? 0;
    // 부과하기로 해 놓고 세율이 0이면 세액이 0으로 나오고 addIfPositive가 행까지 버린다 —
    // 결정이 반영된 줄 알고 넘어가게 된다. 설정 오류를 조용히 삼키지 않고 드러낸다.
    if (eduRate === 0) {
      rb.warnExpert(
        '룰셋이 간주취득세 지방교육세를 부과(applies=true)로 설정했으나 세율이 0%라 세액이 산출되지 않았습니다. ' +
          '부과로 확정했다면 세율(rate)도 함께 지정해야 합니다 — 룰셋 설정 오류입니다.',
      );
    }
    rb.addIfPositive({
      code: 'OLIGOPOLY_LOCAL_EDU',
      label: '지방교육세',
      base,
      rate: eduRate,
      amount: taxOf(base, eduRate),
      law: edu.law,
      reasons: [edu.condition],
    });
  } else {
    rb.warnExpert(
      '과점주주 간주취득세에 지방교육세를 부과할지는 실무 해석이 갈립니다. ' +
        '현재 룰셋은 미부과(applies=false)로 설정돼 있습니다. 세무본부 확정이 필요합니다.',
    );
  }

  // ── 농어촌특별세 ──────────────────────────────────────────
  const rural = oli.surtax.rural_special;
  rb.checkReview(rural, '간주취득세 농어촌특별세');
  rb.addIfPositive({
    code: 'OLIGOPOLY_RURAL',
    label: '농어촌특별세',
    base,
    rate: rural.rate ?? 0,
    amount: taxOf(base, rural.rate ?? 0),
    law: rural.law,
    reasons: [rural.condition],
  });

  return rb.build(ENGINE_VERSION);
}

function validateRatio(ratio: number, label: string): void {
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new RangeError(`calcOligopoly: ${label}는 0 이상 1 이하여야 합니다 (${ratio})`);
  }
}

function pctOf(ratio: number): string {
  return `${(ratio * 100).toFixed(4).replace(/\.?0+$/, '')}%`;
}
