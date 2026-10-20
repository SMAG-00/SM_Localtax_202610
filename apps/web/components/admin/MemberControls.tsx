"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DarkButton, SelectField, TextField } from "@ltr/ui";
import type { StaffRole } from "@/lib/access";
import { adminApi, apiErrorMessage } from "@/lib/admin/api-client";
import { ROLE_LABELS } from "@/lib/admin/labels";
import { grantChoices, roleConflict } from "@/lib/admin/role-rules";
import { ErrorSummary, StatusNote } from "./fields";
import { OUTLINE_BUTTON, ToneChip } from "./ui";
import { useHydrated } from "./useHydrated";

/**
 * 서비스 역할 부여·회수 (ADM-02 · ACC-04) — 관리자만 이 화면을 본다.
 * 겸직 금지 조합(편집 책임자 + 광고·스토어·브랜드·전문가 담당)은 화면이 먼저 막고 사유를 보인다 — 역할 부여 API를 부르지 않는다.
 * 화면이 본 역할이 낡았으면(다른 관리자가 먼저 바꿈) 서버가 409로 거부하고, 그 문장을 그대로 보인다.
 */
export function MemberRoles({ userId, email, roles }: { userId: string; email: string; roles: readonly StaffRole[] }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const base = `member-${userId}`;
  const choices = grantChoices(roles);
  const [role, setRole] = useState<string>("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [pending, setPending] = useState(false);
  const selected = choices.find((c) => c.role === role);

  async function call(op: "grant" | "revoke", target: StaffRole) {
    setPending(true);
    setError("");
    setDone("");
    const r = await adminApi("POST", "/api/admin/roles", { op, userId, role: target, ...(reason.trim() ? { reason: reason.trim() } : {}) });
    setPending(false);
    if (r.status === 200 || r.status === 201) {
      setDone(op === "grant" ? `역할을 주었습니다 — ${ROLE_LABELS[target]}` : `역할을 거두었습니다 — ${ROLE_LABELS[target]}`);
      setRole("");
      setReason("");
      router.refresh();
      return;
    }
    setError(apiErrorMessage(r));
  }

  function grant(e: FormEvent) {
    e.preventDefault();
    setDone("");
    if (!selected) {
      setError("줄 역할을 골라 주세요");
      return;
    }
    // 겸직 금지 — 서버에 보내기 전에 막는다 (ADM-02 "화면이 막고 사유를 보인다")
    const blocked = roleConflict(roles, selected.role);
    if (blocked) {
      setError(blocked);
      return;
    }
    void call("grant", selected.role);
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[14px] font-bold text-navy-600">서비스 역할</p>
        {roles.length === 0 ? (
          <p className="text-[15px] text-navy-700">역할 없음 — 편집국 화면을 쓸 수 없습니다</p>
        ) : (
          <ul aria-label={`${email} 역할`} className="mt-1 flex flex-wrap gap-2">
            {roles.map((r) => (
              <li key={r} data-role={r} className="inline-flex items-center gap-1 rounded-xl border border-navy-200 bg-white py-1 pr-1 pl-3 text-[15px] text-navy-900">
                <span>{ROLE_LABELS[r]}</span>
                <button type="button" className={`${OUTLINE_BUTTON} px-3`} disabled={pending || !hydrated} onClick={() => void call("revoke", r)} aria-label={`${ROLE_LABELS[r]} 역할 거두기`}>
                  거두기
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {choices.length > 0 && (
        <form onSubmit={grant} noValidate className="space-y-3" aria-label={`${email}에게 역할 주기`}>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              id={`${base}-role`}
              label="줄 역할"
              options={choices.map((c) => ({ value: c.role, label: c.blockedReason ? `${c.label} — 겸직 금지` : c.label }))}
              placeholder="골라 주세요"
              value={role}
              onChange={(e) => {
                setRole(e.target.value);
                setError("");
              }}
              error={selected?.blockedReason ?? undefined}
            />
            <TextField id={`${base}-reason`} label="이유" hint="감사 기록에 남습니다" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DarkButton type="submit" disabled={pending || !hydrated}>
            {pending ? "처리하는 중" : "역할 주기"}
          </DarkButton>
        </form>
      )}
      {error && <ErrorSummary title={error} messages={[]} />}
      {done && <StatusNote>{done}</StatusNote>}
    </div>
  );
}

/** 계정 정지·해제 (ADM-02 정지) — 사유 필수. 정지하면 로그인이 막히고, 이미 열린 세션도 다음 요청부터 거부된다 */
export function MemberSuspension({ userId, email, suspended, blockedReason }: { userId: string; email: string; suspended: boolean; blockedReason: string | null }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const base = `member-${userId}-suspension`;
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setDone("");
    if (!reason.trim()) {
      setFieldError(suspended ? "정지를 푸는 이유를 적어 주세요" : "정지하는 이유를 적어 주세요");
      document.getElementById(`${base}-reason`)?.focus();
      return;
    }
    setFieldError("");
    setPending(true);
    const r = await adminApi("POST", `/api/admin/members/${userId}/suspension`, { suspend: !suspended, reason: reason.trim() });
    setPending(false);
    if (r.status === 200) {
      setDone(suspended ? "정지를 풀었습니다" : "계정을 정지했습니다 — 이 계정의 열린 세션도 다음 요청부터 거부됩니다");
      setReason("");
      router.refresh();
      return;
    }
    setError(apiErrorMessage(r));
  }

  if (!suspended && blockedReason) {
    return <p className="text-[15px] text-navy-700">{blockedReason}</p>;
  }
  return (
    <form onSubmit={submit} noValidate className="space-y-3" aria-label={`${email} ${suspended ? "정지 풀기" : "정지"}`}>
      {suspended && <ToneChip tone="rose">정지됨 — 로그인할 수 없습니다</ToneChip>}
      <TextField id={`${base}-reason`} label={suspended ? "정지를 푸는 이유" : "정지하는 이유"} required value={reason} onChange={(e) => setReason(e.target.value)} error={fieldError || undefined} />
      {error && <ErrorSummary title={error} messages={[]} />}
      {done && <StatusNote>{done}</StatusNote>}
      <DarkButton type="submit" disabled={pending || !hydrated}>
        {pending ? "처리하는 중" : suspended ? "정지 풀기" : "계정 정지"}
      </DarkButton>
    </form>
  );
}

/** 회원 계정 삭제 (W2-e 5.3) — 사유 필수. 동의·프로필·계정을 지운다(되돌릴 수 없음). 감사 기록에는 사유와 계정 번호만 남는다 */
export function MemberDelete({ userId, email }: { userId: string; email: string }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const base = `member-${userId}-delete`;
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!reason.trim()) {
      setFieldError("삭제하는 이유를 적어 주세요");
      document.getElementById(`${base}-reason`)?.focus();
      return;
    }
    setFieldError("");
    setPending(true);
    const r = await adminApi("DELETE", `/api/admin/members/${userId}`, { reason: reason.trim() });
    setPending(false);
    if (r.status === 200) {
      router.refresh();
      return;
    }
    setError(apiErrorMessage(r));
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3" aria-label={`${email} 삭제`}>
      <TextField id={`${base}-reason`} label="삭제하는 이유" hint="동의·프로필·계정이 지워지며 되돌릴 수 없습니다" required value={reason} onChange={(e) => setReason(e.target.value)} error={fieldError || undefined} />
      {error && <ErrorSummary title={error} messages={[]} />}
      <button type="submit" className={OUTLINE_BUTTON} disabled={pending || !hydrated}>
        {pending ? "처리하는 중" : "삭제"}
      </button>
    </form>
  );
}
