import "server-only";
import { cache } from "react";
import { parseDeterminationTable, parseRuleset, type DeterminationTable, type Ruleset } from "@ltr/tax-engine";
import { ENGINE_HASH } from "@/lib/accuracy/engine";
import { IGT_ENGINE_HASH } from "@/lib/igt/engine-hash";
import type { GateRow } from "@/lib/accuracy/gate";
import type { ToolContext } from "@/lib/calc/tool-link";
import type { WetaxLinkRow } from "@/lib/calc/wetax";
import bundle from "../../../../../rules/bundle.json";
import type { GuideRow } from "@/lib/calc/guide";
import { getCalcView, type CalcView } from "./calc";
import { newestBundled, type RulesetSource } from "./ruleset-bundle-logic";
import { publicDb, rowsOf } from "./db";
import { readPublicSettings } from "./reads";

// 계산기 화면 데이터 (W10-b) - 공개 읽기 뷰만 읽는다(public_calc_gate · public_active_ruleset · public_active_determination · wetax_links · official_links).
//  · 기능 키 calc가 꺼져 있으면 null -> 화면 404.
//  · 공개 여부는 게이트 뷰 + 배포된 엔진 해시에서만 계산한다. settings 수동 켜기 경로 0 (기능 키는 끄는 스위치로만).
//  · 룰셋·판정표는 활성(서명·승인) 행만 온다. 본문이 형식에 맞지 않으면 없는 것으로 친다(그 계산기는 닫힘).
//  · 입력값은 이 모듈이 받지 않는다 - 계산은 브라우저에서만 한다.

export interface CalcTools {
  context: ToolContext;
  features: ToolContext["features"] & { calc_compare: boolean; calc_reduction: boolean; calc_accuracy: boolean; wetax_links: boolean };
  gateRows: GateRow[];
  engineHash: string;
  ruleset: Ruleset | null;
  /** 룰셋을 어디서 읽었나 - 저장소를 읽지 못해 번들로 대신했으면 bundle (CALC-08) */
  rulesetSource: RulesetSource;
  guides: GuideRow[];
  reductionTable: DeterminationTable | null;
  refundTable: DeterminationTable | null;
  wetax: WetaxLinkRow[];
  links: CalcView;
}

const GATE_COLUMNS = "tax_kind, cause_group, ruleset_version, run_at, engine_hash, official_cases, official_matched, sample_cases, sample_matched, is_open";
const WETAX_COLUMNS = "key, kind, tax_kind, label, url, status, fail_count, fallback_key, checked_at";

function tryParse<T>(parse: (raw: unknown) => T, raw: unknown): T | null {
  try {
    return parse(raw);
  } catch {
    return null;
  }
}

/** 번들 룰셋 (CALC-08) - rules/bundle.json의 가장 새 서명 버전. 비어 있으면 null */
async function loadBundledRuleset(): Promise<Ruleset | null> {
  const entry = newestBundled(bundle);
  if (!entry) return null;
  try {
    const mod = (await import(`../../../../../rules/${entry.version}.json`)) as { default: unknown };
    return parseRuleset(mod.default);
  } catch {
    return null;
  }
}

export const getCalcTools = cache(async (): Promise<CalcTools | null> => {
  const settings = await readPublicSettings();
  const f = settings.features;
  if (!f.calc) return null;
  const [gate, rulesets, tables, wetax, links, guides] = await Promise.all([
    rowsOf<GateRow>(publicDb().from("public_calc_gate").select(GATE_COLUMNS), "계산 게이트"),
    rowsOf<{ version: string; body: unknown }>(publicDb().from("public_active_ruleset").select("version, body").limit(1), "활성 룰셋").catch(() => null),
    rowsOf<{ kind: string; version: string; body: unknown }>(publicDb().from("public_active_determination").select("kind, version, body"), "활성 판정표"),
    rowsOf<WetaxLinkRow>(publicDb().from("wetax_links").select(WETAX_COLUMNS).order("sort"), "위택스 링크"),
    getCalcView(),
    rowsOf<GuideRow>(publicDb().from("wetax_guides").select("key, label, body, source, confirmed_on").order("sort"), "위택스 이용 안내").catch(() => [] as GuideRow[]),
  ]);
  // 룰셋 - 저장소를 읽지 못했을 때만 번들(서명된 버전)로 대신한다. 활성 행이 없으면 없는 것(그 계산기는 닫힘)
  let ruleset: Ruleset | null = null;
  let rulesetSource: RulesetSource = "none";
  if (rulesets === null) {
    ruleset = await loadBundledRuleset();
    rulesetSource = ruleset ? "bundle" : "none";
  } else if (rulesets[0]) {
    ruleset = tryParse(parseRuleset, rulesets[0].body);
    rulesetSource = ruleset ? "db" : "none";
  }
  const tableOf = (kind: string) => {
    const row = tables.find((t) => t.kind === kind);
    return row ? tryParse(parseDeterminationTable, row.body) : null;
  };
  const refundTable = tableOf("refund");
  const reductionTable = tableOf("reduction");
  const features = {
    calc: f.calc,
    sm_calculator: f.sm_calculator,
    self_calculator: f.self_calculator,
    calc_acquisition: f.calc_acquisition,
    calc_holding: f.calc_holding,
    calc_refund: f.calc_refund,
    calc_igt_gift: f.calc_igt_gift,
    calc_igt_inheritance: f.calc_igt_inheritance,
    calc_compare: f.calc_compare,
    calc_reduction: f.calc_reduction,
    calc_accuracy: f.calc_accuracy,
    wetax_links: f.wetax_links,
  };
  return {
    // 룰셋이 없으면 세액 계산기는 모두 닫힌다(게이트 뷰도 활성 룰셋이 없으면 닫혀 있다) - 환급 판정표는 서명된 표가 있고 문진표가 있어야 열린다
    context: { features, gateRows: gate, engineHash: ENGINE_HASH, igtEngineHash: IGT_ENGINE_HASH, refundTableActive: !!refundTable && (refundTable.questions?.length ?? 0) > 0 },
    features,
    gateRows: gate,
    engineHash: ENGINE_HASH,
    ruleset,
    rulesetSource,
    guides,
    reductionTable: f.calc_reduction ? reductionTable : null,
    refundTable,
    wetax: f.wetax_links ? wetax : [],
    links: links ?? { sm: [], external: [], fallbacks: [] },
  };
});
