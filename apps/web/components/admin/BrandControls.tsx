"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DarkButton, TextField } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { CONSENT_SCOPES, EVIDENCE_KINDS } from "@/lib/server/public/constants";
import { ErrorSummary, StatusNote } from "./fields";
import { useHydrated } from "./useHydrated";

// 브랜드 관리 입력 (W3 7단계 — /admin/brand). 증빙·동의서는 위치(참조)만 적는다 — 문서·문구는 저장소 밖(PO 관리).
// 값 검사는 서버(lib/admin/brand-rules.ts)와 DB가 한다. 승인 버튼(증빙 승인·동의서·경력 표시·광고 규정 감수·브랜드 문구)은 관리자에게만 보인다.

export const EVIDENCE_KIND_LABEL: Record<(typeof EVIDENCE_KINDS)[number], string> = { document: "문서", official_record: "공식 기록", publisher_history: "회사 출판 이력" };
export const SCOPE_LABEL: Record<(typeof CONSENT_SCOPES)[number], string> = {
  profile_page: "인물 페이지",
  column: "칼럼",
  home: "홈",
  external_profile: "외부 프로필",
  product: "상품",
  ad: "광고",
  video: "영상",
};
const BUTTON = "rounded-lg border border-navy-200 px-3 py-1.5 text-[14px] font-bold disabled:opacity-50";

function useSend() {
  const router = useRouter();
  const [error, setError] = useState<{ title: string; details: string[] } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  async function send(body: Record<string, unknown>, okText: string): Promise<boolean> {
    setError(null);
    setDone(null);
    const r = await adminApi("POST", "/api/admin/brand", body);
    if (r.status >= 200 && r.status < 300) {
      setDone(okText);
      router.refresh();
      return true;
    }
    setError({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
    return false;
  }
  return { send, error, done };
}

function Result({ id, error, done }: { id: string; error: { title: string; details: string[] } | null; done: string | null }) {
  return (
    <>
      {error && <ErrorSummary id={id} title={error.title} messages={error.details} />}
      {done && <StatusNote>{done}</StatusNote>}
    </>
  );
}

/** 버튼 하나로 끝나는 동작 — 증빙 승인·거둠, 동의 철회, 경력 표시·감수 기록 철회, 브랜드 문구 켜기·끄기 */
export function BrandActionButton({ body, label, okText, action, confirmText }: { body: Record<string, unknown>; label: ReactNode; okText: string; action: string; confirmText?: string }) {
  const hydrated = useHydrated();
  const { send, error, done } = useSend();
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        data-action={action}
        disabled={!hydrated}
        className={BUTTON}
        onClick={() => {
          if (confirmText && !window.confirm(confirmText)) return;
          void send(body, okText);
        }}
      >
        {label}
      </button>
      <Result id={`brand-${action}-error`} error={error} done={done} />
    </span>
  );
}

export function EvidenceForm({ personId }: { personId: number }) {
  const hydrated = useHydrated();
  const { send, error, done } = useSend();
  const [kind, setKind] = useState<string>(EVIDENCE_KINDS[0]);
  const [docRef, setDocRef] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await send({ op: "evidence", personId, kind, docRef }, "증빙 위치를 등록했습니다 (승인 전).")) setDocRef("");
  };
  return (
    <form onSubmit={submit} data-form="brand-evidence" data-person-id={personId} className="space-y-2" aria-label="증빙 등록">
      <label className="block text-[15px] text-navy-800">
        종류{" "}
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded border border-navy-200 px-2 py-1">
          {EVIDENCE_KINDS.map((k) => (
            <option key={k} value={k}>
              {EVIDENCE_KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <TextField id={`ev-ref-${personId}`} label="증빙 문서 위치 (저장소 밖 — 보관 위치·문서 번호)" value={docRef} onChange={(e) => setDocRef(e.target.value)} required />
      <Result id={`ev-error-${personId}`} error={error} done={done} />
      <DarkButton type="submit" disabled={!hydrated}>
        증빙 등록
      </DarkButton>
    </form>
  );
}

export function ConsentForm({ personId }: { personId: number }) {
  const hydrated = useHydrated();
  const { send, error, done } = useSend();
  const [version, setVersion] = useState("");
  const [docRef, setDocRef] = useState("");
  const [validTo, setValidTo] = useState("");
  const [scope, setScope] = useState<string[]>([]);
  const toggle = (s: string) => setScope((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await send({ op: "consent", personId, version, docRef, scope, validTo: validTo || null }, "동의서 버전을 기록했습니다.")) {
      setVersion("");
      setDocRef("");
      setValidTo("");
      setScope([]);
    }
  };
  return (
    <form onSubmit={submit} data-form="brand-consent" data-person-id={personId} className="space-y-2" aria-label="동의서 기록">
      <TextField id={`cs-ver-${personId}`} label="동의서 버전" value={version} onChange={(e) => setVersion(e.target.value)} required />
      <TextField id={`cs-ref-${personId}`} label="동의서 문서 위치 (저장소 밖)" value={docRef} onChange={(e) => setDocRef(e.target.value)} required />
      <fieldset className="text-[15px] text-navy-800">
        <legend className="font-bold">사용 범위 (필요한 것만)</legend>
        <div className="mt-1 flex flex-wrap gap-3">
          {CONSENT_SCOPES.map((s) => (
            <label key={s} className="inline-flex items-center gap-1">
              <input type="checkbox" checked={scope.includes(s)} onChange={() => toggle(s)} data-scope={s} />
              {SCOPE_LABEL[s]}
            </label>
          ))}
        </div>
      </fieldset>
      <TextField id={`cs-to-${personId}`} label="유효 기간 끝 (비우면 철회 전까지, 예: 2027-12-31)" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
      <Result id={`cs-error-${personId}`} error={error} done={done} />
      <DarkButton type="submit" disabled={!hydrated}>
        동의서 기록
      </DarkButton>
    </form>
  );
}

/** 경력 표시 승인(근거 증빙 번호) · 광고 규정 감수 기록(기록 위치) — 관리자만 */
export function ApprovalForm({ op, label, field, fieldLabel }: { op: "career_claim" | "brand_review"; label: string; field: "basisEvidenceId" | "recordRef"; fieldLabel: string }) {
  const hydrated = useHydrated();
  const { send, error, done } = useSend();
  const [value, setValue] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send({ op, value: true, [field]: field === "basisEvidenceId" ? Number(value) : value }, `${label}을(를) 기록했습니다.`);
  };
  return (
    <form onSubmit={submit} data-form={`brand-${op}`} className="space-y-2" aria-label={label}>
      <TextField id={`ap-${op}`} label={fieldLabel} value={value} onChange={(e) => setValue(e.target.value)} required />
      <Result id={`ap-error-${op}`} error={error} done={done} />
      <DarkButton type="submit" disabled={!hydrated}>
        {label}
      </DarkButton>
    </form>
  );
}
