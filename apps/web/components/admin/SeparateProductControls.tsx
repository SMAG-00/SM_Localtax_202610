"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DarkButton, TextField } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { QUEUE_NOTE_MAX } from "@/lib/admin/regional-rules";
import { ErrorSummary } from "./fields";
import { useHydrated } from "./useHydrated";

// 별도 상품 검토 닫기 폼 (W4 8단계 — REG1-14·17, /admin/regions). 닫는 사유(결정)는 필수 — 서버(parseCloseInput)와 같은 규칙.

export function CloseQueueItemForm({ id }: { id: number }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [note, setNote] = useState("");
  const [error, setError] = useState<{ title: string; details: string[] } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const r = await adminApi("POST", "/api/admin/regions", { op: "close", itemId: id, note });
    if (r.status === 200) router.refresh();
    else setError({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }

  return (
    <form onSubmit={submit} aria-label={`별도 상품 검토 항목 ${id} 닫기`} data-form="separate-product-close" data-queue-id={id} className="mt-3 space-y-3">
      <TextField
        id={`sp-note-${id}`}
        label="닫는 사유 (결정)"
        hint="예: 광고·협찬 상품으로 전환 · 행사안내로 등록(W6) · 폐기 · 가이드로 유지"
        value={note}
        maxLength={QUEUE_NOTE_MAX}
        required
        onChange={(e) => setNote(e.target.value)}
      />
      {error && <ErrorSummary id={`sp-close-error-${id}`} title={error.title} messages={error.details} />}
      <DarkButton type="submit" disabled={!hydrated}>
        검토 닫기
      </DarkButton>
    </form>
  );
}
