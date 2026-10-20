"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DarkButton, TextField } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { ErrorSummary, StatusNote, TextAreaField } from "./fields";
import { useHydrated } from "./useHydrated";

// 개정 트래커 입력 (W3 3·4단계) — 개정안 만들기 · 단계 기록/정정 · 기사 연결/해제. 값 검사는 서버(lib/admin/amendment-rules.ts)가 한다.
// 문구·날짜·원문은 사람이 입력한다(번호·주소를 채워 넣는 기본값 0).

const STAGES: [string, string][] = [
  ["announced", "발표"],
  ["pre_notice", "입법예고"],
  ["submitted", "국회 제출"],
  ["passed", "의결"],
  ["promulgated", "공포"],
  ["effective", "시행"],
];

function useSubmit(body: () => Record<string, unknown>, okText: string) {
  const router = useRouter();
  const [error, setError] = useState<{ title: string; details: string[] } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);
    setPending(true);
    const r = await adminApi("POST", "/api/admin/amendments", body());
    setPending(false);
    if (r.status === 200 || r.status === 201) {
      setDone(okText);
      router.refresh();
    } else setError({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }
  return { submit, error, done, pending };
}

const Msg = ({ id, s }: { id: string; s: ReturnType<typeof useSubmit> }) => (
  <>
    {s.error && <ErrorSummary id={`${id}-error`} title={s.error.title} messages={s.error.details} />}
    {s.done && <StatusNote>{s.done}</StatusNote>}
  </>
);

function CreateForm() {
  const hydrated = useHydrated();
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [laws, setLaws] = useState("");
  const s = useSubmit(() => ({ op: "create", slug, title, lawNames: laws.split(",").map((x) => x.trim()).filter(Boolean) }), "개정안을 만들었습니다 — 공개 전 초안입니다.");
  return (
    <form onSubmit={s.submit} data-form="amendment-create" className="space-y-3" aria-label="개정안 만들기">
      <TextField id="am-slug" label="주소(slug)" value={slug} onChange={(e) => setSlug(e.target.value)} required />
      <TextField id="am-title" label="제목" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <TextField id="am-laws" label="법령 이름(쉼표로 구분)" value={laws} onChange={(e) => setLaws(e.target.value)} />
      <Msg id="am-create" s={s} />
      <DarkButton type="submit" disabled={!hydrated || s.pending}>
        개정안 만들기
      </DarkButton>
    </form>
  );
}

function EventForm({ amendments }: { amendments: { id: number; title: string }[] }) {
  const hydrated = useHydrated();
  const [amendmentId, setAmendmentId] = useState("");
  const [stage, setStage] = useState("announced");
  const [skipped, setSkipped] = useState(false);
  const [skipReason, setSkipReason] = useState("");
  const [occurredOn, setOccurredOn] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [payload, setPayload] = useState("");
  const [correctionOf, setCorrectionOf] = useState("");
  const [reason, setReason] = useState("");
  const s = useSubmit(
    () => ({
      op: correctionOf.trim() === "" ? "event" : "correct",
      amendmentId,
      stage,
      skipped,
      skipReason,
      occurredOn,
      sourceUrl,
      snapshotPayload: payload,
      ...(correctionOf.trim() === "" ? {} : { correctionOf, reason }),
    }),
    "단계를 기록했습니다.",
  );
  return (
    <form onSubmit={s.submit} data-form="amendment-event" className="space-y-3" aria-label="단계 기록·정정">
      <label className="block text-[15px] font-bold text-navy-800" htmlFor="ev-amendment">
        개정안
        <select id="ev-amendment" className="mt-1 block min-h-11 w-full rounded-xl border border-navy-200 px-3" value={amendmentId} onChange={(e) => setAmendmentId(e.target.value)} required>
          <option value="">고르세요</option>
          {amendments.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-[15px] font-bold text-navy-800" htmlFor="ev-stage">
        단계
        <select id="ev-stage" className="mt-1 block min-h-11 w-full rounded-xl border border-navy-200 px-3" value={stage} onChange={(e) => setStage(e.target.value)}>
          {STAGES.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-h-11 items-center gap-2 text-[15px] text-navy-800">
        <input type="checkbox" checked={skipped} onChange={(e) => setSkipped(e.target.checked)} /> 해당 없음(건너뛴 단계)
      </label>
      {skipped ? (
        <TextField id="ev-skip" label="해당 없음 사유" value={skipReason} onChange={(e) => setSkipReason(e.target.value)} required />
      ) : (
        <>
          <TextField id="ev-date" label="단계 날짜(YYYY-MM-DD)" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} required />
          <TextField id="ev-url" label="원문 주소" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} required />
          <TextAreaField id="ev-payload" label="원본 스냅샷(원문 글자 붙여 넣기)" value={payload} onChange={(e) => setPayload(e.target.value)} required />
        </>
      )}
      <TextField id="ev-correct" label="정정할 기록 번호(정정일 때만)" value={correctionOf} onChange={(e) => setCorrectionOf(e.target.value)} />
      {correctionOf.trim() !== "" && <TextField id="ev-reason" label="정정 사유" value={reason} onChange={(e) => setReason(e.target.value)} required />}
      <Msg id="am-event" s={s} />
      <DarkButton type="submit" disabled={!hydrated || s.pending}>
        {correctionOf.trim() === "" ? "단계 기록" : "정정 기록"}
      </DarkButton>
    </form>
  );
}

function LinkForm({ amendments }: { amendments: { id: number; title: string }[] }) {
  const hydrated = useHydrated();
  const [articleId, setArticleId] = useState("");
  const [amendmentId, setAmendmentId] = useState("");
  const [unlink, setUnlink] = useState(false);
  const s = useSubmit(() => ({ op: unlink ? "unlink" : "link", articleId, amendmentId }), unlink ? "연결을 해제했습니다." : "기사를 연결했습니다.");
  return (
    <form onSubmit={s.submit} data-form="amendment-link" className="space-y-3" aria-label="기사 연결">
      <TextField id="lk-article" label="기사 번호" value={articleId} onChange={(e) => setArticleId(e.target.value)} required />
      <label className="block text-[15px] font-bold text-navy-800" htmlFor="lk-amendment">
        개정안
        <select id="lk-amendment" className="mt-1 block min-h-11 w-full rounded-xl border border-navy-200 px-3" value={amendmentId} onChange={(e) => setAmendmentId(e.target.value)} required>
          <option value="">고르세요</option>
          {amendments.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-h-11 items-center gap-2 text-[15px] text-navy-800">
        <input type="checkbox" checked={unlink} onChange={(e) => setUnlink(e.target.checked)} /> 연결 해제
      </label>
      <Msg id="am-link" s={s} />
      <DarkButton type="submit" disabled={!hydrated || s.pending}>
        {unlink ? "연결 해제" : "연결"}
      </DarkButton>
    </form>
  );
}

export function AmendmentForms({ amendments }: { amendments: { id: number; title: string }[] }) {
  return (
    <div className="grid gap-8 lg:grid-cols-3">
      <CreateForm />
      <EventForm amendments={amendments} />
      <LinkForm amendments={amendments} />
    </div>
  );
}
