import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { groupOpen } from "@/lib/accuracy/gate";
import { createCalcPort, type CalcGate, type CalcPort, type CardLink, type GateState } from "@/lib/agent/calc-run";
import { EMPTY_DICTIONARY, type RequirementDictionary } from "@/lib/agent/clarify";
import { topicsFromDictionary, type DictionaryRow } from "@/lib/agent/dictionary-link";
import { toolLinkFor, type ToolContext } from "@/lib/calc/tool-link";
import { PROJECT_TAX_KINDS } from "@/lib/tax-guide/determination-run";
import { getCalcTools } from "@/lib/server/public/calc-tools";
import { getDeterminationBundle } from "@/lib/server/public/tax-guide";

// 지방세봇 계산·감면·판정 포트 (W12-c) - 공개 읽기(게이트 뷰·활성 룰셋·활성 판정표)로만 만든다. 쓰기 0.
// 게이트 판단은 toolLinkFor 한 곳(기능 키 + 공개 게이트 + 엔진 해시)이다. 이 파일은 lib/igt를 직접 불러오지 않는다(NT9) -
// 상속·증여 카드는 toolLinkFor의 결과를 lib/agent의 순수 함수에 주입한다.

const CLOSED_CTX: ToolContext = {
  features: { calc: false, sm_calculator: false, self_calculator: false, calc_acquisition: false, calc_holding: false, calc_refund: false },
  gateRows: [],
  engineHash: "",
  refundTableActive: false,
};

const toCard = (l: ReturnType<typeof toolLinkFor>): CardLink => l;

function gateOf(ctx: ToolContext): CalcGate {
  const f = ctx.features;
  const why = (keyOn: boolean): GateState => (f.calc && f.self_calculator && keyOn ? "gate_closed" : "feature_off");
  return {
    acquisition: (cause) => (toolLinkFor("acquisition", cause, ctx).kind === "self" ? "open" : why(f.calc_acquisition)),
    holding: () => {
      const state: GateState = toolLinkFor("holding", null, ctx).kind === "self" ? "open" : why(f.calc_holding);
      return {
        state,
        open: { property: groupOpen(ctx.gateRows, "property", "ALL", ctx.engineHash), comprehensive: groupOpen(ctx.gateRows, "comprehensive", "ALL", ctx.engineHash) },
      };
    },
    igtCard: (kind) => toCard(toolLinkFor(kind === "gift" ? "gift_tax" : "inheritance_tax", null, ctx)),
  };
}

/** 한 요청 동안 쓸 포트. 계산 기능 키가 꺼져 있어도 상속·증여 카드(외부 계산기)는 고를 수 있다 */
export async function loadCalcPort(): Promise<CalcPort> {
  const [tools, bundle] = await Promise.all([getCalcTools().catch(() => null), getDeterminationBundle(PROJECT_TAX_KINDS).catch(() => ({ tables: {}, fields: {} }))]);
  const ctx = tools?.context ?? CLOSED_CTX;
  return createCalcPort({
    gate: gateOf(ctx),
    ruleset: tools?.ruleset ?? null,
    reductionTable: tools?.reductionTable ?? null,
    determinationTables: bundle.tables,
  });
}

/** 3단계 공개 요건 사전 -> 역질문 사전 (읽기 실패·본문이 맞지 않으면 빈 사전) */
export async function loadRequirementDictionary(client: SupabaseClient): Promise<RequirementDictionary> {
  const { data, error } = await client.from("public_requirement_dictionary").select("topic, version, body");
  if (error || !Array.isArray(data)) return EMPTY_DICTIONARY;
  const dict = topicsFromDictionary(data as DictionaryRow[]);
  return dict.topics.length > 0 ? dict : EMPTY_DICTIONARY;
}
