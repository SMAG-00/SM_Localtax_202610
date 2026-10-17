"use client";

import { useState } from "react";

// 공유 (ART-02 '공유 버튼') — 휴대전화는 기기 공유 창, 아니면 주소 복사. 바깥 공유 서비스 스크립트·추적 0. 주 버튼이 아니다(R2)
export function ShareButton({ url, title }: { url: string; title: string }) {
  const [message, setMessage] = useState("");
  async function share() {
    const href = /^https?:\/\//.test(url) ? url : new URL(url, window.location.href).toString();
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title, url: href });
        return;
      }
      await navigator.clipboard.writeText(href);
      setMessage("기사 주소를 복사했습니다");
    } catch (err) {
      // 사용자가 공유 창을 닫은 경우(AbortError)는 알리지 않는다
      if (!(err instanceof DOMException && err.name === "AbortError")) setMessage("주소를 복사하지 못했습니다 — 주소창의 주소를 써 주세요");
    }
  }
  return (
    <div data-part="share" className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={share}
        className="inline-flex min-h-11 items-center rounded-xl border border-navy-200 bg-white px-4 text-[15px] font-bold text-navy-900 transition hover:border-navy-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500"
      >
        공유하기
      </button>
      <p role="status" className="text-[14px] text-navy-600">
        {message}
      </p>
    </div>
  );
}
