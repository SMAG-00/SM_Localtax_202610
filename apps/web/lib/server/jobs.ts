import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobServices } from "@ltr/workflows";
import { aggregatePopular, purgeAnalytics } from "./analytics/aggregate";
import { purgeQueryTerms } from "./analytics/query-terms";
import { purgePrivacy } from "./accounts/retention";

// 배치 작업(@ltr/workflows 목록)에 넘기는 서버 기능 — 작업 경로(/api/jobs/[job])가 service_role 클라이언트로 만든다.
// 작업 목록은 '어떤 이름이 무엇을 하는가'만 정하고, DB 읽기·쓰기는 여기 서버 모듈이 한다.
export function jobServices(db: SupabaseClient): JobServices {
  return {
    aggregatePopular: (now) => aggregatePopular(db, now),
    purgeAnalytics: (now) => purgeAnalytics(db, now),
    purgeQueryTerms: (now) => purgeQueryTerms(db, now),
    purgePrivacy: (now) => purgePrivacy(db, now),
  };
}
