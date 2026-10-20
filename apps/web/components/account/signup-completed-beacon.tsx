"use client";
import { useEffect } from "react";
import { track } from "@/lib/analytics/client";

// 가입 확인을 마치고 /my?welcome=1에 도착했을 때 signup_completed를 한 번만 보낸다 (W2-e 설계 4.3 · W2-c 2.2).
// 보내는 값은 분야 수·지역 수뿐이다. 주소의 welcome 표시는 보낸 뒤 지워 새로고침으로 다시 보내지 않는다. 측정 거부·GPC는 track()이 지킨다.
const SENT_KEY = "ltr_signup_completed_sent";

export function SignupCompletedBeacon({ interestCount, regionCount }: { interestCount: number; regionCount: number }) {
  useEffect(() => {
    if (window.sessionStorage.getItem(SENT_KEY) === "1") return;
    window.sessionStorage.setItem(SENT_KEY, "1");
    void track("signup_completed", { props: { interest_count: interestCount, region_count: regionCount } });
    window.history.replaceState(null, "", "/my");
  }, [interestCount, regionCount]);
  return null;
}
