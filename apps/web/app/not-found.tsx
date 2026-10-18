import { NotFoundNotice } from "@/components/site/NotFoundNotice";
import { SiteLinkProvider } from "@/components/site/SiteLinkProvider";

// 어느 화면에도 맞지 않는 주소의 404 (예: 지자체뉴스 하위 경로 /local/reporting — 설계 9장 #27, 단계 전·v1.2 주소) — Next.js 기본 영어 화면 대신
// 공개 화면과 같은 쉬운 말 안내. 공개 틀(헤더·바닥글) 밖이라 분야 메뉴를 읽지 않는다(DB 0). 응답 404·noindex는 Next.js가 정한다.
export default function NotFound() {
  return (
    <SiteLinkProvider>
      <main id="main" className="min-h-screen bg-ivory">
        <NotFoundNotice />
      </main>
    </SiteLinkProvider>
  );
}
