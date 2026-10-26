import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { computeIgtRun, igtTotalFor } from "./accuracy";
import { asIgtRuleset } from "./ruleset";

const rs = asIgtRuleset(JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../../rules-igt/2026.07.json"), "utf8")))!;
const gift = { gift_date: "2026-08-10", donor_relationship: "lineal_ascendant", gift_value: 500_000_000 };
const inh = { death_date: "2026-03-15", assets: { real_estate: 2_000_000_000 }, heirs: { spouse_exists: false, children_count: 1 } };

describe("상속·증여 대조 실행 계산 (FAM-12)", () => {
  test("사례 합계는 자진납부세액이다 - 증여 77,600,000원, 상속 426,800,000원", () => {
    expect(igtTotalFor("gift", gift, rs)).toBe(77_600_000);
    expect(igtTotalFor("inheritance", inh, rs)).toBe(426_800_000);
  });
  test("엔진이 거부한 사례는 결과에서 빠지고 오류 목록에 사례 번호가 남는다", () => {
    const r = computeIgtRun(
      [
        { id: 1, tax_kind: "gift", case_input: gift, official_total: 77_600_000 },
        { id: 2, tax_kind: "gift", case_input: { ...gift, gift_value: 0 }, official_total: 0 },
        { id: 3, tax_kind: "acquisition", case_input: gift, official_total: 1 },
        { id: 4, tax_kind: "inheritance", case_input: null, official_total: 1 },
      ],
      rs,
    );
    expect(r.results).toEqual([{ case_id: 1, engine_total: 77_600_000 }]);
    expect(r.errors.map((e) => e.case_id)).toEqual([2, 3, 4]);
  });
});
