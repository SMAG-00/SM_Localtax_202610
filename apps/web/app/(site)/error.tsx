"use client";

import { DarkButton, Eyebrow } from "@ltr/ui";

// 공개 화면 본문을 그리지 못했을 때 (공개 데이터를 읽지 못함 등) — 헤더·바닥글은 그대로 두고 쉬운 말로 알린다. 원인 글자는 보이지 않는다(서버 로그에만).
export default function SiteError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <section className="mx-auto max-w-5xl px-4 py-20">
      <Eyebrow>NOTICE</Eyebrow>
      <h1 className="mt-3 text-[28px] leading-tight font-black tracking-tight text-navy-900 sm:text-[32px]">화면을 불러오지 못했습니다</h1>
      <p className="mt-3 text-[17px] text-navy-600">잠시 뒤 다시 시도해 주세요.</p>
      <DarkButton className="mt-8" onClick={() => retry()}>
        다시 불러오기
      </DarkButton>
    </section>
  );
}
