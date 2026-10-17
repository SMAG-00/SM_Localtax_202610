// 배치 작업 목록 — Vercel Cron과 사내 스케줄러가 같은 /api/jobs/<이름> 을 부른다 (FND-07, PRD-00 10.2).
// 1단계 작업(핫뉴스 후보 수집·행사 재확인·링크 점검·서치 콘솔 수집·연락 요청/대화 파기)은 해당 기능을 만들 때 여기에 더한다.
// 이 패키지는 AI SDK를 쓰지 않는다 (1단계 — AI 없음, FND-01).

export type JobResult = { detail?: Record<string, unknown> };
export type Job = (ctx: { now: Date }) => Promise<JobResult>;

export const jobs: Record<string, Job> = {
  // 스케줄러 연결 확인 — 호출 경로(Vercel Cron · 사내 스케줄러)가 살아 있는지 실행 기록으로 남긴다
  "scheduler-heartbeat": async ({ now }) => ({ detail: { checkedAt: now.toISOString() } }),
};

export function findJob(name: string): Job | undefined {
  return Object.hasOwn(jobs, name) ? jobs[name] : undefined;
}
