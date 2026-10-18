import { NotFoundNotice } from "@/components/site/NotFoundNotice";

// 공개 화면의 404 — 없는 하위 분야·숨긴(감수 전) 상황·목록 끝을 넘긴 쪽. 헤더·바닥글은 그대로, 쉬운 말로 알리고 홈으로 보낸다. 응답 404.
export default function SiteNotFound() {
  return <NotFoundNotice />;
}
