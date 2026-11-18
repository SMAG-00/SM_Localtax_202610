import { redirect } from "next/navigation";

// 최신법령·유권해석 화면은 지웠다 (PO 2026-11-18). 접속하면 지방세 허브로 보낸다.
// 임시 이동(307) — DB의 하위 분야(law-updates)와 기사는 그대로라, 다시 열 때 브라우저가 옛 이동을 기억하지 않게 한다.
// 이 파일이 있으면 같은 주소의 하위 분야 동적 경로([category])보다 먼저 잡힌다. 헤더 메뉴·허브 탭에서는 isBlockedPath 가 뺀다.
export default function LawUpdatesGonePage(): never {
  redirect("/tax");
}
