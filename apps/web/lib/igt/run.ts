import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeIgtRun, type IgtCaseRow } from "./accuracy";
import { IGT_ENGINE_HASH } from "./engine-hash";
import { asIgtRuleset } from "./ruleset";

// 상속·증여세 정확도 대조 실행 (배치 accuracy-run 의 두 번째 몫 - AI 없음, FAM-12) - 활성 igt 룰셋으로 확인된 증여·상속 사례 전부를 엔진에 돌려 한 번에 기록한다.
//  · 활성 룰셋이 없거나 확인된 사례가 없으면 건너뛴다. 엔진이 거부한 사례가 하나라도 있으면 기록하지 않고 오류로 끝낸다(게이트는 닫힌 채).
//  · 결과는 수와 룰셋 버전, 엔진 해시 앞자리뿐이다 - 사례 입력·금액 0.
const PAGE = 1000;

export async function runNationalAccuracy(db: SupabaseClient, triggeredBy = "job:accuracy-run"): Promise<Record<string, unknown>> {
  const { data: rs, error: rsError } = await db.from("igt_rulesets").select("id, version, body").eq("status", "active").maybeSingle();
  if (rsError) throw new Error(`상속·증여 룰셋 읽기 실패: ${rsError.message}`);
  if (!rs) return { skipped: "no_active_ruleset" };
  const ruleset = asIgtRuleset(rs.body);
  if (!ruleset) throw new Error("상속·증여 활성 룰셋 본문이 엔진이 읽는 모양이 아닙니다");

  const cases: IgtCaseRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("accuracy_cases")
      .select("id, tax_kind, case_input, official_total")
      .in("tax_kind", ["gift", "inheritance"])
      .eq("synthetic", false)
      .not("confirmed_at", "is", null)
      .is("retired_at", null)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`상속·증여 대조 사례 읽기 실패: ${error.message}`);
    cases.push(...(data as IgtCaseRow[]));
    if (!data || data.length < PAGE) break;
  }
  if (cases.length === 0) return { skipped: "no_cases", ruleset: rs.version };

  const { results, errors } = computeIgtRun(cases, ruleset);
  if (errors.length > 0) {
    throw new Error(`엔진이 거부한 상속·증여 사례 ${errors.length}건 (사례 번호 ${errors.slice(0, 20).map((e) => e.case_id).join(", ")}) - 실행을 기록하지 않았습니다`);
  }
  const { data: runId, error } = await db.rpc("record_accuracy_run_igt", {
    p_igt_ruleset_id: rs.id,
    p_engine_hash: IGT_ENGINE_HASH,
    p_triggered_by: triggeredBy,
    p_results: results,
  });
  if (error) throw new Error(`상속·증여 실행 기록 실패: ${error.message}`);
  const official = new Map(cases.map((c) => [c.id, c.official_total]));
  const matched = results.filter((r) => r.engine_total === official.get(r.case_id)).length;
  return { runId, ruleset: rs.version, cases: cases.length, matched, mismatched: cases.length - matched, engineHash: IGT_ENGINE_HASH.slice(0, 12) };
}
