"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * 화면 스크립트가 살아났는가(hydration 끝). 그 전에 버튼을 누르면 브라우저가 폼을 그냥 보내 입력이 사라지므로,
 * 편집국 화면의 작업 버튼은 이 값이 true가 될 때까지 꺼 둔다. 서버 렌더에서는 false.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
