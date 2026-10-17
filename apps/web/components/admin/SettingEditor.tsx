"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DarkButton, TextField } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { parseJsonText, validateSettingValue } from "@/lib/admin/settings-rules";
import { ErrorSummary, StatusNote, TextAreaField } from "./fields";
import { useHydrated } from "./useHydrated";

/**
 * 운영 설정 한 줄 편집 (관리자) — 값은 JSON 글로 고친다. 저장 전에 화면이 같은 규칙(lib/admin/settings-rules.ts)으로 검사하고,
 * 서버도 다시 검사한다(422면 칸 오류). 읽은 뒤 다른 사람이 고쳤으면 409.
 */
export function SettingEditor({ settingKey, value, updatedAt, guide }: { settingKey: string; value: unknown; updatedAt: string; guide: string }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const base = `setting-${settingKey.replace(/[^a-z0-9]/g, "-")}`;
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [failure, setFailure] = useState("");
  const [done, setDone] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFailure("");
    setDone("");
    const parsed = parseJsonText(text);
    const local = parsed.ok ? validateSettingValue(settingKey, parsed.value, value) : { ok: false as const, errors: [parsed.error] };
    if (!local.ok) {
      setErrors(local.errors);
      document.getElementById(`${base}-value`)?.focus();
      return;
    }
    setErrors([]);
    setPending(true);
    const r = await adminApi("PATCH", `/api/admin/settings/${encodeURIComponent(settingKey)}`, { valueJson: text, updatedAt, ...(reason.trim() ? { reason: reason.trim() } : {}) });
    setPending(false);
    if (r.status === 200) {
      setDone(r.body.unchanged ? "바뀐 내용이 없습니다" : "저장했습니다 — 다음 점검부터 이 값을 씁니다");
      setReason("");
      router.refresh();
      return;
    }
    if (r.status === 422) setErrors(apiErrorDetails(r).length ? apiErrorDetails(r) : [apiErrorMessage(r)]);
    else setFailure(apiErrorMessage(r));
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3" aria-label={`${settingKey} 고치기`}>
      <TextAreaField
        id={`${base}-value`}
        label="값 (JSON)"
        hint={guide}
        rows={Math.min(14, Math.max(3, text.split("\n").length + 1))}
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
        error={errors.length ? errors.join(" · ") : undefined}
      />
      <TextField id={`${base}-reason`} label="고치는 이유" hint="감사 기록에 남습니다 (비우면 '설정 고치기')" value={reason} onChange={(e) => setReason(e.target.value)} />
      {errors.length > 0 && <ErrorSummary title="값이 규칙에 맞지 않습니다" messages={errors} />}
      {failure && <ErrorSummary title={failure} messages={[]} />}
      {done && <StatusNote>{done}</StatusNote>}
      <DarkButton type="submit" disabled={pending || !hydrated}>
        {pending ? "저장하는 중" : "설정 저장"}
      </DarkButton>
    </form>
  );
}
