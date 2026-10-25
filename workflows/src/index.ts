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
  /** W3 바깥 링크 점검 — 주소가 있는 활성 연결을 실행 키(ISO 주)당 한 번 점검한다 (TX-01 · FAM-08). 결과는 수뿐(주소 0) */
  checkLinks(now: Date): Promise<Record<string, unknown>>;
  /** W4 6단계 공식 자료 시점 만료 — 확인일(한국 날짜)부터 기준 일수를 넘긴 공식 자료마다 검수 큐 1건, 실행 키 = 한국 날짜 (REG1-13). 결과는 수뿐 */
  scanSourceExpiry(now: Date): Promise<Record<string, unknown>>;
  /** W7 서치 콘솔 질의 수집 — 최근 3일을 덮어쓰기로 query_terms(source search_console)에 저장. 설정이 없으면 skipped (OPT-01) */
  collectSearchConsole(now: Date): Promise<Record<string, unknown>>;
  /** W7 IndexNow 전송 — 설정이 꺼져 있거나 색인 관문이 닫혀 있으면 요청 0 (OPT-01) */
  submitIndexNow(now: Date): Promise<Record<string, unknown>>;
  /** W7 제휴 준비 월 마감 — 직전 완결 달(과 빠진 최근 달) 행을 만들고 경고 알림을 낸다. 마감 행은 바꾸지 않는다 (NAV-17) */
  closeReadinessMonths(now: Date): Promise<Record<string, unknown>>;
  /** W10-f 결제 정리 — 오래 끝나지 않은 주문을 PG 조회로 정리, 만기 구독 갱신 결제(고지 기록 없으면 거부), 만기 정리, 카드번호 패턴 스캔. 결과는 수뿐 */
  reconcileBilling(now: Date): Promise<Record<string, unknown>>;
  /** W10-f 가격 변경 사전 고지 기록 — 요금제 금액이 마지막 고지와 다른 자동갱신 구독에 고지 기록을 남긴다. 결과는 수뿐 */
  recordRenewalNotices(now: Date): Promise<Record<string, unknown>>;
  /** W10-c 법령 감시 — 기능 키 pipelines·LAW_API_OC·원천 이용 조건 중 하나라도 틀리면 요청 0으로 건너뛴다 (PIPE-01). 결과는 수와 이유뿐 */
  runLawPipeline(now: Date): Promise<Record<string, unknown>>;
  /** W10-c 행정규칙·해석·결정례 수집 — 원천마다 같은 관문 (PIPE-02~04) */
  runDocPipelines(now: Date): Promise<Record<string, unknown>>;
  /** W10-a 정확도 대조 실행 - 활성 룰셋으로 확인된 대조 사례 전부를 엔진에 돌려 기록한다. AI 없음. 활성 룰셋·확인된 사례가 없으면 건너뜀, 엔진이 거부한 사례가 있으면 실패 (CALC-14) */
  runAccuracy(now: Date): Promise<Record<string, unknown>>;
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
  // 바깥 링크 점검 (하루 한 번 호출, 같은 ISO 주에는 이미 점검한 링크를 건너뛴다) — 상태가 바뀌면 카드가 달라지므로 공개 화면 캐시를 비운다
  "link-check": async ({ now, services }) => ({ detail: await services.checkLinks(now), revalidatePublic: true }),
  // 공식 자료 시점 만료 (하루 한 번, 한국 날짜 00시대 — 같은 날 두 번이면 한 벌) — 기사 화면 '검토 중' 표시가 바뀌므로 공개 화면 캐시를 비운다
  "source-expiry": async ({ now, services }) => ({ detail: await services.scanSourceExpiry(now), revalidatePublic: true }),
  // 서치 콘솔 질의 수집 (하루 한 번) — 검색어 집계 화면 숫자가 바뀐다
  "search-console-daily": async ({ now, services }) => ({ detail: await services.collectSearchConsole(now) }),
  // IndexNow 전송 (하루 한 번) — 설정이 꺼져 있으면 아무 요청도 보내지 않는다
  "indexnow-submit": async ({ now, services }) => ({ detail: await services.submitIndexNow(now) }),
  // 제휴 준비 월 마감 (하루 한 번, 같은 달은 이미 마감된 행을 건너뛴다) — 대시보드 숫자가 바뀐다
  "readiness-monthly": async ({ now, services }) => ({ detail: await services.closeReadinessMonths(now), revalidatePublic: false }),
  // 결제 정리 (하루 한 번) — 주문 상태는 PG 조회가 정한다. 공개 화면 값은 바뀌지 않는다
  "billing-reconcile": async ({ now, services }) => ({ detail: await services.reconcileBilling(now), revalidatePublic: false }),
  // 가격 변경 사전 고지 기록 (하루 한 번, 같은 금액은 한 번만 기록)
  "renewal-notice": async ({ now, services }) => ({ detail: await services.recordRenewalNotices(now), revalidatePublic: false }),
  // 법령 변경 감시 (하루 한 번) — 후보는 검수 큐에만 쌓이고 공개 화면은 바뀌지 않는다
  "pipeline-law": async ({ now, services }) => ({ detail: await services.runLawPipeline(now), revalidatePublic: false }),
  // 행정규칙·해석·결정례 수집 (하루 한 번) — 후보 문서는 권리 확인 전까지 공개되지 않는다
  "pipeline-docs": async ({ now, services }) => ({ detail: await services.runDocPipelines(now), revalidatePublic: false }),
  // 정확도 대조 (하루 한 번) - 공개 게이트 뷰가 읽는 실행 기록을 최신으로 맞춘다. 공개 화면 값은 바뀌지 않는다(게이트 상태는 다음 요청부터 반영)
  "accuracy-run": async ({ now, services }) => ({ detail: await services.runAccuracy(now), revalidatePublic: false }),
};

export function findJob(name: string): Job | undefined {
  return Object.hasOwn(jobs, name) ? jobs[name] : undefined;
}
