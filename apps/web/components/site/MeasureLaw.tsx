"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics/client";

// 법령·해석 화면 측정 (law_viewed · case_viewed) - 그리는 것 0. 속성은 번호·구분 값뿐이고 입력값·검색어는 없다.
// 머문 시간 구간은 화면을 떠나는 순간(탭 숨김·페이지 이탈) 한 번만 보낸다.
const band = (seconds: number) => (seconds < 10 ? "under_10" : seconds <= 30 ? "10_to_30" : "over_30");

export function MeasureLaw({ lawId, asOfUsed, view }: { lawId: number; asOfUsed: boolean; view: "single" | "three" }) {
  useEffect(() => {
    const start = performance.now();
    let sent = false;
    const send = () => {
      if (sent) return;
      sent = true;
      void track("law_viewed", { section: "tax", props: { law_id: lawId, as_of_used: asOfUsed, view, duration_band: band((performance.now() - start) / 1000) }, keepalive: true });
    };
    const onHide = () => document.visibilityState === "hidden" && send();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", send);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", send);
    };
  }, [lawId, asOfUsed, view]);
  return null;
}

export function MeasureCase({ docType, origin }: { docType: "ruling" | "circular" | "interpretation" | "tribunal" | "case"; origin: "search" | "panel" | "article" }) {
  useEffect(() => {
    const start = performance.now();
    let sent = false;
    const send = () => {
      if (sent) return;
      sent = true;
      void track("case_viewed", { section: "tax", props: { doc_type: docType, origin, duration_band: band((performance.now() - start) / 1000) }, keepalive: true });
    };
    const onHide = () => document.visibilityState === "hidden" && send();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", send);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", send);
    };
  }, [docType, origin]);
  return null;
}
