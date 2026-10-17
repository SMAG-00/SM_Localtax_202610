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

/** 편집국 API 응답 뒤 공개 데이터 캐시를 비울지 — 읽기(GET·HEAD) 밖의 요청이 성공(2xx)했을 때만 */
export function shouldRevalidatePublic(method: string, status: number): boolean {
  const m = method.toUpperCase();
  return m !== "GET" && m !== "HEAD" && status >= 200 && status < 300;
}
