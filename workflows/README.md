# workflows

배치 작업 — 1단계: 핫뉴스 후보 수집 · 행사 재확인 · 링크 점검(SM·위택스·외부 계산기) · 서치 콘솔 수집 · 연락 요청·대화 파기 (AI 없음). 2단계부터 개정 감지·편집국 에이전트. Vercel Cron과 사내 스케줄러가 같은 `/api/jobs/*`를 부른다 (CRON_SECRET).

지금 있는 작업 (`src/index.ts` — 일정은 `apps/web/vercel.json` 한 곳):

| 작업 | 일정 (UTC) | 하는 일 |
|---|---|---|
| `scheduler-heartbeat` | 매일 15:00 | 호출 경로(Vercel Cron · 사내 스케줄러)가 살아 있는지 실행 기록으로 남긴다 |
| `popular-hourly` | 매시 5분 (하루 한 번짜리 24줄 — Vercel Hobby 제한, `docs/dev/W2-c_설계.md` 8.2) | 측정 이벤트 → 시간 단위 집계 → 많이 본 기사·상담 사례 HOT 순위 |
| `analytics-retention` | 매일 18:40 | 보존 기한이 지난 측정 원본·시간 단위 집계를 나눠 지운다 |

작업은 DB를 직접 열지 않는다 — 웹 앱의 작업 경로(`/api/jobs/[job]`)가 서버 기능(`JobServices`, service_role)을 넘긴다.
