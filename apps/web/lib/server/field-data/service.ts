import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FIELD_SPECS, runFieldSource } from "@ltr/workflows/field-data";
import { dataApiDartKey, dataApiKey } from "../env";
import { HttpError } from "../http";
import { internalRules } from "../local-news/similarity";
import { plainTextOf, rightsVerdict } from "./rights";
import { supabaseFieldStore } from "./stores";

// 분야 데이터 연동 작업과 공개 반영 (W10-h — PR-06 · LG-15 · DF-06). 작업 목록(@ltr/workflows)이 runFieldPipelines 를 부르고, 같은 함수를 URL 호출·명령줄이 함께 쓴다.
// 수집: 관문(기능 키 field_data · 인증키 · 주소 칸 · 원천 이용 조건 allowed + 견본 계약 확인) 중 하나라도 틀리면 외부 요청 0, 이유만 남긴다.
// 반영: 사람이 승인한 후보만 DB 함수 field_publish 로 공개 표에 들어간다. 결과는 수와 이유뿐(인증키·원문 글자 0). AI 호출 없음.

const SYSTEM_ACTOR = "system:pipeline-field-data";

async function fieldFlagOn(db: SupabaseClient): Promise<boolean> {
  const r = await db.from("settings").select("value").eq("key", "feature_flags").limit(1);
  if (r.error) throw new Error(`settings 읽기 실패: ${r.error.code ?? ""} ${r.error.message}`.trim());
  const value = (r.data?.[0] as { value?: unknown } | undefined)?.value;
  return !!value && typeof value === "object" && (value as Record<string, unknown>).field_data === true;
}

async function sourceRunnable(db: SupabaseClient, sourceKey: string): Promise<boolean> {
  const r = await db.rpc("data_source_runnable", { p_key: sourceKey });
  if (r.error) throw new Error(`data_source_runnable 실패: ${r.error.code ?? ""} ${r.error.message}`.trim());
  return r.data === true;
}

const httpFetch = async (url: string) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  return { status: res.status, text: await res.text() };
};

function translate(error: { code?: string; message: string }): HttpError {
  if (error.code === "23514" || error.code === "42501") return new HttpError(422, "입력값을 확인하세요", { errors: [error.message] });
  if (error.code === "P0002") return new HttpError(404, "그런 검수 항목이 없습니다");
  console.error("[field-data] DB 함수 오류:", error.code, error.message);
  return new HttpError(500, "서버 오류가 났습니다 - 잠시 뒤 다시 시도하세요");
}

/** 제4유형 후보의 공개 본문 유사도 검사 - 기록을 남기고 결과를 돌려준다. 본문이 없으면 검사할 것이 없다(null) */
export async function runRightsCheck(db: SupabaseClient, itemId: number, actor: string) {
  const body = await db.rpc("field_candidate_body", { p_item_id: itemId });
  if (body.error) throw translate(body.error);
  const { text, hash, snapshot_id: snapshotId } = body.data as { text: string | null; hash: string; snapshot_id: number | null };
  if (text === null) return null;
  let original = "";
  if (snapshotId !== null) {
    const snap = await db.from("raw_snapshots").select("payload").eq("id", snapshotId).limit(1);
    if (snap.error) throw new HttpError(500, `raw_snapshots 조회 실패: ${snap.error.message}`);
    original = plainTextOf(((snap.data?.[0] as { payload?: string } | undefined)?.payload) ?? "");
  }
  const rules = await db.from("settings").select("value").eq("key", "similarity_internal").limit(1);
  if (rules.error) throw new HttpError(500, `settings 조회 실패: ${rules.error.message}`);
  const verdict = rightsVerdict({ body: text, original, rules: internalRules((rules.data?.[0] as { value?: unknown } | undefined)?.value) });
  const ins = await db.from("field_candidate_checks").insert({
    review_item_id: itemId, kind: "similarity", status: verdict.status, text_hash: hash,
    max_similarity: verdict.maxSimilarity, similar_ratio: verdict.similarRatio, rules_version: verdict.rulesVersion, checked_by: actor,
  });
  if (ins.error) throw new HttpError(500, `field_candidate_checks 저장 실패: ${ins.error.message}`);
  return verdict;
}

/** 승인된 후보 하나를 공개 반영 (DB 함수가 모든 조건을 다시 확인한다 - 위반은 422) */
export async function publishFieldItem(db: SupabaseClient, itemId: number, actor: string): Promise<Record<string, unknown>> {
  const r = await db.rpc("field_publish", { p_item_id: itemId, p_actor: actor });
  if (r.error) throw translate(r.error);
  return r.data as Record<string, unknown>;
}

/** 승인됐지만 아직 반영되지 않은 후보를 반영한다. 제4유형인데 통과 기록이 없으면 검사부터 하고, 막히면 승인 상태로 둔 채 수만 센다 */
export async function publishApproved(db: SupabaseClient, actor = SYSTEM_ACTOR): Promise<Record<string, number>> {
  const out = { approved: 0, published: 0, unchanged: 0, blocked: 0 };
  const list = await db.from("review_items").select("id").eq("kind", "field_data").eq("status", "approved").order("id").limit(100);
  if (list.error) throw new Error(`review_items 조회 실패: ${list.error.message}`);
  for (const row of (list.data ?? []) as { id: number }[]) {
    out.approved += 1;
    try {
      const body = await db.rpc("field_candidate_body", { p_item_id: row.id });
      if (!body.error && (body.data as { kogl_type: string | null; text: string | null }).kogl_type === "kogl_4") await runRightsCheck(db, row.id, actor);
      const res = await publishFieldItem(db, row.id, actor);
      if (res.action === "unchanged") out.unchanged += 1; else out.published += 1;
    } catch (error) {
      if (error instanceof HttpError && error.status === 422) out.blocked += 1; else throw error;
    }
  }
  return out;
}

/** 분야 데이터 작업 한 바퀴 */
export async function runFieldPipelines(db: SupabaseClient, now: Date): Promise<Record<string, unknown>> {
  const flagOn = await fieldFlagOn(db);
  const store = supabaseFieldStore(db);
  const results: Record<string, unknown>[] = [];
  for (const spec of Object.values(FIELD_SPECS)) {
    const key = spec.keyName === "DATA_API_DART_KEY" ? dataApiDartKey() : dataApiKey();
    const runnable = flagOn && !!key && !!spec.baseUrl ? await sourceRunnable(db, spec.sourceKey) : false;
    const r = await runFieldSource({ spec, fetch: httpFetch, store, now, key, flagOn, sourceRunnable: runnable });
    results.push({ source: spec.sourceKey, ...r });
  }
  return { sources: results, publish: await publishApproved(db) };
}
