"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DarkButton, TextField } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { ErrorSummary, StatusNote } from "./fields";
import { useHydrated } from "./useHydrated";

// 바깥 연결 한 줄 편집 (W3 1·2단계) — 주소(비우면 화면에서 숨김)·이름·이용 조건 문구·사용 여부, 수동 점검 기록.
// 주소·문구는 사람이 입력한다(기본값 0). 값 검사는 서버(lib/links/rules.ts).

export interface LinkRowView {
  id: number;
  label: string;
  url: string | null;
  termsNote: string | null;
  active: boolean;
}

export function LinkForm({ link }: { link: LinkRowView }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [label, setLabel] = useState(link.label);
  const [url, setUrl] = useState(link.url ?? "");
  const [note, setNote] = useState(link.termsNote ?? "");
  const [active, setActive] = useState(link.active);
  const [error, setError] = useState<{ title: string; details: string[] } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function send(body: Record<string, unknown>, okText: string) {
    setError(null);
    setDone(null);
    const r = await adminApi("POST", "/api/admin/official-links", body);
    if (r.status === 200) {
      setDone(okText);
      router.refresh();
    } else setError({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }
  const save = (e: FormEvent) => {
    e.preventDefault();
    void send({ op: "update", id: link.id, label, url, termsNote: note, active }, "저장했습니다.");
  };

  return (
    <form onSubmit={save} data-form="official-link" data-link-id={link.id} className="space-y-3" aria-label={`${link.label} 편집`}>
      <TextField id={`lk-label-${link.id}`} label="이름" value={label} onChange={(e) => setLabel(e.target.value)} required />
      <TextField id={`lk-url-${link.id}`} label="주소 (비우면 화면에서 숨김)" value={url} onChange={(e) => setUrl(e.target.value)} />
      <TextField id={`lk-note-${link.id}`} label="이용 조건 문구" value={note} onChange={(e) => setNote(e.target.value)} />
      <label className="flex items-center gap-2 text-[15px] text-navy-800">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        사용
      </label>
      {error && <ErrorSummary id={`lk-error-${link.id}`} title={error.title} messages={error.details} />}
      {done && <StatusNote>{done}</StatusNote>}
      <div className="flex flex-wrap gap-2">
        <DarkButton type="submit" disabled={!hydrated}>
          저장
        </DarkButton>
        <button type="button" disabled={!hydrated || !link.url} data-action="manual-ok" className="rounded-lg border border-navy-200 px-4 py-2 text-[15px] font-bold" onClick={() => void send({ op: "manual_check", id: link.id, result: "ok" }, "정상으로 기록했습니다.")}>
          수동 점검: 정상
        </button>
        <button type="button" disabled={!hydrated || !link.url} data-action="manual-broken" className="rounded-lg border border-navy-200 px-4 py-2 text-[15px] font-bold" onClick={() => void send({ op: "manual_check", id: link.id, result: "broken" }, "끊김으로 기록했습니다.")}>
          수동 점검: 끊김
        </button>
      </div>
    </form>
  );
}
