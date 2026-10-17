import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { brand } from "@ltr/ui";
import { R8_THRESHOLDS, taxReviewReasons, type Dictionaries, type Finding, type PublishContext } from "@ltr/editorial";
import { siteUrl } from "../env";
import { HttpError, errorJson } from "../http";
import { adminClient } from "../supabase";
import { runGate, saveChecks, type GateResult, type GateSettings } from "./gate";
import { toArticleForPublish } from "./mapping";
import { desiredTaxReviewStatus } from "./plan";
import { loadArticleGraph, loadGateSettings, loadTitlePeers } from "./repository";
import type { ArticleGraph, ArticleRow } from "./rows";
import { updateArticle } from "./writes";

// 기사 API 공용 — service_role 클라이언트, 발행 판정 실행, 저장 뒤 검사

/** 서버 쓰기용 DB — 접근 판정을 통과한 뒤에만 쓴다 (W2-a 설계 §5) */
export function serviceDb(): SupabaseClient {
  const db = adminClient();
  if (!db) throw new HttpError(503, "서버 설정이 끝나지 않았습니다");
  return db;
}

export const nowIso = () => new Date().toISOString();

/** 발행 판정 한 번 (점검 패널·발행 API 공용) */
export async function gateFor(db: SupabaseClient, graph: ArticleGraph, now: string, settings?: GateSettings): Promise<GateResult> {
  const [s, peers] = await Promise.all([settings ? Promise.resolve(settings) : loadGateSettings(db), loadTitlePeers(db, graph.article)]);
  return runGate(graph, s, { now, siteUrl: siteUrl(), publisherName: brand.productName, peers });
}

/** 판정 항목 때문에 거부 — 422 { error, failed: 차단 ID[], findings } */
export function findingsError(message: string, findings: readonly Finding[]): Response {
  const failed = [...new Set(findings.filter((f) => f.level === "block").map((f) => f.id))];
  return errorJson(422, message, { failed, findings });
}

/** 저장 검사용 판정 문맥 (CORE-01 박스·CAT-05 해결 사례 저장 규칙) */
export function saveContext(dictionaries: Dictionaries, now: string): PublishContext {
  return { today: now.slice(0, 10), dictionaries, thresholds: R8_THRESHOLDS, seoLint: null, similarity: null };
}

/** 저장 뒤 — 세무 감수 상태 칸을 맞추고, 쉬운 말·압박 완화 검사 결과를 돌려준다 (ART-01 "저장 때 UX-01·UX-03 검사") */
export async function afterSave(db: SupabaseClient, saved: ArticleRow, dictionaries: Dictionaries, newDraftVersion: boolean) {
  const graph = await loadArticleGraph(db, saved);
  const forPublish = toArticleForPublish(graph);
  const desired = desiredTaxReviewStatus(saved.tax_review_status, taxReviewReasons(forPublish).length > 0, newDraftVersion);
  let article = saved;
  if (desired !== saved.tax_review_status) {
    article = await updateArticle(db, saved, { tax_review_status: desired }, "articles 세무 감수 상태");
  }
  return { article, checks: saveChecks(forPublish, dictionaries) };
}
