import "server-only";
import { cache } from "react";
import type { IgtRuleset } from "@ltr/igt-engine";
import { publicDb, rowsOf } from "@/lib/server/public/db";
import { readPublicSettings } from "@/lib/server/public/reads";
import { IGT_ENGINE_HASH } from "./engine-hash";
import { igtGateOpen, lensOwnFilter, type IgtGateRow, type IgtKind, type LensOwn, type OwnState } from "./gate";
import { asIgtRuleset } from "./ruleset";

// 상속·증여세 계산기 화면 데이터 (FAM-10·11) - 공개 읽기 뷰만 읽는다(public_calc_gate · public_igt_active_ruleset).
//  · 기능 키가 꺼져 있거나 게이트(뷰 + 엔진 해시)가 닫혀 있거나 활성 룰셋이 없으면 null -> 화면 404, 외부 계산기 카드(FAM-08)는 그대로 남는다.
//  · 입력값은 이 모듈이 받지 않는다 - 계산은 브라우저에서만 한다. 서버 계산 API 0.

export interface IgtTool {
  kind: IgtKind;
  ruleset: IgtRuleset;
  rulesetVersion: string;
  engineHash: string;
}

export const getIgtTool = cache(async (kind: IgtKind): Promise<IgtTool | null> => {
  const { features } = await readPublicSettings();
  const keyOn = kind === "gift" ? features.calc_igt_gift : features.calc_igt_inheritance;
  if (!features.calc || !keyOn) return null;
  const [gate, active] = await Promise.all([
    rowsOf<IgtGateRow>(publicDb().from("public_calc_gate").select("tax_kind, cause_group, engine_hash, is_open").in("tax_kind", ["gift", "inheritance"]), "상속·증여세 게이트"),
    rowsOf<{ version: string; body: unknown }>(publicDb().from("public_igt_active_ruleset").select("version, body").limit(1), "상속·증여세 활성 룰셋"),
  ]);
  if (!igtGateOpen(gate, kind, IGT_ENGINE_HASH)) return null;
  const row = active[0];
  const ruleset = row ? asIgtRuleset(row.body) : null;
  if (!row || !ruleset) return null;
  return { kind, ruleset, rulesetVersion: row.version, engineHash: IGT_ENGINE_HASH };
});

/** 외부 계산기 카드 자리의 자체 카드 전환 상태 (FAM-14) - 기능 키 + 공개 게이트 + 엔진 해시가 모두 맞는 세목만. toolLinkFor 와 같은 조건이다 */
export const getOwnCardState = cache(async (): Promise<OwnState> => {
  const { features: f } = await readPublicSettings();
  const closed = { gift: false, inheritance: false };
  if (!f.calc || !f.self_calculator || !(f.calc_igt_gift || f.calc_igt_inheritance)) return closed;
  const gate = await rowsOf<IgtGateRow>(publicDb().from("public_calc_gate").select("tax_kind, cause_group, engine_hash, is_open").in("tax_kind", ["gift", "inheritance"]), "상속·증여세 게이트");
  return { gift: f.calc_igt_gift && igtGateOpen(gate, "gift", IGT_ENGINE_HASH), inheritance: f.calc_igt_inheritance && igtGateOpen(gate, "inheritance", IGT_ENGINE_HASH) };
});

/** 「지방세로 읽기」 박스 옆 카드 - 박스 세목에 나온 세목만 자체 카드 */
export async function getLensOwn(topics: readonly string[]): Promise<LensOwn | null> {
  if (!topics.some((x) => /상속세|증여세/.test(x))) return null;
  return lensOwnFilter(topics, await getOwnCardState());
}
