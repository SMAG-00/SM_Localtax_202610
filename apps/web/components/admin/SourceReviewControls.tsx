"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckboxField, DarkButton, TextField } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { parseSourceRef } from "@/lib/source-review/rules";
import { ErrorSummary, StatusNote, TextAreaField } from "./fields";
import { useHydrated } from "./useHydrated";

// 원문 검수 큐 (W4 6단계 — REG1-13) — 원문 다시 받기 폼 · 항목 해결 폼. 값 검사는 서버(lib/source-review/rules.ts)와 같은 규칙.
// 원문 글자는 화면에 다시 보이지 않는다(해시·수만).

type Problem = { title: string; details: string[] } | null;

export function RefetchForm() {
  const router = useRouter();
  const hydrated = useHydrated();
  const [ref, setRef] = useState("");
  const [text, setText] = useState("");
  const [refError, setRefError] = useState<string | undefined>();
  const [error, setError] = useState<Problem>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);
    const sourceId = parseSourceRef(ref);
    if (sourceId === null) {
      setRefError("출처 번호(숫자 또는 src:N)를 적으세요");
      return;
    }
    setRefError(undefined);
    const r = await adminApi("POST", "/api/admin/source-review", { op: "refetch", sourceId, ...(text.trim() ? { text } : {}) });
    if (r.status === 200) {
      const res = r.body.result as { opened: number; unchanged: number; alreadyQueued: number; noSnapshot: number; targets: number };
      setDone(`같은 원문을 쓴 공식 자료 ${res.targets}건 — 새 검수 항목 ${res.opened}건 · 해시 같음 ${res.unchanged}건 · 이미 검수 중 ${res.alreadyQueued}건 · 스냅샷 없음 ${res.noSnapshot}건`);
      router.refresh();
    } else setError({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }

  return (
    <form onSubmit={submit} aria-label="원문 다시 받기" data-form="source-refetch" className="space-y-3">
      <TextField
        id="sr-source"
        label="출처 번호"
        hint="기사 편집 화면 출처 목록의 src:N — 공식 자료(공식 문서·데이터)만"
        value={ref}
        onChange={(e) => setRef(e.target.value)}
        error={refError}
        required
      />
      <TextAreaField
        id="sr-text"
        label="붙여 넣은 원문 (선택)"
        hint="비우면 출처의 원문 주소에서 서버가 한 번 받습니다. 기관 사이트가 내려받기를 막으면 원문을 여기에 붙여 넣으세요"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
      />
      {error && <ErrorSummary id="sr-refetch-error" title={error.title} messages={error.details} />}
      {done && <StatusNote>{done}</StatusNote>}
      <DarkButton type="submit" disabled={!hydrated}>
        원문 다시 받기
      </DarkButton>
    </form>
  );
}

export function ResolveForm({ id, reason }: { id: number; reason: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [note, setNote] = useState("");
  const [reverify, setReverify] = useState(reason === "expired");
  const [error, setError] = useState<Problem>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const r = await adminApi("POST", "/api/admin/source-review", { op: "resolve", id, note: note.trim() || null, reverify: reason === "expired" && reverify });
    if (r.status === 200) router.refresh();
    else setError({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }

  return (
    <form onSubmit={submit} aria-label={`검수 항목 ${id} 해결`} data-form="source-resolve" data-queue-id={id} className="mt-3 space-y-3">
      <TextField id={`sr-note-${id}`} label="처리 메모 (선택)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      {reason === "expired" && (
        <CheckboxField id={`sr-reverify-${id}`} label="원문을 다시 확인했습니다 — 확인일을 오늘로 다시 적기" checked={reverify} onChange={(e) => setReverify(e.target.checked)} />
      )}
      {error && <ErrorSummary id={`sr-resolve-error-${id}`} title={error.title} messages={error.details} />}
      <DarkButton type="submit" disabled={!hydrated}>
        해결
      </DarkButton>
    </form>
  );
}
