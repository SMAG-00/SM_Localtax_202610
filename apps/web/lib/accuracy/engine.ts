import { createHash } from "node:crypto";
import source from "@ltr/tax-engine/SOURCE.json";
import { calcAcquisition, calcHolding, parseRuleset, type AcquisitionInput, type HoldingInput, type Ruleset } from "@ltr/tax-engine";
import type { Cause, TaxKind } from "@/lib/accuracy/gate";

// 서버 전용 계산(node:crypto) - 클라이언트가 가져오지 않는다. 대조 실행에 쓰는 엔진 호출 (CALC-14) - 순수 계산만. 입력은 감수위원이 넣은 익명 사례의 case_input이다.

/** 엔진 해시 - 복사한 엔진 소스 파일(SOURCE.json의 src/ 항목)의 SHA-256 목록을 다시 해시한 값. 엔진 코드가 바뀌면 달라져 이전 실행이 무효가 된다 */
export const ENGINE_HASH: string = createHash("sha256")
  .update(
    JSON.stringify(
      (source.files as { copy: string; copySha256: string }[])
        .filter((f) => f.copy.startsWith("packages/tax-engine/src/"))
        .map((f) => [f.copy, f.copySha256])
        .sort((a, b) => (a[0]! < b[0]! ? -1 : 1)),
    ),
  )
  .digest("hex");

/** 보유 항목 코드 구분 - 재산세 고지 구성(재산세·지방교육세·지역자원시설세)과 종합부동산세 고지 구성(종부세·농어촌특별세). [감수 필요: 대조 합계 구성] */
const PROPERTY_CODE = /^(PROP_|REGIONAL_RESOURCE)/;
const COMPREHENSIVE_CODE = /^CRET_/;

export class AccuracyEngineError extends Error {}

/** 사례 하나의 엔진 합계(원) - 입력이 엔진 입력 모양이 아니거나 엔진이 거부하면 AccuracyEngineError */
export function engineTotalFor(taxKind: TaxKind, cause: Cause | null, caseInput: unknown, ruleset: Ruleset): number {
  try {
    if (taxKind === "acquisition") {
      const input = { ...(caseInput as object), cause } as AcquisitionInput;
      return calcAcquisition(input, ruleset).total;
    }
    const result = calcHolding(caseInput as HoldingInput, ruleset);
    const re = taxKind === "property" ? PROPERTY_CODE : COMPREHENSIVE_CODE;
    return result.items.filter((i) => re.test(i.code)).reduce((sum, i) => sum + i.amount, 0);
  } catch (err) {
    throw new AccuracyEngineError(err instanceof Error ? err.message.slice(0, 200) : "엔진 오류");
  }
}

export interface CaseRow {
  id: number;
  tax_kind: TaxKind;
  cause: Cause | null;
  case_input: unknown;
  official_total: number;
}

/** 사례 전부를 계산한다. 하나라도 엔진이 거부하면 실행을 기록하지 않기 위해 오류 목록을 함께 돌려준다 */
export function computeRun(
  cases: readonly CaseRow[],
  ruleset: Ruleset,
): { results: { case_id: number; engine_total: number }[]; errors: { case_id: number; message: string }[] } {
  const results: { case_id: number; engine_total: number }[] = [];
  const errors: { case_id: number; message: string }[] = [];
  for (const c of cases) {
    try {
      results.push({ case_id: c.id, engine_total: engineTotalFor(c.tax_kind, c.cause, c.case_input, ruleset) });
    } catch (err) {
      errors.push({ case_id: c.id, message: err instanceof Error ? err.message : "오류" });
    }
  }
  return { results, errors };
}

export { parseRuleset };
