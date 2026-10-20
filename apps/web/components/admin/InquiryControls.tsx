"use client";

import { useState } from "react";
import { INQUIRY_RESOLUTION_LABELS, INQUIRY_STATUS_LABELS, INQUIRY_STATUSES, INQUIRY_RESOLUTIONS } from "@/lib/admin/inquiry-rules";

// 문의 상세 조작 (ADM-03) — 상태·담당자·메모·정정 처리 결과 변경(PATCH) · [연락처 보기](누를 때마다 서버가 감사 로그 1건)
interface Props {
  id: number;
  kind: string;
  status: string;
  assignee: string | null;
  memo: string;
  resolution: string | null;
  resolutionReason: string;
  assignees: { userId: string; label: string }[];
  canUpdate: boolean;
}

const field = "mt-1 block min-h-11 w-full rounded-xl border border-navy-200 bg-white px-3 text-[16px] text-navy-900";
const button = "inline-flex min-h-11 items-center rounded-xl border border-navy-900 bg-navy-900 px-4 text-[15px] font-bold text-white disabled:opacity-50";

export function InquiryControls(p: Props) {
  const [status, setStatus] = useState(p.status);
  const [assignee, setAssignee] = useState(p.assignee ?? "");
  const [memo, setMemo] = useState(p.memo);
  const [resolution, setResolution] = useState(p.resolution ?? "");
  const [reason, setReason] = useState(p.resolutionReason);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [contact, setContact] = useState<{ email: string | null; name: string | null; organization: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const body: Record<string, unknown> = { status, assignee: assignee === "" ? null : assignee, memo };
    if (p.kind === "correction") {
      if (resolution !== "") body.resolution = resolution;
      body.resolutionReason = reason;
    }
    const res = await fetch(`/api/admin/inquiries/${p.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setMessage(res.ok ? { ok: true, text: "저장했습니다" } : { ok: false, text: data.error ?? "저장하지 못했습니다" });
    setBusy(false);
  }

  async function showContact() {
    setBusy(true);
    const res = await fetch(`/api/admin/inquiries/${p.id}/contact`, { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as { contact?: typeof contact; error?: string };
    if (res.ok && data.contact) setContact(data.contact);
    else setMessage({ ok: false, text: data.error ?? "연락처를 열지 못했습니다" });
    setBusy(false);
  }

  return (
    <div className="space-y-4" data-testid="inquiry-controls">
      <div>
        <button type="button" onClick={showContact} disabled={busy} className={button} data-testid="inquiry-contact-button">연락처 보기</button>
        {contact && (
          <dl className="mt-2 text-[15px] text-navy-900" data-testid="inquiry-contact">
            <dt className="font-bold">이메일</dt><dd data-testid="inquiry-contact-email">{contact.email ?? "(없음)"}</dd>
            {contact.name && (<><dt className="font-bold">이름</dt><dd>{contact.name}</dd></>)}
            {contact.organization && (<><dt className="font-bold">회사</dt><dd>{contact.organization}</dd></>)}
          </dl>
        )}
      </div>
      {p.canUpdate && (
        <>
          <div>
            <label htmlFor="inq-status" className="block text-[15px] font-bold text-navy-900">상태</label>
            <select id="inq-status" value={status} onChange={(e) => setStatus(e.target.value)} className={field}>
              {INQUIRY_STATUSES.map((s) => (<option key={s} value={s}>{INQUIRY_STATUS_LABELS[s]}</option>))}
            </select>
          </div>
          <div>
            <label htmlFor="inq-assignee" className="block text-[15px] font-bold text-navy-900">담당자</label>
            <select id="inq-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} className={field}>
              <option value="">(없음)</option>
              {p.assignees.map((a) => (<option key={a.userId} value={a.userId}>{a.label}</option>))}
            </select>
          </div>
          {p.kind === "correction" && (
            <>
              <div>
                <label htmlFor="inq-resolution" className="block text-[15px] font-bold text-navy-900">처리 결과 (완료에 필수)</label>
                <select id="inq-resolution" value={resolution} onChange={(e) => setResolution(e.target.value)} className={field}>
                  <option value="">(선택)</option>
                  {INQUIRY_RESOLUTIONS.map((r) => (<option key={r} value={r}>{INQUIRY_RESOLUTION_LABELS[r]}</option>))}
                </select>
              </div>
              <div>
                <label htmlFor="inq-reason" className="block text-[15px] font-bold text-navy-900">처리 사유 (완료에 필수)</label>
                <textarea id="inq-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className={`${field} py-2`} />
              </div>
            </>
          )}
          <div>
            <label htmlFor="inq-memo" className="block text-[15px] font-bold text-navy-900">메모</label>
            <textarea id="inq-memo" value={memo} onChange={(e) => setMemo(e.target.value)} rows={4} className={`${field} py-2`} />
          </div>
          <button type="button" onClick={save} disabled={busy} className={button} data-testid="inquiry-save">저장</button>
        </>
      )}
      {message && (
        <p role={message.ok ? "status" : "alert"} data-testid="inquiry-message" className={`text-[15px] font-bold ${message.ok ? "text-emerald-800" : "text-rose-800"}`}>{message.text}</p>
      )}
    </div>
  );
}
