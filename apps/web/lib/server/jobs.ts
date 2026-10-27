import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobServices } from "@ltr/workflows";
import { aggregatePopular, purgeAnalytics } from "./analytics/aggregate";
import { purgeQueryTerms } from "./analytics/query-terms";
import { purgePrivacy } from "./accounts/retention";
import { getBillingRuntime } from "./billing/runtime";
import { reconcile, recordRenewalNotices } from "./billing/service";
import { checkLinks } from "./links/check";
import { closeExpiredContracts, purgeInquiries } from "./org/service";
import { scanSourceExpiry } from "./source-review/service";
import { closeReadinessMonths } from "./readiness/monthly";
import { collectSearchConsole, submitIndexNow } from "./seo/jobs";
import { runAccuracy } from "./accuracy/run";
import { runNationalAccuracy } from "@/lib/igt/run";
import { runDocPipelines, runLawPipeline } from "./pipelines/service";
import { publishDue, remindReconfirm, sendAmendmentAlerts } from "./brief/issues";
import { checkOpsBudget, detectAmendments, draftBrief } from "./ops-ai/service";
import { runFieldPipelines } from "./field-data/service";
import { detectIssueGraphStale } from "./issue-graph/stale";
import { refreshZones } from "./zones/service";
import { refreshIndex } from "./agent/index-refresh";
import { collectStats } from "./stats/service";
import { runQualityDaily } from "./quality/service";
import { purgeAgentConversations } from "./agent/d-store";
import { draftCaseSummaries, watchConsistency } from "./ops-ai/editorial";

// 배치 작업(@ltr/workflows 목록)에 넘기는 서버 기능 — 작업 경로(/api/jobs/[job])가 service_role 클라이언트로 만든다.
// 작업 목록은 '어떤 이름이 무엇을 하는가'만 정하고, DB 읽기·쓰기는 여기 서버 모듈이 한다.
export function jobServices(db: SupabaseClient): JobServices {
  return {
    aggregatePopular: (now) => aggregatePopular(db, now),
    purgeAnalytics: (now) => purgeAnalytics(db, now),
    purgeQueryTerms: (now) => purgeQueryTerms(db, now),
    purgePrivacy: (now) => purgePrivacy(db, now),
    checkLinks: (now) => checkLinks(db, now),
    scanSourceExpiry: (now) => scanSourceExpiry(db, now),
    collectSearchConsole: (now) => collectSearchConsole(db, now),
    submitIndexNow: (now) => submitIndexNow(now),
    closeReadinessMonths: (now) => closeReadinessMonths(db, now),
    reconcileBilling: async (now) => {
      const runtime = getBillingRuntime();
      return { ...(await reconcile(db, runtime?.adapter ?? null, runtime?.config ?? null, now)) };
    },
    recordRenewalNotices: async (now) => ({ ...(await recordRenewalNotices(db, now)) }),
    purgeInstitutionInquiries: (now) => purgeInquiries(db, now),
    closeExpiredOrgContracts: (now) => closeExpiredContracts(db, now),
    detectIssueGraphStale: (now) => detectIssueGraphStale(db, now),
    runLawPipeline: (now) => runLawPipeline(db, now),
    runDocPipelines: (now) => runDocPipelines(db, now),
    runFieldPipelines: (now) => runFieldPipelines(db, now),
    // 지방세 대조 실행 + 국세(상속·증여) 대조 실행 - 둘은 서로 다른 룰셋 표·실행 기록을 쓴다 (W11-g, FAM-12)
    runAccuracy: async (now) => ({ ...(await runAccuracy(db, now)), national: await runNationalAccuracy(db) }),
    detectAmendments: (now) => detectAmendments(db, now),
    draftBrief: (now) => draftBrief(db, now),
    publishBrief: (now) => publishDue(db, now),
    remindReconfirm: (now) => remindReconfirm(db, now),
    sendAmendmentAlerts: (now) => sendAmendmentAlerts(db, now),
    checkOpsBudget: (now) => checkOpsBudget(db, now),
    refreshZones: (now) => refreshZones(db, now),
    refreshIndex: (now) => refreshIndex(db, now),
    draftCaseSummaries: (now) => draftCaseSummaries(db, now),
    watchConsistency: (now) => watchConsistency(db, now),
    collectStats: (now) => collectStats(db, now),
    runQualityDaily: (now) => runQualityDaily(db, now),
    purgeAgentConversations: (now) => purgeAgentConversations(db, now),
  };
}
