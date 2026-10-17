import { Callout, Eyebrow, UiLink } from "@ltr/ui";
import { UNAVAILABLE_NOTICE, UNAVAILABLE_TITLE } from "@/lib/site/public-gate";
import { TEXT_LINK } from "./SiteSection";

// 공개 데이터를 읽지 못했을 때의 안내 (lib/server/public/fallback.ts) — 원인 글자 0, 쉬운 말 한 줄.
// 목록 화면은 DB가 필요 없는 머리 아래 이 한 줄, 상세 화면은 이 쪽 하나 (상세 응답 503은 proxy.ts가 먼저 정한다)

/** 목록 화면의 한 줄 */
export function UnavailableNotice({ className = "mt-8" }: { className?: string }) {
  return (
    <div role="status" data-part="unavailable" className={className}>
      <Callout>{UNAVAILABLE_NOTICE}</Callout>
    </div>
  );
}

/** 상세 화면 — 있는지 모르므로 '없다'고 하지 않는다 */
export function UnavailablePage() {
  return (
    <section data-part="unavailable" className="mx-auto max-w-5xl px-4 py-20">
      <Eyebrow>NOTICE</Eyebrow>
      <h1 className="mt-3 text-[28px] leading-tight font-black tracking-tight text-navy-900 sm:text-[32px]">{UNAVAILABLE_TITLE}</h1>
      <p className="mt-3 text-[17px] text-navy-600">지금 이 화면의 자료를 읽지 못했습니다. 잠시 뒤 다시 열어 주세요.</p>
      <p className="mt-6">
        <UiLink href="/" className={TEXT_LINK}>
          홈으로 가기
        </UiLink>
      </p>
    </section>
  );
}
