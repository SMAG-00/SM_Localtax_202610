// 배치 작업 목록 — Vercel Cron과 사내 스케줄러가 같은 /api/jobs/<이름> 을 부른다 (FND-07, PRD-00 10.2).
// 일정은 apps/web/vercel.json의 crons 한 곳 — 사내 스케줄러(deploy/scheduler)도 같은 파일을 읽는다.
// 1단계 작업(핫뉴스 후보 수집·행사 재확인·링크 점검·서치 콘솔 수집·연락 요청/대화 파기)은 해당 기능을 만들 때 여기에 더한다.
// 이 패키지는 AI SDK를 쓰지 않는다 (1단계 — AI 없음, FND-01). DB를 직접 열지 않는다 — 웹 앱의 작업 경로(/api/jobs/[job])가
// 서버 기능(services)을 넘기고, 이 목록은 '어떤 이름이 무엇을 하는가'만 정한다.

/** 작업 결과 — detail은 실행 기록(agent_runs.detail)에 남고, revalidatePublic이면 공개 화면 캐시를 바로 비운다 */
export type JobResult = { detail?: Record<string, unknown>; revalidatePublic?: boolean };

/** 웹 앱이 넘기는 서버 기능 (apps/web lib/server/jobs.ts) */
export interface JobServices {
  /** W2-c 1시간 집계 — 측정 이벤트 → article_stats(시간 단위) → 많이 본 기사·상담 사례 HOT 순위 (ART-11 · HOME-05) */
  aggregatePopular(now: Date): Promise<Record<string, unknown>>;
  /** W2-c 보존 기한 정리 — analytics.retention_days보다 오래된 원본 이벤트·시간 단위 집계를 나눠 지운다 (FND-06 · 설계 9장 #4) */
  purgeAnalytics(now: Date): Promise<Record<string, unknown>>;
  /** W2-d 검색어 집계 보존 기한 정리 — query_terms.retention_days보다 오래된 날 행을 나눠 지운다 (SRCH-03 · W2-d 설계 8.3) */
  purgeQueryTerms(now: Date): Promise<Record<string, unknown>>;
  /** W2-e 보존 기한 정리 — 미확인 가입·사전 알림, 철회 동의, 문의 연락처·첨부, 시도 기록 (설계 9.3). 지운 수만 돌려준다 */
  purgePrivacy(now: Date): Promise<Record<string, unknown>>;
}

export type JobContext = { now: Date; services: JobServices };
export type Job = (ctx: JobContext) => Promise<JobResult>;

export const jobs: Record<string, Job> = {
  // 스케줄러 연결 확인 — 호출 경로(Vercel Cron · 사내 스케줄러)가 살아 있는지 실행 기록으로 남긴다
  "scheduler-heartbeat": async ({ now }) => ({ detail: { checkedAt: now.toISOString() } }),
  // 많이 본 기사·상담 사례 HOT 집계 (1시간마다 — docs/dev/W2-c_설계.md 8.2). 순위가 바뀌므로 공개 화면 캐시를 비운다
  "popular-hourly": async ({ now, services }) => ({ detail: await services.aggregatePopular(now), revalidatePublic: true }),
  // 측정 원본 보존 기한 정리 (하루 한 번) — 검색어 집계(query_terms)의 오래된 날 행도 같은 실행에서 지운다(detail.queryTerms)
  "analytics-retention": async ({ now, services }) => ({ detail: { ...(await services.purgeAnalytics(now)), queryTerms: await services.purgeQueryTerms(now) } }),
  // 개인정보 보존 기한 정리 (하루 한 번) — 결과는 지운 수뿐(개인정보 0)
  "privacy-retention": async ({ now, services }) => ({ detail: await services.purgePrivacy(now) }),
};

export function findJob(name: string): Job | undefined {
  return Object.hasOwn(jobs, name) ? jobs[name] : undefined;
}
