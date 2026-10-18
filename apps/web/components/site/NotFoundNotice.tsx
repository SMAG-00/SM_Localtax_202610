import { Eyebrow, UiLink } from "@ltr/ui";
import { TEXT_LINK } from "./SiteSection";

// 404 안내 한 쪽 — 공개 화면의 404(app/(site)/not-found.tsx — 공개 틀 안)와 어느 화면에도 맞지 않는 주소의 404(app/not-found.tsx)가 같이 쓴다.
// 쉬운 말로 알리고 홈으로 보낸다. 응답 상태(404)와 noindex는 Next.js가 정한다.
export function NotFoundNotice() {
  return (
    <section className="mx-auto max-w-5xl px-4 py-20">
      <Eyebrow>NOT FOUND</Eyebrow>
      <h1 className="mt-3 text-[28px] leading-tight font-black tracking-tight text-navy-900 sm:text-[32px]">찾는 화면이 없습니다</h1>
      <p className="mt-3 text-[17px] text-navy-600">주소가 바뀌었거나 아직 공개되지 않은 화면입니다.</p>
      <p className="mt-6">
        <UiLink href="/" className={TEXT_LINK}>
          홈으로 가기
        </UiLink>
      </p>
    </section>
  );
}
