import { permanentRedirect } from "next/navigation";

// 옛 브리핑 아카이브 (/brief) — 주간 브리핑 호는 PO 2026-11-01 결정으로 지웠고, 최신법령·유권해석 화면도 PO 2026-11-18 에 지웠다.
// 옛 주소는 지방세 허브로 영구 이동(308)한다. 구독·확인·해지(/brief/subscribe·confirm·unsubscribe)는 알림 메일이 쓰므로 그대로 둔다.
export default function BriefPage(): never {
  permanentRedirect("/tax");
}
