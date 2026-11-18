"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// 대기 중인 제작 요청 취소 (PO 2026-11-18) — 요청한 본인·관리자. 이미 제작 중이면 서버가 409로 거부한다(작업기가 끝까지 처리)
export function CancelRequestButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        className="min-h-11 rounded-xl border border-navy-200 bg-white px-4 text-[14px] font-bold text-navy-800 disabled:opacity-60"
        onClick={async () => {
          setBusy(true);
          const res = await fetch(`/api/editorial/requests/${id}/cancel`, { method: "POST" });
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setBusy(false);
          if (res.ok) router.refresh();
          else setError(body.error ?? "취소하지 못했습니다");
        }}
      >
        {busy ? "취소 중" : "요청 취소"}
      </button>
      {error && (
        <span role="alert" className="text-[13px] text-rose-800">
          {error}
        </span>
      )}
    </span>
  );
}
