"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DarkButton } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { ErrorSummary } from "./fields";

// 브리핑 호·승인된 후보 조작 (W10-e). 판정의 기준은 서버(DB 함수)이고 화면은 요청만 보낸다 - 승인 조건이 안 되면 서버가 422로 이유를 돌려준다.

type Problem = { title: string; details: string[] } | null;

async function call(body: Record<string, unknown>, onDone: () => void, setError: (p: Problem) => void) {
  setError(null);
  const r = await adminApi("POST", "/api/admin/brief", body);
  if (r.status >= 200 && r.status < 300) onDone();
  else setError({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
}

export function NewDraftButton() {
  const router = useRouter();
  const [error, setError] = useState<Problem>(null);
  return (
    <div>
      <DarkButton type="button" onClick={() => call({ op: "assemble" }, () => router.refresh(), setError)} data-testid="brief-assemble">
        다음 호 초안 만들기
      </DarkButton>
      {error && <ErrorSummary title={error.title} messages={error.details} />}
    </div>
  );
}

export function IssueControls({ issue }: { issue: { id: number; title: string; has_ad: boolean; status: string; corners: unknown } }) {
  const router = useRouter();
  const [title, setTitle] = useState(issue.title);
  const [hasAd, setHasAd] = useState(issue.has_ad);
  const [corners, setCorners] = useState(JSON.stringify(issue.corners, null, 2));
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<Problem>(null);
  const done = () => router.refresh();
  const draft = issue.status === "draft";

  function save(e: FormEvent) {
    e.preventDefault();
    let parsed: unknown;
    try {
      parsed = JSON.parse(corners);
    } catch {
      setError({ title: "코너 JSON 형식이 맞지 않습니다", details: [] });
      return;
    }
    void call({ op: "update", id: issue.id, title, hasAd, corners: parsed }, done, setError);
  }

  return (
    <div className="mt-3 space-y-3" data-brief-controls={issue.id}>
      {draft && (
        <form onSubmit={save} className="space-y-2">
          <label className="block text-[14px] font-bold text-navy-900">
            제목
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 block min-h-11 w-full rounded-xl border border-navy-200 px-3 text-[16px]" />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-[15px] text-navy-900">
            <input type="checkbox" checked={hasAd} onChange={(e) => setHasAd(e.target.checked)} className="size-5" /> 광고성 정보가 있는 호 (제목에 (광고) 표기)
          </label>
          <label className="block text-[14px] font-bold text-navy-900">
            코너 (JSON - 항목마다 origin, reviewed를 둡니다. AI가 쓴 항목은 확인한 뒤 reviewed를 true로)
            <textarea value={corners} onChange={(e) => setCorners(e.target.value)} rows={10} className="mt-1 block w-full rounded-xl border border-navy-200 p-3 font-mono text-[13px]" />
          </label>
          <DarkButton type="submit">저장</DarkButton>
        </form>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {draft && (
          <>
            <DarkButton type="button" onClick={() => call({ op: "check", id: issue.id }, done, setError)} data-testid="brief-check">검사기 8종 실행</DarkButton>
            <label className="flex min-h-11 items-center gap-2 text-[14px] text-navy-900">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="size-5" /> 경고를 확인했습니다
            </label>
            <DarkButton type="button" onClick={() => call({ op: "approve", id: issue.id, ackWarnings: ack }, done, setError)} data-testid="brief-approve">승인</DarkButton>
          </>
        )}
        {issue.status === "approved" && (
          <DarkButton type="button" onClick={() => call({ op: "unapprove", id: issue.id }, done, setError)} data-testid="brief-unapprove">승인 취소</DarkButton>
        )}
      </div>
      {error && <ErrorSummary title={error.title} messages={error.details} />}
    </div>
  );
}

export function ApplyAiDraftButton({ itemId }: { itemId: number }) {
  const router = useRouter();
  const [error, setError] = useState<Problem>(null);
  return (
    <div>
      <DarkButton type="button" onClick={() => call({ op: "apply_ai_draft", itemId }, () => router.refresh(), setError)}>초안 호에 넣기</DarkButton>
      {error && <ErrorSummary title={error.title} messages={error.details} />}
    </div>
  );
}

/** 승인된 개정 단계 후보를 개정 트래커에 반영 (AIOPS-01) - 어느 개정안인지 편집자가 고른다. 승인 전에는 서버가 거부한다 */
export function AmendmentApplyForm({ itemId, amendments }: { itemId: number; amendments: { id: number; title: string }[] }) {
  const router = useRouter();
  const [amendmentId, setAmendmentId] = useState(amendments[0]?.id ?? 0);
  const [error, setError] = useState<Problem>(null);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="amendment-apply" data-item-id={itemId}>
      <label className="text-[14px] font-bold text-navy-900">
        개정안
        <select value={amendmentId} onChange={(e) => setAmendmentId(Number(e.target.value))} className="ml-2 min-h-11 rounded-xl border border-navy-200 px-3 text-[15px]">
          {amendments.map((a) => (
            <option key={a.id} value={a.id}>{a.title}</option>
          ))}
        </select>
      </label>
      <DarkButton type="button" onClick={() => call({ op: "apply_amendment", itemId, amendmentId }, () => router.refresh(), setError)} data-testid="amendment-apply-button">개정안에 반영</DarkButton>
      {error && <ErrorSummary title={error.title} messages={error.details} />}
    </div>
  );
}
