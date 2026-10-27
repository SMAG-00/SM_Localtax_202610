"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DarkButton, SelectField, TextField } from "@ltr/ui";
import { LICENSE_TYPES, LICENSE_TYPE_LABELS } from "@ltr/editorial";
import { adminApi, adminUpload, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { optionsOf } from "@/lib/admin/labels";
import { MEDIA_KIND_LABELS, MEDIA_MAX_BYTES } from "@/lib/admin/media-rules";
import { ErrorSummary, StatusNote } from "./fields";
import { OUTLINE_BUTTON } from "./ui";
import { useHydrated } from "./useHydrated";

const LICENSE_TYPE_OPTIONS = LICENSE_TYPES.map((t) => ({ value: t, label: LICENSE_TYPE_LABELS[t] }));

/** 사진 올리기 (F1) — 파일 + 설명·출처·작가·이용 조건·원본 주소. 올린 사진은 '권리 미확인'으로 들어간다 */
export function MediaUploadForm() {
  const hydrated = useHydrated();
  const router = useRouter();
  const [fileError, setFileError] = useState("");
  const [failure, setFailure] = useState<{ title: string; details: string[] } | null>(null);
  const [done, setDone] = useState("");
  const [pending, setPending] = useState(false);
  const [formKey, setFormKey] = useState(0);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFailure(null);
    setDone("");
    const form = e.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setFileError("사진 파일을 골라 주세요");
      document.getElementById("media-new-file")?.focus();
      return;
    }
    if (file.size > MEDIA_MAX_BYTES) {
      setFileError(`파일이 너무 큽니다 — 약 4MB 이하 사진만 올릴 수 있습니다 (지금 ${(file.size / 1_000_000).toFixed(1)}MB)`);
      document.getElementById("media-new-file")?.focus();
      return;
    }
    setFileError("");
    setPending(true);
    const r = await adminUpload("/api/admin/media", data);
    setPending(false);
    if (r.status === 201) {
      setDone("사진을 올렸습니다 — 권리 확인 전에는 기사에 나오지 않습니다");
      setFormKey((k) => k + 1);
      router.refresh();
      return;
    }
    setFailure({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }

  return (
    <form key={formKey} onSubmit={submit} noValidate className="space-y-3" aria-label="사진 올리기">
      <div>
        <label htmlFor="media-new-file" className="block text-[15px] font-bold text-navy-900">
          사진 파일 <span className="text-rose-700">(필수)</span>
        </label>
        <input
          id="media-new-file"
          name="file"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-describedby="media-new-file-hint"
          aria-invalid={fileError ? true : undefined}
          className="mt-1 block w-full min-w-0 text-[15px] text-navy-800"
        />
        <p id="media-new-file-hint" className="mt-1 text-[14px] text-navy-600">
          jpg·png·webp, 4MB 이하
        </p>
        {fileError && (
          <p role="alert" className="mt-1 text-[14px] font-bold text-rose-700">
            {fileError}
          </p>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id="media-new-alt" name="alt" label="대체 텍스트(사진 설명)" required hint="사진에 무엇이 있는지 적습니다" />
        <SelectField id="media-new-kind" name="kind" label="종류" options={optionsOf(MEDIA_KIND_LABELS)} defaultValue="photo" />
        <TextField id="media-new-credit" name="credit" label="출처" hint="예: 가온시청 · 한국일보" />
        <TextField id="media-new-photographer" name="photographer" label="촬영자(작가)" hint="사진은 권리 확인 때 필요합니다" />
        <TextField id="media-new-license" name="license" label="이용 조건" hint="예: 자체 촬영 · 공공누리 제1유형" />
        <SelectField id="media-new-license-type" name="license_type" label="공공누리 유형" options={LICENSE_TYPE_OPTIONS} placeholder="나중에 정합니다" hint="자체 촬영은 ‘해당 없음’" defaultValue="" />
      </div>
      <TextField id="media-new-source-url" name="source_url" label="원본 주소" hint="http:// 또는 https:// 로 시작" />
      {failure && <ErrorSummary title={failure.title} messages={failure.details} />}
      {done && <StatusNote>{done}</StatusNote>}
      <DarkButton type="submit" disabled={pending || !hydrated}>
        {pending ? "올리는 중" : "사진 올리기"}
      </DarkButton>
    </form>
  );
}

/** 권리 확인·반려·되돌리기 (F1 · NAV-04) — 편집 책임자·관리자만 이 단추를 본다 */
export function MediaRightsButtons({ id, status, label }: { id: number; status: string; label: string }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ title: string; details: string[] } | null>(null);

  async function decide(decision: "confirmed" | "rejected" | "unconfirmed") {
    setFailure(null);
    setPending(true);
    const r = await adminApi("POST", `/api/admin/media/${id}/rights`, { decision });
    setPending(false);
    if (r.status === 200) {
      router.refresh();
      return;
    }
    setFailure({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {status !== "confirmed" && (
          <button type="button" className={OUTLINE_BUTTON} disabled={pending || !hydrated} onClick={() => decide("confirmed")} aria-label={`${label} 권리 확인`}>
            권리 확인
          </button>
        )}
        {status !== "rejected" && (
          <button type="button" className={OUTLINE_BUTTON} disabled={pending || !hydrated} onClick={() => decide("rejected")} aria-label={`${label} 반려`}>
            반려
          </button>
        )}
        {status !== "unconfirmed" && (
          <button type="button" className={OUTLINE_BUTTON} disabled={pending || !hydrated} onClick={() => decide("unconfirmed")} aria-label={`${label} 확인 되돌리기`}>
            확인 되돌리기
          </button>
        )}
      </div>
      {failure && <ErrorSummary title={failure.title} messages={failure.details} />}
    </div>
  );
}
