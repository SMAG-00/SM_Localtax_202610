import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseRuleset, type Ruleset } from "@ltr/tax-engine";
import type { GateRow } from "@/lib/accuracy/gate";

// 시험 도우미 - 저장소의 초안 룰셋 파일(rules/2026.01.json, 미감수)을 엔진에 그대로 읽힌다. 시험은 값 하나하나가 아니라 관계(합계=행 합, 입력 분기)를 확인한다.
export const RULESET: Ruleset = parseRuleset(JSON.parse(readFileSync(fileURLToPath(new URL("../../../../rules/2026.01.json", import.meta.url)), "utf8")));

export const ENGINE_HASH = "h".repeat(64);

export function gateRow(over: Partial<GateRow> & Pick<GateRow, "tax_kind" | "cause_group">): GateRow {
  return {
    ruleset_version: "2026.01",
    last_run_id: 1,
    run_at: "2026-10-20T01:00:00Z",
    engine_hash: ENGINE_HASH,
    official_cases: 30,
    official_matched: 30,
    sample_cases: 50,
    sample_matched: 50,
    is_open: true,
    ...over,
  };
}

export const ALL_OPEN: GateRow[] = [
  gateRow({ tax_kind: "acquisition", cause_group: "OTHER" }),
  gateRow({ tax_kind: "acquisition", cause_group: "INHERITANCE" }),
  gateRow({ tax_kind: "acquisition", cause_group: "GIFT" }),
  gateRow({ tax_kind: "property", cause_group: "ALL" }),
  gateRow({ tax_kind: "comprehensive", cause_group: "ALL" }),
];
