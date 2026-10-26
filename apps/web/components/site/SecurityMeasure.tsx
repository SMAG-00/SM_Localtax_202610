"use client";

import { useEffect, useRef } from "react";
import { track } from "@/lib/analytics/client";
import type { SecurityEntry } from "@/lib/security/items";

// security_page_viewed - 분야(section) 없는 이벤트라 MeasureView(분야 필수)를 쓰지 않는다. 속성은 진입 경로 하나뿐.
export function MeasureSecurity({ entry }: { entry: SecurityEntry }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void track("security_page_viewed", { props: { entry } });
  }, [entry]);
  return null;
}
