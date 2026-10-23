"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DarkButton, TextField } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { ErrorSummary, StatusNote } from "./fields";
import { useHydrated } from "./useHydrated";

// 특례법 확인 기록 폼 (W4 20단계 — PRD-01B PR-13, /admin/dev-methods). 관리자(PO)만 확인·철회(서버가 다시 판정), 표시 켜기·끄기는 개발방법 입력 권한.
// 공포 원문 주소·공포일·사유는 사람이 직접 적는다 — 채워 넣는 기본값 0. 특례법 이름·요건은 이 화면에 없다.

function useSend() {
  const router = useRouter();
  const [error, setError] = useState<{ title: string; details: string[] } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function send(body: Record<string, unknown>, ok: string) {
    setError(null);
    setDone(null);
    setPending(true);
    const r = await adminApi("POST", "/api/admin/special-law", body);
    setPending(false);
    if (r.status === 200 || r.status === 201) {
      setDone(ok);
      router.refresh();
    } else {
      setError({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
    }
  }
  return { error, done, pending, send };
}

function Feedback({ id, s }: { id: string; s: ReturnType<typeof useSend> }) {
  return (
    <>
      {s.done && <StatusNote>{s.done}</StatusNote>}
      {s.error && <ErrorSummary id={`${id}-error`} title={s.error.title} messages={s.error.details} />}
    </>
  );
}

/** 공포 확인(enacted) 또는 철회(withdrawn) */
export function LawForm({ current }: { current: boolean }) {
  const hydrated = useHydrated();
  const s = useSend();
  const [f, setF] = useState({ promulgation_url: "", promulgated_on: "", reason: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  function confirm(e: FormEvent) {
    e.preventDefault();
    void s.send({ op: "law", status: "enacted", ...f }, "공포 확인을 남겼습니다.");
  }
  return (
    <form noValidate aria-label="특례법 공포 확인" onSubmit={confirm} className="space-y-3" data-form="special-law-law">
      <TextField id="sl-url" label="공포 원문 주소 (http·https)" value={f.promulgation_url} onChange={set("promulgation_url")} required />
      <TextField id="sl-on" label="공포일 (YYYY-MM-DD)" value={f.promulgated_on} onChange={set("promulgated_on")} required />
      <TextField id="sl-reason" label="사유 (200자까지)" value={f.reason} onChange={set("reason")} required />
      <Feedback id="sl-law" s={s} />
      <div className="flex flex-wrap gap-3">
        <DarkButton type="submit" disabled={!hydrated || s.pending}>
          공포 확인 남기기
        </DarkButton>
        {current && (
          <DarkButton type="button" disabled={!hydrated || s.pending || f.reason.trim() === ""} onClick={() => void s.send({ op: "law", status: "withdrawn", reason: f.reason }, "공포 확인을 철회했습니다.")}>
            공포 확인 철회 (사유 필요)
          </DarkButton>
        )}
      </div>
    </form>
  );
}

/** 표시된 행의 확인·철회 (관리자) */
export function RowConfirm({ body, label, confirmed }: { body: Record<string, unknown>; label: string; confirmed: boolean }) {
  const hydrated = useHydrated();
  const s = useSend();
  const [reason, setReason] = useState("");
  const id = `slr-${String(body.slug)}-${String(body.item ?? body.fact_id)}`;
  return (
    <div className="space-y-2" data-form="special-law-row">
      <TextField id={`${id}-reason`} label="사유 (200자까지)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <Feedback id={id} s={s} />
      <div className="flex flex-wrap gap-3">
        <DarkButton type="button" disabled={!hydrated || s.pending || reason.trim() === ""} onClick={() => void s.send({ op: "row", ...body, status: "enacted", reason }, "이 행의 특례법 근거를 확인했습니다.")}>
          {label} 확인
        </DarkButton>
        {confirmed && (
          <DarkButton type="button" disabled={!hydrated || s.pending || reason.trim() === ""} onClick={() => void s.send({ op: "row", ...body, status: "withdrawn", reason }, "이 행의 확인을 철회했습니다.")}>
            {label} 확인 철회
          </DarkButton>
        )}
      </div>
    </div>
  );
}

/** 특례법 근거 표시 켜기·끄기 (편집 책임자·관리자) */
export function MarkButton({ body, label }: { body: Record<string, unknown>; label: string }) {
  const hydrated = useHydrated();
  const s = useSend();
  const [reason, setReason] = useState("");
  const isFact = body.op === "mark_fact";
  return (
    <div className="space-y-2" data-form="special-law-mark">
      {isFact && <TextField id={`slm-${String(body.slug)}-${String(body.fact_key)}`} label="새 판 사유 (200자까지)" value={reason} onChange={(e) => setReason(e.target.value)} />}
      <Feedback id={`slm-${String(body.slug)}-${String(body.item ?? body.fact_key)}`} s={s} />
      <DarkButton type="button" disabled={!hydrated || s.pending || (isFact && reason.trim() === "")} onClick={() => void s.send({ ...body, ...(isFact ? { reason } : {}) }, "표시를 바꿨습니다.")}>
        {label}
      </DarkButton>
    </div>
  );
}
