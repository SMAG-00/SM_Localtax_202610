// 공개 데이터 캐시 규칙 (HOME-03 · HOME-04 "1분 안에 홈에 반영 — 캐시 재검증", docs/dev/W2-b_설계.md 7.1) — 순수 모듈 (시험 cache-policy.test.ts)
//  · 공개 화면은 요청 때 그린다(빌드 때 DB를 읽지 않는다 — Docker·CI 빌드에는 DB 접속값이 없다). 그때 읽는 공개 행(anon 키 응답)은
//    Next.js 데이터 캐시에 30초까지 둔다 — 시간 기준 재검증(뒤에서 새로 읽기)이라 손으로 고친 DB 값도 1분 안에 홈에 나온다.
//  · 편집국 API가 공개 화면에 보이는 값을 고치면(쓰기 성공) 이 태그를 바로 만료한다 — 다음 요청이 새로 읽는다 (요청 때 재검증).

/** 공개 데이터 함수가 읽는 모든 응답에 붙는 캐시 태그 */
export const PUBLIC_DATA_TAG = "public-data";

/** 시간 기준 재검증 간격(초) — 30초가 지난 값은 다음 요청에 뒤에서 새로 읽는다. 방문이 이어지면 늦어도 1분 안에 새 값 */
export const PUBLIC_DATA_REVALIDATE_SECONDS = 30;

/** fetch 옵션에 캐시 규칙을 더한다 — 요청 쪽이 넣은 cache 값은 뺀다(재검증 간격과 겹치면 Next.js가 둘 다 버린다) */
export function cachedRequestInit(init?: RequestInit): RequestInit {
  const { cache: _ignored, ...rest } = init ?? {};
  return { ...rest, next: { revalidate: PUBLIC_DATA_REVALIDATE_SECONDS, tags: [PUBLIC_DATA_TAG] } };
}

/**
 * 캐시하지 않는 요청 — 통합 검색(W2-d 설계 8장). 발행 취소·비공개가 다음 검색에 바로 빠지고(30초 창도 없다),
 * 끝없는 검색어 조합을 데이터 캐시에 쌓지 않는다. 요청 쪽이 넣은 next(재검증·태그)는 뺀다 — no-store와 겹치면 Next.js가 경고하고 하나를 버린다
 */
export function uncachedRequestInit(init?: RequestInit & { next?: unknown }): RequestInit {
  const { cache: _ignored, next: _next, ...rest } = init ?? {};
  return { ...rest, cache: "no-store" };
}

/** 즉시 만료의 여유(ms) — 한 프로세스 안에서 두 시계의 어긋남이 흔들리는 폭(측정 3ms 남짓)보다 넉넉히 */
export const EXPIRY_LEAD_MS = 10;

/**
 * 편집국 쓰기 뒤 '다음 공개 요청은 새 값'을 지키는 만료 프로필 — `revalidateTag(PUBLIC_DATA_TAG, 이것)`.
 * Next.js(16.3 incremental-cache)는 태그 만료 시각을 벽시계(`Date.now() + expire초`)로 적고, 읽을 때는 단조 시계
 * (`performance.timeOrigin + performance.now()`)가 그 시각을 지났는지 본다. 두 시계는 프로세스마다 다르게 어긋나서(측정: 새 프로세스 절반에서
 * 벽시계가 1~13ms 앞섬) `{ expire: 0 }`이면 쓰기 직후 그만큼 동안의 요청이 '만료'가 아니라 '낡음'으로 읽혀 옛 값을 한 번 그렸다
 * (W2-c 6단계 — 기능 키를 끈 직후 /news/video가 200). 만료 시각을 앞선 만큼 + 여유만큼 앞당겨 적어 단조 시계로도 이미 지난 시각이 되게 한다.
 * 그 폭(수십 ms) 안에 막 저장된 응답만 '낡음'으로 남고, 그것도 다음 요청이 뒤에서 새로 읽는다.
 */
export function immediateExpiryProfile(wallNowMs: number, monotonicNowMs: number): { expire: number } {
  const ahead = Math.max(0, Math.ceil(wallNowMs - monotonicNowMs));
  return { expire: -(ahead + EXPIRY_LEAD_MS) / 1000 };
}

/** 편집국 API 응답 뒤 공개 데이터 캐시를 비울지 — 읽기(GET·HEAD) 밖의 요청이 성공(2xx)했을 때만 */
export function shouldRevalidatePublic(method: string, status: number): boolean {
  const m = method.toUpperCase();
  return m !== "GET" && m !== "HEAD" && status >= 200 && status < 300;
}
