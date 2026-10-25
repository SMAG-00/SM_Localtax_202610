"use client";

import { useEffect, useRef } from "react";
import { track } from "@/lib/analytics/client";
import { ORG_TYPES, type OrgType } from "@/lib/education/rules";

// 위탁교육 견적 접수 측정 (W10-g - training_quote_requested). 그리는 것 0(빈 요소).
// 속성은 기관 종류 하나뿐이다 - 기관명·담당자·연락처·인원·접수 번호는 보내지 않는다. 측정 거부 쿠키·GPC 신호가 있으면 track()이 보내지 않는다.
export function QuoteSentMeasure({ orgType }: { orgType: string }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current || !(ORG_TYPES as readonly string[]).includes(orgType)) return;
    sent.current = true;
    void track("training_quote_requested", { props: { org_type: orgType as OrgType } });
  }, [orgType]);
  return null;
}
