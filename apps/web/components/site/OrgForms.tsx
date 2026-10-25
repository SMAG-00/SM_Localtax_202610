"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { OrgBoard } from "@/lib/server/org/service";

// 기관 화면의 입력 부품 (W11-f, BIZ-07·PAY-04). 계약·약관 문구는 이 파일에 없다 - 입력 칸과 서버 응답 상태만 보여 준다.
//  · 좌석 수·등급 값은 화면이 정하지 않는다. 서버가 DB에서 판정하고, 화면은 거부 사유를 그대로 보여 준다.
//  · 초대 링크 원문은 만든 직후 이 화면에서만 한 번 보인다(서버에는 해시만 남는다).

const FIELD = "mt-1 block min-h-11 w-full rounded-xl border border-navy-200 bg-white px-3 text-[17px] text-navy-900";
const BUTTON = "inline-flex min-h-11 items-center justify-center rounded-xl bg-navy-900 px-5 text-[17px] font-bold text-white disabled:opacity-50";

async function post(url: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}
const messageOf = (d: Record<string, unknown>) => (Array.isArray(d.errors) ? (d.errors as string[]).join(" / ") : typeof d.error === "string" ? d.error : typeof d.message === "string" ? d.message : "처리하지 못했습니다");

export function InquiryForm() {
  const [state, setState] = useState<{ kind: "idle" | "busy" | "done" | "error"; text?: string }>({ kind: "idle" });
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setState({ kind: "busy" });
    const r = await post("/api/institution/inquiries", {
      orgType: f.get("orgType"), orgName: f.get("orgName"), contactName: f.get("contactName"), contactEmail: f.get("contactEmail"),
      contactPhone: f.get("contactPhone"), seatsWanted: Number(f.get("seatsWanted")), message: f.get("message"),
      consentContact: f.get("consentContact") === "on", consentMarketing: f.get("consentMarketing") === "on",
    });
    if (r.status === 201) setState({ kind: "done", text: `접수번호 ${String(r.data.receiptNo)}` });
    else setState({ kind: "error", text: messageOf(r.data) });
  }
  return (
    <form onSubmit={submit} data-part="inquiry-form" className="mt-6 grid max-w-xl gap-4">
      <label className="block text-[17px] font-bold text-navy-900">기관 유형
        <select name="orgType" required className={FIELD} defaultValue="local_government">
          <option value="local_government">지자체</option>
          <option value="tax_firm">세무법인</option>
          <option value="financial">금융기관</option>
        </select>
      </label>
      <label className="block text-[17px] font-bold text-navy-900">기관 이름<input name="orgName" required maxLength={100} className={FIELD} /></label>
      <label className="block text-[17px] font-bold text-navy-900">담당자 이름<input name="contactName" required maxLength={60} className={FIELD} /></label>
      <label className="block text-[17px] font-bold text-navy-900">이메일<input name="contactEmail" type="email" required className={FIELD} /></label>
      <label className="block text-[17px] font-bold text-navy-900">전화번호 (선택)<input name="contactPhone" inputMode="tel" className={FIELD} /></label>
      <label className="block text-[17px] font-bold text-navy-900">필요한 좌석 수<input name="seatsWanted" type="number" min={1} max={10000} required defaultValue={1} className={FIELD} /></label>
      <label className="block text-[17px] font-bold text-navy-900">문의 내용 (선택)<textarea name="message" maxLength={2000} rows={4} className={FIELD} /></label>
      <label className="flex min-h-11 items-center gap-3 text-[17px] text-navy-900"><input name="consentContact" type="checkbox" className="h-5 w-5" />견적 안내를 위한 연락에 동의합니다 (필수)</label>
      <label className="flex min-h-11 items-center gap-3 text-[17px] text-navy-900"><input name="consentMarketing" type="checkbox" className="h-5 w-5" />소식 수신에 동의합니다 (선택)</label>
      <button type="submit" disabled={state.kind === "busy"} className={BUTTON}>견적 요청 보내기</button>
      {state.kind === "done" && <p role="status" data-part="inquiry-done" className="text-[17px] font-bold text-navy-900">{state.text}</p>}
      {state.kind === "error" && <p role="alert" data-part="inquiry-error" className="text-[17px] font-bold text-navy-900">{state.text}</p>}
    </form>
  );
}

const STATUS_LABEL: Record<string, string> = { invited: "초대 중", active: "사용 중", revoked: "회수됨" };

export function SeatBoard({ board }: { board: OrgBoard }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const base = `/api/org/${board.org.id}/seats`;
  const c = board.contract;
  const canInvite = board.securityApproved && c !== null && c.status === "active" && board.usedSeats < c.seats;

  async function run(body: Record<string, unknown>, okText: string) {
    setMsg(null);
    const r = await post(base, body);
    if (r.status >= 200 && r.status < 300) {
      setMsg(okText);
      if (typeof r.data.acceptPath === "string") setLink(`${window.location.origin}${r.data.acceptPath}`);
      router.refresh();
    } else setMsg(messageOf(r.data));
  }
  return (
    <div data-part="seat-board" className="mt-6 grid gap-6">
      <p data-part="seat-summary" className="text-[17px] text-navy-800">
        {c ? `계약 ${c.startsOn} ~ ${c.endsOn} (종료일 당일까지 이용) · 좌석 ${board.usedSeats} / ${c.seats} 사용` : "진행 중인 계약이 없습니다."}
      </p>
      {!board.securityApproved && (
        <p role="note" data-part="security-pending" className="rounded-xl border border-navy-200 bg-white px-4 py-3 text-[17px] font-bold text-navy-900">
          보안·개인정보 확인표가 승인되기 전에는 좌석을 열 수 없습니다.
        </p>
      )}
      {canInvite && (
        <form onSubmit={(e) => { e.preventDefault(); void run({ op: "invite", expiresInDays: Number(new FormData(e.currentTarget).get("days")) }, "초대 링크를 만들었습니다"); }} className="grid max-w-sm gap-3" data-part="invite-form">
          <label className="block text-[17px] font-bold text-navy-900">초대 링크 유효 일수 (1~30)<input name="days" type="number" min={1} max={30} defaultValue={7} className={FIELD} /></label>
          <button type="submit" className={BUTTON}>좌석 초대 링크 만들기</button>
        </form>
      )}
      {link && <p data-part="invite-link" className="break-all text-[17px] font-bold text-navy-900">{link}</p>}
      <ul data-part="seat-list" className="grid gap-2">
        {board.seats.map((s, i) => (
          <li key={s.id} data-seat-status={s.status} className="flex min-h-11 items-center justify-between rounded-xl border border-navy-200 bg-white px-4 py-2 text-[17px] text-navy-900">
            <span>좌석 {i + 1} · {STATUS_LABEL[s.status] ?? s.status}</span>
            {s.status !== "revoked" && <button type="button" onClick={() => void run({ op: "revoke", seatId: s.id }, "좌석을 회수했습니다")} className="min-h-11 px-3 font-bold underline underline-offset-4">회수</button>}
          </li>
        ))}
      </ul>
      <div data-part="tax-invoice">
        <h3 className="text-[19px] font-bold text-navy-900">세금계산서·영수증 요청</h3>
        {!board.org.hasBusinessInfo && <p className="mt-2 text-[17px] text-navy-800">사업자등록번호와 수신 이메일이 등록되어야 요청할 수 있습니다. 운영 담당에게 등록을 요청해 주세요.</p>}
        {board.org.hasBusinessInfo && c && (
          <div className="mt-2 flex gap-3">
            <button type="button" onClick={() => void run({ op: "tax_invoice", kind: "tax_invoice" }, "세금계산서를 요청했습니다")} className={BUTTON}>세금계산서 요청</button>
            <button type="button" onClick={() => void run({ op: "tax_invoice", kind: "receipt" }, "영수증을 요청했습니다")} className={BUTTON}>영수증 요청</button>
          </div>
        )}
        <ul className="mt-3 grid gap-2" data-part="tax-invoice-list">
          {board.taxInvoices.map((t) => (
            <li key={t.id} className="text-[17px] text-navy-800">{t.kind === "tax_invoice" ? "세금계산서" : "영수증"} · {t.status === "issued" ? `발행됨 ${t.issuedOn ?? ""}` : t.status === "requested" ? "발행 대기" : "취소"}</li>
          ))}
        </ul>
      </div>
      {msg && <p role="status" data-part="seat-message" className="text-[17px] font-bold text-navy-900">{msg}</p>}
    </div>
  );
}

export function AcceptPanel({ token }: { token: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  async function accept() {
    const r = await post("/api/org/accept", { token });
    if (r.status === 201) {
      setDone(true);
      setMsg("좌석이 열렸습니다.");
    } else setMsg(messageOf(r.data));
  }
  return (
    <div data-part="accept-panel" className="mt-6">
      {!done && <button type="button" onClick={() => void accept()} className={BUTTON}>초대 수락하기</button>}
      {msg && <p role="status" data-part="accept-message" className="mt-4 text-[17px] font-bold text-navy-900">{msg}</p>}
    </div>
  );
}
