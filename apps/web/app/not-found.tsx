import { NotFoundNotice } from "@/components/site/NotFoundNotice";
import { SiteLinkProvider } from "@/components/site/SiteLinkProvider";

// 어느 화면에도 맞지 않는 주소의 404 (예: 단계 전 경로 /local/events/[slug] — W6, 단계 전·v1.2 주소) — Next.js 기본 영어 화면 대신.
// /local/reporting 같은 한 단계 주소는 W4 3단계부터 지역 화면 경로(/local/[sido])가 받아 공개 틀 안의 404(app/(site)/not-found.tsx — 같은 안내)를 그린다
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
