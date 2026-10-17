import { Eyebrow, UiLink } from "@ltr/ui";
import { TEXT_LINK } from "@/components/site/SiteSection";

// 공개 화면의 404 — 없는 하위 분야·숨긴(감수 전) 상황·목록 끝을 넘긴 쪽. 헤더·바닥글은 그대로, 쉬운 말로 알리고 홈으로 보낸다. 응답 404.
export default function SiteNotFound() {
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
