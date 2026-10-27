import "server-only";
import { cache } from "react";
import type { Ruleset } from "@ltr/tax-engine";
import type { ExpertRuleset } from "@ltr/tax-engine/expert";
import { expertGateOpen, expertState, type ExpertKind } from "@/lib/calc/expert/gate";
import { loadExpertNotices, loadExpertRuleset } from "@/lib/calc/expert/ruleset";
import { smCard, type ExpertNotices, type SmCard } from "@/lib/calc/expert/view";
import { getCalcTools } from "./calc-tools";
import { readPublicSettings } from "./reads";

// 전문가 계산기 화면 데이터 (W13-f · CALC-17~19) - 기능 키 expert_calc ∧ 공개 게이트(calc_gate_status 세목 줄 + 엔진 해시) ∧ 룰셋 ∧ 고정 안내 문구가
// 모두 맞을 때만 값을 돌려주고 아니면 null(화면 404). 입력값은 받지 않는다 - 계산은 브라우저에서만 한다.

export interface ExpertPage {
  kind: ExpertKind;
  /** 기본 룰셋 (CALC-17의 지분 계산·CALC-18의 취득·보유) */
  ruleset: Ruleset;
  /** 전문가 룰셋 - CALC-18은 쓰지 않아 null일 수 있다 */
  expert: ExpertRuleset | null;
  notices: ExpertNotices;
  /** CALC-18의 SM 비교 계산기 새 창 링크 (주소가 없으면 null) */
  sm: SmCard | null;
}

const SM_COMPARE_KEY = "compare";

export const getExpertPage = cache(async (kind: ExpertKind): Promise<ExpertPage | null> => {
  const tools = await getCalcTools();
  if (!tools || !tools.ruleset) return null;
  const { features } = await readPublicSettings();
  const expert = loadExpertRuleset();
  const notices = loadExpertNotices();
  const state = expertState({
    features: { calc: features.calc, expert_calc: features.expert_calc },
    gateOpen: expertGateOpen(tools.gateRows, kind, tools.engineHash),
    hasRuleset: kind === "entity" ? true : expert !== null,
    hasNotices: notices !== null,
  });
  if (state !== "open" || !notices) return null;
  return { kind, ruleset: tools.ruleset, expert, notices, sm: kind === "entity" && features.sm_calculator ? smCard(tools.links.sm, SM_COMPARE_KEY) : null };
});
