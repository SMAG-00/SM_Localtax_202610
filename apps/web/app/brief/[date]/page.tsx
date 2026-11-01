import { permanentRedirect } from "next/navigation";

// 옛 브리핑 호 주소 (/brief/yyyy-mm-dd) — 호 화면은 지웠다(PO 2026-11-01). 최신법령·유권해석 목록으로 영구 이동(308)한다
export default function BriefIssuePage(): never {
  permanentRedirect("/tax/law-updates");
}
