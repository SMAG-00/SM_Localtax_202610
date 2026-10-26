import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "@/lib/server/http";
import { FAKE_INDEX_VERSION, FAKE_MODEL_ID, FAKE_PROMPT_VERSION, fakeAnswer } from "@/lib/eval/fake-model";

// 한 문항 시험 (W12-e e2, 4단계 설계 5장 #16) - 공개 위젯이 아니라 /admin/eval에서 관리자 계정으로만. 답변 공급자는 가짜 모델이다 (실제 지방세봇은 W12-b 뒤 e4가 붙인다).
// 문항은 시험용·실제 문항 모두 돌릴 수 있지만, 가짜 모델 답변은 게이트 리포트에 쓸 수 없다(리포트는 live_api 재실행이 있어야 확정).
export async function runSingle(db: SupabaseClient, itemId: number, actor: string): Promise<{ run_id: number; answer_id: number }> {
  const { data: item, error } = await db
    .from("eval_items")
    .select("id, set_id, item_key, expected_behavior, cross_types, expected_clarify, required_citation_ids, index_exclude_ids")
    .eq("id", itemId)
    .single();
  if (error || !item) throw dbError(error ?? { message: "문항이 없습니다" }, "eval_items 조회");
  const it = item as { id: number; set_id: number; item_key: string; expected_behavior: "answer" | "scope_guide" | "blocked" | "no_answer"; cross_types: string[]; expected_clarify: string | null; required_citation_ids: string[]; index_exclude_ids: string[] };
  const run = await db
    .from("eval_runs")
    .insert({ set_id: it.set_id, kind: "single", answer_source: "fake", model: FAKE_MODEL_ID, prompt_version: FAKE_PROMPT_VERSION, index_version: FAKE_INDEX_VERSION, index_excluded: it.index_exclude_ids, created_by: actor })
    .select("id")
    .single();
  if (run.error) throw dbError(run.error, "eval_runs 추가");
  const runId = (run.data as { id: number }).id;
  const a = fakeAnswer(it);
  const ans = await db.from("eval_answers").insert({ run_id: runId, item_id: it.id, ...a }).select("id").single();
  if (ans.error) {
    await db.from("eval_runs").update({ status: "failed", finished_at: new Date().toISOString() }).eq("id", runId);
    throw dbError(ans.error, "eval_answers 추가");
  }
  const fin = await db.from("eval_runs").update({ status: "done", finished_at: new Date().toISOString(), report: { items: 1 } }).eq("id", runId);
  if (fin.error) throw dbError(fin.error, "eval_runs 종료");
  return { run_id: runId, answer_id: (ans.data as { id: number }).id };
}
