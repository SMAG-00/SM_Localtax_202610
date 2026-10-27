"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { track } from "@/lib/analytics/client";
import { UiLink } from "@ltr/ui";
import { REPORT_REASONS, REPORT_REASON_LABEL } from "@/lib/qna/logic";

// 라운지 쓰기 폼 (W13-g QNA-01·02·05) - 서버 API(/api/qna/*)만 부른다. 개인정보 경고를 확인해야 [등록]이 열린다.
// 상담 신청·매칭·결제 요소 0, 연락처 입력 칸 0.

const INPUT = "mt-1 block w-full rounded-xl border border-navy-200 bg-white px-3 py-2 text-[16px] text-navy-900";
const LABEL = "block text-[15px] font-bold text-navy-900";
const BUTTON = "inline-flex min-h-11 items-center rounded-xl bg-navy-900 px-4 py-2 text-[15px] font-bold text-white disabled:opacity-40";

async function post(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

function messageOf(status: number, data: Record<string, unknown>): string {
  if (status === 401) return "로그인이 필요합니다.";
  if (status === 429) return "시도가 너무 많습니다. 잠시 뒤 다시 시도하세요.";
  const errors = Array.isArray(data.errors) ? (data.errors as string[]).join(" / ") : "";
  return errors || (typeof data.error === "string" ? data.error : "처리하지 못했습니다.");
}

export function QuestionForm({ warning, defaultTax = "" }: { warning: string; defaultTax?: string }) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [solvedConsent, setSolvedConsent] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      data-part="qna-question-form"
      className="mt-4 space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        const r = await post("/api/qna/questions", { tax_type: f.get("tax_type"), title: f.get("title"), body: f.get("body"), warning_confirmed: confirmed, solved_consent: solvedConsent });
        setBusy(false);
        if (!r.ok) return setMsg(messageOf(r.status, r.data));
        const q = r.data.question as { id: number; status: string };
        // 등록 성공 응답 뒤 발송 - 속성은 events.ts 사양대로(세목은 자유 입력이라 보내지 않는다)
        await track("qna_posted", { props: {} });
        if (q.status === "held") return setMsg("등록했습니다. 개인정보가 가려진 글은 운영자가 확인한 뒤 공개됩니다.");
        router.push(`/qna/${q.id}`);
      }}
    >
      <label className={LABEL}>
        세목
        <input name="tax_type" required maxLength={30} defaultValue={defaultTax} className={INPUT} />
      </label>
      <label className={LABEL}>
        제목
        <input name="title" required minLength={2} maxLength={120} className={INPUT} />
      </label>
      <label className={LABEL}>
        내용
        <textarea name="body" required minLength={2} maxLength={4000} rows={8} className={INPUT} />
      </label>
      <label data-part="pii-warning" className="flex items-start gap-2 text-[15px] text-navy-800">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1 h-5 w-5" />
        <span>{warning}</span>
      </label>
      {/* 해결 사례 소개 선택 동의 (HOME-11, 결정 #17) - 기본 꺼짐. 안내 문구는 법률 검토본이 들어갈 자리이고 아래 한 줄은 기능 설명용 */}
      <label data-part="solved-consent" className="flex items-start gap-2 text-[15px] text-navy-800">
        <input type="checkbox" name="solved_consent" checked={solvedConsent} onChange={(e) => setSolvedConsent(e.target.checked)} className="mt-1 h-5 w-5" />
        <span>(선택) 채택된 질문을 홈의 해결 사례로 소개하는 데 동의합니다. 소개 전에 편집자가 개인정보 가림을 확인하고, 동의는 언제든 철회할 수 있습니다.</span>
      </label>
      <button type="submit" disabled={!confirmed || busy} data-part="qna-submit" className={BUTTON}>
        등록
      </button>
      {msg && (
        <p role="status" data-part="form-message" className="text-[15px] text-navy-800">
          {msg}
        </p>
      )}
    </form>
  );
}

export function AnswerForm({ questionId }: { questionId: number }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      data-part="qna-answer-form"
      className="mt-4 space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        setBusy(true);
        const r = await post("/api/qna/answers", { question_id: questionId, body: f.get("body") });
        setBusy(false);
        if (!r.ok) return setMsg(messageOf(r.status, r.data));
        const a = r.data.answer as { status: string };
        await track("qna_answered", { props: { by_expert: r.data.by_expert === true } });
        form.reset();
        if (a.status === "held") return setMsg("등록했습니다. 운영자가 확인한 뒤 공개됩니다.");
        window.location.reload();
      }}
    >
      <label className={LABEL}>
        답변
        <textarea name="body" required minLength={2} maxLength={4000} rows={6} className={INPUT} />
      </label>
      <button type="submit" disabled={busy} className={BUTTON}>
        답변 등록
      </button>
      {msg && (
        <p role="status" className="text-[15px] text-navy-800">
          {msg}
        </p>
      )}
    </form>
  );
}

export function AcceptButton({ questionId, answerId, byExpert }: { questionId: number; answerId: number; byExpert: boolean }) {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span>
      <button
        type="button"
        data-part="qna-accept"
        className={BUTTON}
        onClick={async () => {
          const r = await post("/api/qna/accept", { question_id: questionId, answer_id: answerId });
          if (r.ok) {
            await track("qna_accepted", { props: { by_expert: byExpert } });
            return window.location.reload();
          }
          setMsg(r.status === 403 ? "질문 작성자만 채택할 수 있습니다." : messageOf(r.status, r.data));
        }}
      >
        채택
      </button>
      {msg && <span role="status" className="ml-2 text-[14px] text-navy-700">{msg}</span>}
    </span>
  );
}

export function ReportButton({ targetType, targetId }: { targetType: "question" | "answer"; targetId: number }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!open) {
    return (
      <button type="button" data-part="qna-report-open" className="min-h-11 text-[14px] text-navy-700 underline" onClick={() => setOpen(true)}>
        신고
      </button>
    );
  }
  return (
    <form
      data-part="qna-report-form"
      className="mt-2 flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const r = await post("/api/qna/reports", { target_type: targetType, target_id: targetId, reason: f.get("reason"), note: f.get("note") ?? "" });
        setMsg(r.ok ? "신고를 접수했습니다." : r.status === 409 ? "이미 신고한 글입니다." : messageOf(r.status, r.data));
      }}
    >
      <select name="reason" className="rounded-xl border border-navy-200 px-2 py-2 text-[15px]" defaultValue="ad">
        {REPORT_REASONS.map((r) => (
          <option key={r} value={r}>
            {REPORT_REASON_LABEL[r]}
          </option>
        ))}
      </select>
      <input name="note" maxLength={200} placeholder="사유(선택, 개인정보 제외)" className="rounded-xl border border-navy-200 px-2 py-2 text-[15px]" />
      <button type="submit" className={BUTTON}>
        접수
      </button>
      {msg && <span role="status" className="text-[14px] text-navy-700">{msg}</span>}
    </form>
  );
}

/** 활동 전문가 띠 링크 - 눌렀을 때 expert_strip_clicked(순위만) */
export function StripLink({ href, rank, children }: { href: string; rank: number; children: string }) {
  return (
    <UiLink href={href} className="font-bold text-navy-900 underline" onClick={() => void track("expert_strip_clicked", { props: { rank } })}>
      {children}
    </UiLink>
  );
}
