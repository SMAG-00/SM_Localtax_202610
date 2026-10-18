import "server-only";
import { revalidateTag } from "next/cache";
import { PUBLIC_DATA_TAG, cachedRequestInit, immediateExpiryProfile, uncachedRequestInit } from "./cache-policy";

// 공개 데이터 캐시 (규칙은 cache-policy.ts) — 공개 데이터 함수의 anon 요청과, 편집국 쓰기 뒤 즉시 만료

/** 공개 데이터 함수의 요청 — Next.js 데이터 캐시(태그 public-data, 30초 재검증)를 쓴다 */
export function publicDataFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, cachedRequestInit(init));
}

/** 캐시하지 않는 공개 요청 — 통합 검색(W2-d 설계 8장) */
export function uncachedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, uncachedRequestInit(init));
}

/**
 * 공개 데이터 캐시를 바로 만료한다 — 다음 공개 화면 요청은 캐시 대신 DB를 새로 읽는다(낡은 값을 한 번도 보이지 않는다).
 * 만료 시각은 Next.js의 두 시계 어긋남만큼 앞당겨 적는다(immediateExpiryProfile — `{ expire: 0 }`은 쓰기 직후 몇 ms 동안 옛 값을 한 번 보였다).
 * 실패해도 쓰기 응답은 그대로 둔다 — 30초 재검증이 남은 길이다(서버 로그에만 남긴다).
 */
export function revalidatePublicData(): void {
  try {
    revalidateTag(PUBLIC_DATA_TAG, immediateExpiryProfile(Date.now(), performance.timeOrigin + performance.now()));
  } catch (err) {
    console.error("[public] 공개 데이터 캐시를 비우지 못했습니다 — 30초 재검증으로 반영됩니다:", err instanceof Error ? err.message : String(err));
  }
}
