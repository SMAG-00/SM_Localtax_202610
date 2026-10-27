"use client";

import { AGENT_OPEN_EVENT, type AgentOpenDetail } from "@/lib/agent/entry";
import type { Entry } from "@/lib/agent/request";

// 진입 버튼 - 도우미 창을 지방세봇 모드로 열고 질의를 채우는 창 안 알림만 보낸다. 주소 이동·전송·한도 차감 0.
export function AgentEntryButton(props: { entry: Entry; entryId: string | null; prefill: string; label: string; variant: "card" | "inline" }) {
  const cls =
    props.variant === "card"
      ? "mx-auto mt-4 flex w-full max-w-[1100px] min-h-11 items-center justify-between rounded-2xl border border-navy-100 bg-white px-4 py-3 text-left text-[16px] font-bold text-navy-900"
      : "mt-4 inline-flex min-h-11 items-center rounded-xl border border-navy-200 bg-white px-4 text-[16px] font-bold text-navy-900";
  return (
    <button
      type="button"
      data-agent-entry={props.entry}
      className={cls}
      onClick={() => {
        const detail: AgentOpenDetail = { prefill: props.prefill, entry: props.entry, entryId: props.entryId };
        window.dispatchEvent(new CustomEvent<AgentOpenDetail>(AGENT_OPEN_EVENT, { detail }));
      }}
    >
      {props.label}
    </button>
  );
}
