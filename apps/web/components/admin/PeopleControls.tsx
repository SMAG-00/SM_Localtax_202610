"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DarkButton, SelectField, TextField } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { EMPLOYMENT_LABELS, PERSON_ROLES, PERSON_ROLE_LABELS, PERSON_VISIBILITY_LABELS } from "@/lib/admin/people-rules";
import { optionsOf } from "@/lib/admin/labels";
import { ErrorSummary, FieldGroup, StatusNote, TextAreaField } from "./fields";
import { OUTLINE_BUTTON } from "./ui";
import { useHydrated } from "./useHydrated";

/** 인물 등록 (F2 · NAV-19) — 이름·주소·역할·고용 형태·소속·담당·이해관계·공개 여부. 약력·동의서는 브랜드 관리 화면에서 다룬다 */
export function PersonCreateForm() {
  const hydrated = useHydrated();
  const router = useRouter();
  const [failure, setFailure] = useState<{ title: string; details: string[] } | null>(null);
  const [done, setDone] = useState("");
  const [pending, setPending] = useState(false);
  const [formKey, setFormKey] = useState(0);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFailure(null);
    setDone("");
    const data = new FormData(e.currentTarget);
    const text = (k: string) => String(data.get(k) ?? "");
    const body: Record<string, unknown> = {
      name: text("name"),
      slug: text("slug"),
      roles: data.getAll("roles").map(String),
      visibility: text("visibility") || "hidden",
    };
    if (text("employment")) body.employment = text("employment");
    for (const k of ["affiliation", "beat", "conflicts"]) if (text(k).trim() !== "") body[k] = text(k);
    setPending(true);
    const r = await adminApi("POST", "/api/admin/people", body);
    setPending(false);
    if (r.status === 201) {
      setDone("인물을 등록했습니다 — 아래 목록에서 편집국 계정을 연결하세요");
      setFormKey((k) => k + 1);
      router.refresh();
      return;
    }
    setFailure({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }

  return (
    <form key={formKey} onSubmit={submit} noValidate className="space-y-3" aria-label="인물 등록">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id="person-new-name" name="name" label="이름" required hint="60자 이하" />
        <TextField id="person-new-slug" name="slug" label="주소(slug)" required hint="영문 소문자·숫자·‘-’ (예: kim-reporter)" />
        <SelectField id="person-new-employment" name="employment" label="고용 형태" options={optionsOf(EMPLOYMENT_LABELS)} placeholder="정하지 않음" defaultValue="" />
        <SelectField id="person-new-visibility" name="visibility" label="공개 여부" options={optionsOf(PERSON_VISIBILITY_LABELS)} defaultValue="hidden" hint="기본은 비공개" />
        <TextField id="person-new-affiliation" name="affiliation" label="소속" />
        <TextField id="person-new-beat" name="beat" label="담당 분야" />
      </div>
      <FieldGroup legend="역할 (필수, 1개 이상)">
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {PERSON_ROLES.map((r) => (
            <label key={r} className="inline-flex min-h-11 items-center gap-2 text-[16px] text-navy-900">
              <input type="checkbox" name="roles" value={r} className="size-5" />
              {PERSON_ROLE_LABELS[r]}
            </label>
          ))}
        </div>
      </FieldGroup>
      <TextAreaField id="person-new-conflicts" name="conflicts" label="이해관계(내부 메모)" hint="독자 화면에 나오지 않습니다" rows={2} />
      {failure && <ErrorSummary title={failure.title} messages={failure.details} />}
      {done && <StatusNote>{done}</StatusNote>}
      <DarkButton type="submit" disabled={pending || !hydrated}>
        {pending ? "등록하는 중" : "인물 등록"}
      </DarkButton>
    </form>
  );
}

export interface AccountOption {
  userId: string;
  email: string | null;
}

/** 편집국 계정 연결·해제 — 한 계정에 인물 하나. 이미 다른 인물에 연결된 계정을 고르면 서버가 409로 거부한다 */
export function PersonAccountLink({ id, name, linkedUserId, accounts }: { id: number; name: string; linkedUserId: string | null; accounts: readonly AccountOption[] }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [failure, setFailure] = useState<{ title: string; details: string[] } | null>(null);
  const [pending, setPending] = useState(false);

  async function send(staff_user_id: string | null) {
    setFailure(null);
    setPending(true);
    const r = await adminApi("PATCH", `/api/admin/people/${id}`, { staff_user_id });
    setPending(false);
    if (r.status === 200) {
      setUserId("");
      router.refresh();
      return;
    }
    setFailure({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }

  if (linkedUserId) {
    const email = accounts.find((a) => a.userId === linkedUserId)?.email ?? linkedUserId;
    return (
      <div className="space-y-2">
        <p className="text-[14px] text-navy-800 [overflow-wrap:anywhere]">
          연결된 계정: <span data-testid="person-linked">{email}</span>
        </p>
        <button type="button" className={OUTLINE_BUTTON} disabled={pending || !hydrated} onClick={() => send(null)} aria-label={`${name} 계정 연결 해제`}>
          연결 해제
        </button>
        {failure && <ErrorSummary title={failure.title} messages={failure.details} />}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <SelectField
        id={`person-${id}-account`}
        label={`${name} 편집국 계정`}
        options={accounts.map((a) => ({ value: a.userId, label: a.email ?? a.userId }))}
        placeholder="계정을 고르세요"
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
      />
      <button type="button" className={OUTLINE_BUTTON} disabled={pending || !hydrated || userId === ""} onClick={() => send(userId)} aria-label={`${name} 계정 연결`}>
        계정 연결
      </button>
      {failure && <ErrorSummary title={failure.title} messages={failure.details} />}
    </div>
  );
}
