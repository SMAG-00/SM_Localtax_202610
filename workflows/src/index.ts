// 배치 작업 목록 — Vercel Cron과 사내 스케줄러가 같은 /api/jobs/<이름> 을 부른다 (FND-07, PRD-00 10.2).
// 일정은 apps/web/vercel.json의 crons 한 곳 — 사내 스케줄러(deploy/scheduler)도 같은 파일을 읽는다.
// 1단계 작업(핫뉴스 후보 수집·행사 재확인·링크 점검·서치 콘솔 수집·연락 요청/대화 파기)은 해당 기능을 만들 때 여기에 더한다.
// 이 패키지는 AI SDK를 쓰지 않는다 (1단계 — AI 없음, FND-01). DB를 직접 열지 않는다 — 웹 앱의 작업 경로(/api/jobs/[job])가
// 서버 기능(services)을 넘기고, 이 목록은 '어떤 이름이 무엇을 하는가'만 정한다.

/** 작업 결과 — detail은 실행 기록(agent_runs.detail)에 남고, revalidatePublic이면 공개 화면 캐시를 바로 비운다 */
export type JobResult = { detail?: Record<string, unknown>; revalidatePublic?: boolean; usage?: JobUsage };

/** W10-e 운영 AI 실행 비용 - 작업 경로가 agent_runs 비용 칸(model·토큰·cost)에 적는다 (AIOPS-04) */
export type JobUsage = { model: string; inputTokens: number; outputTokens: number; cost?: number; costUnit?: string };

/** 서비스 결과에서 비용 기록(_usage)을 떼어 실행 기록 칸으로 옮긴다 */
function withUsage(detail: Record<string, unknown>, revalidatePublic = false): JobResult {
  const { _usage, ...rest } = detail;
  return { detail: rest, revalidatePublic, ...(_usage ? { usage: _usage as JobUsage } : {}) };
}

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
  /** W11-f 기관 견적 요청 파기 - 보존일이 지난 요청의 개인 칸을 비운다. 결과는 수뿐 */
  purgeInstitutionInquiries(now: Date): Promise<Record<string, unknown>>;
  /** W11-f 기관 계약 종료 정리 - 종료 시각이 지난 계약을 끝내고 남은 좌석을 회수 처리한다. 권한은 valid_until로 이미 끝나 있다. 결과는 수뿐 */
  closeExpiredOrgContracts(now: Date): Promise<Record<string, unknown>>;
  /** W11-d 쟁점 지도 개정 신호 - 지도 노드가 가리키는 조문의 글이 새 개정판에서 달라졌으면 지도에 배지를 달고 검수 큐 항목 1건을 만든다. 해시만 바뀐 사건은 제외. AI 없음. 결과는 수뿐 (AIOPS-11 · LINK-01) */
  detectIssueGraphStale(now: Date): Promise<Record<string, unknown>>;
  /** W10-c 법령 감시 — 기능 키 pipelines·LAW_API_OC·원천 이용 조건 중 하나라도 틀리면 요청 0으로 건너뛴다 (PIPE-01). 결과는 수와 이유뿐 */
  runLawPipeline(now: Date): Promise<Record<string, unknown>>;
  /** W10-c 행정규칙·해석·결정례 수집 — 원천마다 같은 관문 (PIPE-02~04) */
  runDocPipelines(now: Date): Promise<Record<string, unknown>>;
  /** W10-h 분야 데이터 연동 - 원천마다 관문(기능 키 field_data·인증키·주소 칸·이용 조건)을 거쳐 후보만 쌓고, 승인된 후보를 공개 반영한다. 결과는 수와 이유뿐 (PR-06·LG-15·DF-06) */
  runFieldPipelines(now: Date): Promise<Record<string, unknown>>;
  /** W10-a 정확도 대조 실행 - 활성 룰셋으로 확인된 대조 사례 전부를 엔진에 돌려 기록한다. AI 없음. 활성 룰셋·확인된 사례가 없으면 건너뜀, 엔진이 거부한 사례가 있으면 실패 (CALC-14) */
  runAccuracy(now: Date): Promise<Record<string, unknown>>;
  /** W10-e 개정 감지 - 후보는 검수 큐에만 (AIOPS-01). 기능 키 amendment_auto가 꺼져 있으면 건너뜀. 운영 AI가 켜져 있으면 룰셋 영향 제안 초안도 검수 큐에만 */
  detectAmendments(now: Date): Promise<Record<string, unknown>>;
  /** W10-e O4 브리핑 편집 - 다음 호 초안 틀과(AI가 켜져 있으면) 쉬운 요약 초안. 공개 표 쓰기 0 */
  draftBrief(now: Date): Promise<Record<string, unknown>>;
  /** W10-e 정시 발행·발송 - 승인된 호만, 발행 시각 판정은 DB (BRIEF-01) */
  publishBrief(now: Date): Promise<Record<string, unknown>>;
  /** W10-e 재확인 안내 - 기한이 오늘인 구독자에게 1회 (BRIEF-02) */
  remindReconfirm(now: Date): Promise<Record<string, unknown>>;
  /** W10-e 개정 알림 발송 - 공개된 단계 변경만, 수신자당 1통 (TX-12) */
  sendAmendmentAlerts(now: Date): Promise<Record<string, unknown>>;
  /** W10-e 운영 AI 월 예산 점검 (AIOPS-04) */
  checkOpsBudget(now: Date): Promise<Record<string, unknown>>;
  /** W11-e 정비 현황·조례 확인일 경고 - DB 함수만 부른다(외부 요청 0). 결과는 수와 이유뿐 (AIOPS-14) */
  refreshZones(now: Date): Promise<Record<string, unknown>>;
  /** W12-a 검색 색인 증분 갱신 - 새·바뀐 원천을 청킹해 색인하고 철회된 원천은 뺀다. AI 없음(임베딩 공급자가 설정되어 있을 때만 임베딩 호출). 결과는 수뿐 (RAG-03) */
  refreshIndex(now: Date): Promise<Record<string, unknown>>;
  /** W12-f O2 결정례 요지 초안 - 요지가 없는 결정례에 요지·태그 후보 초안을 검수 큐에만 올린다. AI가 꺼져 있으면 후보 수만 센다 (AIOPS-07) */
  draftCaseSummaries(now: Date): Promise<Record<string, unknown>>;
  /** W12-f O6 정합성 감시 - 개정 조문을 인용한 기사를 찾아 경보와 "개정 전 기준" 배너 제안을 검수 큐에만 올린다. AI 없이도 돈다 (AIOPS-09) */
  watchConsistency(now: Date): Promise<Record<string, unknown>>;
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
  // 기관 견적 요청 파기 (하루 한 번) — 보존일(한국 날짜)이 지난 요청의 개인 칸 비우기
  "institution-inquiry-purge": async ({ now, services }) => ({ detail: await services.purgeInstitutionInquiries(now), revalidatePublic: false }),
  // 기관 계약 종료 정리 (하루 한 번)
  "org-contract-close": async ({ now, services }) => ({ detail: await services.closeExpiredOrgContracts(now), revalidatePublic: false }),
  // 쟁점 지도 개정 신호 (하루 한 번, 법령 수집 뒤) - 공개 지도의 "개정 반영 검토 중" 배지가 바뀌므로 공개 화면 캐시를 비운다
  "issue-graph-stale": async ({ now, services }) => ({ detail: await services.detectIssueGraphStale(now), revalidatePublic: true }),
  // 법령 변경 감시 (하루 한 번) — 후보는 검수 큐에만 쌓이고 공개 화면은 바뀌지 않는다
  "pipeline-law": async ({ now, services }) => ({ detail: await services.runLawPipeline(now), revalidatePublic: false }),
  // 행정규칙·해석·결정례 수집 (하루 한 번) — 후보 문서는 권리 확인 전까지 공개되지 않는다
  "pipeline-docs": async ({ now, services }) => ({ detail: await services.runDocPipelines(now), revalidatePublic: false }),
  // 분야 데이터 연동 (하루 한 번) - 후보는 검수 큐에만 쌓이고, 사람이 승인한 후보만 공개 반영되므로 반영 뒤 공개 화면 캐시를 비운다
  "pipeline-field-data": async ({ now, services }) => ({ detail: await services.runFieldPipelines(now), revalidatePublic: true }),
  // 정확도 대조 (하루 한 번) - 공개 게이트 뷰가 읽는 실행 기록을 최신으로 맞춘다. 공개 화면 값은 바뀌지 않는다(게이트 상태는 다음 요청부터 반영)
  "accuracy-run": async ({ now, services }) => ({ detail: await services.runAccuracy(now), revalidatePublic: false }),
  // W10-e 개정 감지 (하루 한 번, 법령 수집 뒤) - 후보는 검수 큐에만 쌓이고 공개 화면은 바뀌지 않는다
  "amendment-detect": async ({ now, services }) => withUsage(await services.detectAmendments(now)),
  // W10-e 브리핑 초안 (매주 일 23:00 KST) - 초안은 승인 전 공개 0
  "brief-draft": async ({ now, services }) => withUsage(await services.draftBrief(now)),
  // W10-e 브리핑 정시 발행 (매주 월 10:00 KST) - 발행하면 아카이브가 바뀐다
  "brief-publish": async ({ now, services }) => withUsage(await services.publishBrief(now), true),
  // W10-e 재확인 안내 (하루 한 번)
  "brief-reconfirm": async ({ now, services }) => withUsage(await services.remindReconfirm(now)),
  // W10-e 개정 알림 발송 (1시간마다)
  "amendment-alert": async ({ now, services }) => withUsage(await services.sendAmendmentAlerts(now)),
  // W10-e 운영 AI 월 예산 점검 (하루 한 번)
  "ops-ai-budget": async ({ now, services }) => withUsage(await services.checkOpsBudget(now)),
  // 정비 현황·조례 확인일 경고 (AIOPS-14 · TX-13 - 하루 한 번). 경고 수만 실행 기록에 남긴다
  "zone-refresh": async ({ now, services }) => ({ detail: await services.refreshZones(now), revalidatePublic: true }),
  // W12-a 검색 색인 증분 갱신 (매일 01:45 KST, 수집 작업 뒤 1시간 안) - 색인은 공개 화면에 보이지 않는다
  "index-refresh": async ({ now, services }) => ({ detail: await services.refreshIndex(now), revalidatePublic: false }),
  // W12-f 결정례 요지 초안 (매일 06:00 KST, 결정례 수집 뒤) - 초안은 승인 전 공개 0
  "case-summary-draft": async ({ now, services }) => withUsage(await services.draftCaseSummaries(now)),
  // W12-f 정합성 감시 (매일, 개정 감지 뒤) - 제안은 검수 큐에만. 월요일엔 깨진 연결 점검도 한다
  "consistency-watch": async ({ now, services }) => withUsage(await services.watchConsistency(now)),
};

export function findJob(name: string): Job | undefined {
  return Object.hasOwn(jobs, name) ? jobs[name] : undefined;
}
