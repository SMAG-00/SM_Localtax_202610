"use client";

import { useState } from "react";
import { PrimaryButton } from "@ltr/ui";

// 구독 해지 (W10-f, PAY-05) - /my/billing 한 화면에서. 해지하면 자동갱신만 꺼지고 남은 기간 끝까지 이용한다 (끝나는 날은 서버가 돌려준 값을 그대로 보여 준다).
export function CancelSubscriptionButton({ subscriptionId }: { subscriptionId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="mt-4">
      <PrimaryButton
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const res = await fetch("/api/billing/cancel", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ subscriptionId }),
          });
          const body = (await res.json()) as { endsAt?: string; error?: string };
          setBusy(false);
          setMessage(res.ok && body.endsAt ? `해지했습니다. ${new Date(body.endsAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}까지 이용할 수 있습니다.` : (body.error ?? "해지하지 못했습니다"));
        }}
      >
        {busy ? "처리 중" : "자동갱신 해지"}
      </PrimaryButton>
      {message && (
        <p role="status" data-part="cancel-message" className="mt-3 text-[16px] text-navy-800">
          {message}
        </p>
      )}
    </div>
  );
}
