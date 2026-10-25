"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { UiLink } from "@ltr/ui";
import { track } from "@/lib/analytics/client";
import type { EventName } from "@/lib/analytics/events";

// 바로가기·캠페인 측정 연결 (W10-i) - 분야 칸이 없는 이벤트(shortcut_clicked · realestate_weekly_viewed · campaign_*). 개인 정보·입력값 없음.
// 측정 거부·GPC면 track()이 아무것도 보내지 않는다. 열람 이벤트는 같은 속성이면 한 번만.
type Props = Record<string, string | number | boolean>;

export function MeasureOnce({ name, props, entry }: { name: EventName; props?: Props; entry?: "campaign" }) {
  const key = JSON.stringify([name, props ?? {}, entry ?? null]);
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (sent.current === key) return;
    sent.current = key;
    const [n, p, e] = JSON.parse(key) as [EventName, Props, "campaign" | null];
    void track(n, { props: p, ...(e ? { entry: e } : {}) });
  }, [key]);
  return null;
}

/** 주소창의 쿼리(캠페인 태그·클릭 ID)를 지운다 - 공유·새로고침에 태그가 남지 않게 (측정 값은 서버가 이미 등록 값으로 바꿔 받았다) */
export function StripQuery() {
  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
  }, []);
  return null;
}

/** 누르면 이벤트 1건을 보내고 그대로 이동하는 링크 */
export function TrackedLink({ href, name, props, className, children }: { href: string; name: EventName; props: Props; className?: string; children: ReactNode }) {
  return (
    <UiLink href={href} className={className} onClick={() => void track(name, { props, keepalive: true })}>
      {children}
    </UiLink>
  );
}
