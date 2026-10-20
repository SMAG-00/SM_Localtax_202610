"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DarkButton } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { MONO } from "./ui";
import { useHydrated } from "./useHydrated";

// 정책 문서 편집·게시 (W2-e 6.2) — 본문은 줄 표기(`## 절 제목` · `- 항목` · `> 강조 문단` · 빈 줄 = 문단 나눔). 게시는 관리자만, 법률 검토 승인 기록 3칸 필수.
const INPUT = "mt-1 block min-h-11 w-full rounded-lg border border-navy-200 bg-white px-3 py-2 text-[16px] text-navy-900";

export function PolicyEditor({
  docKey,
  initialText,
  initialEffectiveOn,
  draftVersion,
  nextVersion,
  canPublish,
  warnings,
  skeleton,
}: {
  docKey: string;
  initialText: string;
  initialEffectiveOn: string;
  draftVersion: number | null;
  nextVersion: number;
  canPublish: boolean;
  warnings: string[];
  skeleton: string[];
}) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const [effectiveOn, setEffectiveOn] = useState(initialEffectiveOn);
  const [approvedBy, setApprovedBy] = useState("");
  const [approvedOn, setApprovedOn] = useState("");
  const [approvalNote, setApprovalNote] = useState("");
  const [changeSummary, setChangeSummary] = useState("");
  const [msg, setMsg] = useState("");
  const [errs, setErrs] = useState<string[]>([]);
  const [pending, setPending] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setErrs([]);
    setMsg("");
    const r = await adminApi("PUT", `/api/admin/policies/${docKey}`, { text, effectiveOn: effectiveOn || null });
    setPending(false);
    if (r.status === 200) {
      setMsg("초안을 저장했습니다");
      router.refresh();
    } else {
      setErrs([apiErrorMessage(r), ...apiErrorDetails(r)]);
    }
  }

  async function publish(e: FormEvent) {
    e.preventDefault();
    if (draftVersion === null) return;
    setPending(true);
    setErrs([]);
    setMsg("");
    const r = await adminApi("POST", `/api/admin/policies/${docKey}/publish`, {
      version: draftVersion,
      approvedBy,
      approvedOn,
      approvalNote,
      changeSummary: changeSummary || null,
      effectiveOn: effectiveOn || null,
    });
    setPending(false);
    if (r.status === 200) {
      setMsg("게시했습니다");
      router.refresh();
    } else {
      setErrs([apiErrorMessage(r), ...apiErrorDetails(r)]);
    }
  }

  const id = `policy-${docKey}`;
  return (
    <div data-doc={docKey}>
      {text.trim() === "" && skeleton.length > 0 && (
        <p data-part="skeleton" className="mb-3 text-[15px] text-navy-700">
          항목 이름: {skeleton.join(" · ")}
        </p>
      )}
      <form onSubmit={save} className="space-y-3">
        <label className="block text-[15px] font-bold text-navy-900" htmlFor={`${id}-text`}>
          본문 (다음 저장 버전 {draftVersion ?? nextVersion})
          <textarea id={`${id}-text`} name="text" rows={10} value={text} onChange={(e) => setText(e.target.value)} className={`${INPUT} ${MONO}`} />
        </label>
        <label className="block text-[15px] font-bold text-navy-900" htmlFor={`${id}-eff`}>
          시행일 (YYYY-MM-DD)
          <input id={`${id}-eff`} name="effectiveOn" value={effectiveOn} onChange={(e) => setEffectiveOn(e.target.value)} className={INPUT} />
        </label>
        <DarkButton type="submit" disabled={!hydrated || pending} data-action="save-draft">
          초안 저장
        </DarkButton>
      </form>
      {draftVersion !== null && warnings.length > 0 && (
        <ul data-part="warnings" className="mt-3 list-disc pl-6 text-[15px] text-amber-800">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {canPublish && draftVersion !== null && (
        <form onSubmit={publish} className="mt-6 space-y-3 border-t border-navy-100 pt-4">
          <h3 className="text-[16px] font-black text-navy-900">게시 승인 (법률 검토 기록 필수)</h3>
          <label className="block text-[15px] font-bold text-navy-900">
            검토자 (사람 또는 기관)
            <input name="approvedBy" value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} className={INPUT} />
          </label>
          <label className="block text-[15px] font-bold text-navy-900">
            검토일 (YYYY-MM-DD)
            <input name="approvedOn" value={approvedOn} onChange={(e) => setApprovedOn(e.target.value)} className={INPUT} />
          </label>
          <label className="block text-[15px] font-bold text-navy-900">
            승인 근거 메모
            <input name="approvalNote" value={approvalNote} onChange={(e) => setApprovalNote(e.target.value)} className={INPUT} />
          </label>
          <label className="block text-[15px] font-bold text-navy-900">
            개정 사유 (버전 2부터 필수)
            <input name="changeSummary" value={changeSummary} onChange={(e) => setChangeSummary(e.target.value)} className={INPUT} />
          </label>
          <DarkButton type="submit" disabled={!hydrated || pending} data-action="publish">
            게시
          </DarkButton>
        </form>
      )}
      {msg && (
        <p role="status" className="mt-3 text-[15px] font-bold text-emerald-800">
          {msg}
        </p>
      )}
      {errs.length > 0 && (
        <ul role="alert" data-part="errors" className="mt-3 list-disc pl-6 text-[15px] font-bold text-rose-800">
          {errs.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
