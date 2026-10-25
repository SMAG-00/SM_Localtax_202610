// 동일 출력 시험 (W11-g g3, FAM-10·11 / 완료 증거 "안심 기준선과 원 단위 동일")
// 기준선 = 안심 Python 엔진 사본을 `python -I -B`로 돌려 고정한 JSON(baseline/baseline.json: 기존 시험 57개가 부른 입력 · 예시 4개 · 시드 고정 무작위 입력).
// 기준선은 안심 현행 동작이지 법령 정답 판정이 아니다. 숫자·단계 이름·근거·설명 글·경고·납부 안내까지 전부 같아야 통과한다.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { calcGift, calcInheritance } from "../src/index";
import type { IgtRuleset } from "../src/index";

const dir = path.dirname(fileURLToPath(import.meta.url));
const readJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(dir, rel), "utf8"));
const baseline = readJson("../baseline/baseline.json") as {
  ruleset_version: string;
  source_suite: { tests_run: number; failures: number };
  cases: Array<{ source: string; fn: string; input?: Record<string, unknown>; ruleset?: IgtRuleset; args?: unknown[]; result?: any; calc_error?: string; exception?: string }>;
};
const referenceRuleset = readJson("../reference/rulesets/igt_rules_current.json") as IgtRuleset;
const draftRuleset = readJson("../../../rules-igt/2026.07.json") as IgtRuleset;

const engineCases = baseline.cases.filter((c) => c.fn === "calc_gift" || c.fn === "calc_inheritance");

function run(c: (typeof engineCases)[number], rs: IgtRuleset) {
  return c.fn === "calc_gift" ? calcGift(c.input!, rs) : calcInheritance(c.input!, rs);
}

describe("기준선 구성", () => {
  it("안심 시험 57개가 사본에서 전부 통과한 상태로 기준선을 만들었다", () => {
    expect(baseline.source_suite).toEqual({ tests_run: 57, failures: 0 });
    expect(baseline.ruleset_version).toBe("2026.07.12-v1");
  });
  it("기존 시험 호출 · 예시 4개 · 무작위 증여/상속이 모두 들어 있다", () => {
    const by = (p: string) => baseline.cases.filter((c) => c.source.startsWith(p)).length;
    expect(by("test_calc_igt")).toBeGreaterThanOrEqual(57);
    expect(by("example:")).toBe(4);
    expect(by("random:gift")).toBeGreaterThanOrEqual(200);
    expect(by("random:inheritance")).toBeGreaterThanOrEqual(200);
  });
});

describe("원 단위 동일 출력 - 사본 룰셋(2026.07.12-v1)", () => {
  for (const c of engineCases) {
    it(`${c.source} ${c.fn}`, () => {
      const rs = c.ruleset ?? referenceRuleset;
      if (c.calc_error !== undefined) {
        expect(() => run(c, rs)).toThrowError(c.calc_error);
        try {
          run(c, rs);
        } catch (e) {
          expect((e as Error).name).toBe("IgtCalcError");
        }
      } else if (c.exception !== undefined) {
        expect(() => run(c, rs)).toThrow();
      } else {
        expect(run(c, rs)).toEqual(c.result);
      }
    });
  }
});

describe("rules-igt 초안 룰셋도 같은 값 - 버전 글자만 다르다", () => {
  it("초안 파일은 draft이고 서명 기록이 없다", () => {
    const d = draftRuleset as unknown as Record<string, unknown>;
    expect(d.status).toBe("draft");
    expect(Object.keys(d).filter((k) => /sign|approv|reviewed/i.test(k))).toEqual([]);
    expect(d.version).toBe("2026.07");
  });
  const ok = engineCases.filter((c) => c.calc_error === undefined && c.exception === undefined && !c.ruleset);
  it("무오류 사례 전부에서 룰셋 버전 글자를 빼고 같은 결과", () => {
    expect(ok.length).toBeGreaterThan(500);
    for (const c of ok) {
      const got = run(c, draftRuleset);
      expect(got.ruleset_version).toBe("2026.07");
      expect({ ...got, ruleset_version: baseline.ruleset_version }).toEqual(c.result);
    }
  });
});

describe("순수성 - 같은 입력은 같은 출력, 입력은 바뀌지 않는다", () => {
  it("입력을 깊이 얼려도 계산되고 두 번 불러도 같다", () => {
    const deepFreeze = <T,>(o: T): T => {
      if (o && typeof o === "object") for (const v of Object.values(o)) deepFreeze(v);
      return Object.freeze(o);
    };
    for (const c of engineCases.filter((x) => x.source.startsWith("example:"))) {
      const frozen = deepFreeze(structuredClone(c.input!));
      const rs = deepFreeze(structuredClone(referenceRuleset));
      expect(run({ ...c, input: frozen }, rs)).toEqual(run({ ...c, input: frozen }, rs));
      expect(frozen).toEqual(c.input);
    }
  });
});
