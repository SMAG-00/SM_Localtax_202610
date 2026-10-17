import "server-only";
import { PublicDataError } from "./db";

// 공개 데이터를 읽지 못할 때의 한 곳 (접속값 없음 · 네트워크 오류 · 표 없음 — PublicDataError).
// 모든 공개 화면이 이 함수로 읽는다 — 목록 화면은 닫힌 모습(DB가 필요 없는 머리 + 안내 한 줄, 응답 200),
// 상세 화면은 '읽지 못함' 표시(UNAVAILABLE)를 받아 안내를 그린다(상세 응답 503은 proxy.ts가 먼저 정한다 — lib/site/public-gate.ts).
// 실패는 캐시하지 않는다 — 데이터 캐시는 200 응답만 둔다(Next.js fetch 캐시). 원인은 서버 로그 [public]에만, 화면·응답에는 오류 글자 0.
// 그 밖의 오류(코드 잘못 등)는 그대로 던진다 — 숨기지 않는다(error.tsx).

/** 상세 화면이 공개 데이터를 읽지 못했다는 표시 */
export const UNAVAILABLE = { unavailable: true } as const;
export type Unavailable = typeof UNAVAILABLE;

export const isUnavailable = (v: unknown): v is Unavailable => v === UNAVAILABLE;

export async function readPublic<T, C>(screen: string, load: () => Promise<T>, closed: () => C): Promise<T | C> {
  try {
    return await load();
  } catch (err) {
    if (!(err instanceof PublicDataError)) throw err;
    console.error(`[public] ${screen} — 공개 데이터를 읽지 못해 닫힌 화면을 보입니다:`, err.context, err.code ?? "");
    return closed();
  }
}
