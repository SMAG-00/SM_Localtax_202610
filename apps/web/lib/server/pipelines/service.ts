import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DOC_SPECS, collectDocs, createLawApi, pipelineGate, runLawCheck, type SkipReason } from "@ltr/workflows/pipelines";
import { lawApiOc } from "../env";
import { supabaseDocStore, supabaseLawStore } from "./stores";

// 수집 파이프라인 작업 (W10-c — AIOPS-06 · PIPE-01~04). 작업 목록(@ltr/workflows)이 이 함수를 부르고, 같은 함수를 URL 호출·명령줄이 함께 쓴다.
// 관문 세 가지(기능 키 pipelines 켜짐 · LAW_API_OC 있음 · 원천 이용 조건 allowed + 견본 계약 확인) 중 하나라도 틀리면 외부 요청 0, 이유만 남긴다.
// 결과는 수와 이유뿐이다(인증키·원문 글자 0). 이 작업은 사용자 경로 키와 무관하며 AI를 호출하지 않는다.

async function pipelinesFlagOn(db: SupabaseClient): Promise<boolean> {
  const r = await db.from("settings").select("value").eq("key", "feature_flags").limit(1);
  if (r.error) throw new Error(`settings 읽기 실패: ${r.error.code ?? ""} ${r.error.message}`.trim());
  const value = (r.data?.[0] as { value?: unknown } | undefined)?.value;
  return !!value && typeof value === "object" && (value as Record<string, unknown>).pipelines === true;
}

async function sourceRunnable(db: SupabaseClient, sourceKey: string): Promise<boolean> {
  const r = await db.rpc("data_source_runnable", { p_key: sourceKey });
  if (r.error) throw new Error(`data_source_runnable 실패: ${r.error.code ?? ""} ${r.error.message}`.trim());
  return r.data === true;
}

export type PipelineResult = { skipped: SkipReason } | { skipped?: undefined; [k: string]: unknown };

/** PIPE-01 법령 감시 한 바퀴 */
export async function runLawPipeline(db: SupabaseClient, now: Date): Promise<Record<string, unknown>> {
  const oc = lawApiOc();
  const gate = pipelineGate({ flagOn: await pipelinesFlagOn(db), oc, sourceRunnable: await sourceRunnable(db, "law_api") });
  if (!gate.run) return { source: "law_api", skipped: gate.reason };
  const api = createLawApi({ oc: oc! });
  const { summary } = await runLawCheck({ api, store: supabaseLawStore(db), now, secrets: [oc!] });
  return { source: "law_api", ...summary };
}

/** PIPE-02~04 행정규칙·해석·결정례 수집 — 원천마다 관문을 따로 본다 */
export async function runDocPipelines(db: SupabaseClient, now: Date): Promise<Record<string, unknown>> {
  const oc = lawApiOc();
  const flagOn = await pipelinesFlagOn(db);
  const results: Record<string, unknown>[] = [];
  const store = supabaseDocStore(db);
  for (const spec of Object.values(DOC_SPECS)) {
    const gate = pipelineGate({ flagOn, oc, sourceRunnable: flagOn && oc ? await sourceRunnable(db, spec.sourceKey) : false });
    if (!gate.run) {
      results.push({ source: spec.sourceKey, skipped: gate.reason });
      continue;
    }
    results.push({ ...(await collectDocs({ spec, api: createLawApi({ oc: oc! }), store, now, secrets: [oc!] })) });
  }
  return { sources: results };
}
