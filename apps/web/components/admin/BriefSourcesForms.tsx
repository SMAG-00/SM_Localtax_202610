"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DarkButton } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { ErrorSummary } from "./fields";

// 브리핑 원천 표 입력 (W10-e SM 이식) - 달력·진행 중 개정안 추가, 켜기·끄기. 판정은 서버가 하고 화면은 요청만 보낸다.
type Problem = { title: string; details: string[] } | null;
const input = "mt-1 block min-h-11 w-full rounded-xl border border-navy-200 bg-white px-3 text-[16px] text-navy-900";

async function post(body: Record<string, unknown>, onDone: () => void, setError: (p: Problem) => void) {
  setError(null);
  const r = await adminApi("POST", "/api/admin/brief/sources", body);
  if (r.status >= 200 && r.status < 300) onDone();
  else setError({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
}

export function ActiveToggle({ op, id, keyName, active, label }: { op: "calendar_active" | "ongoing_active" | "target_enabled"; id?: number; keyName?: string; active: boolean; label: string }) {
  const router = useRouter();
  const [error, setError] = useState<Problem>(null);
  return (
    <span>
      <button
        type="button"
        aria-pressed={active}
        aria-label={`${label} ${active ? "끄기" : "켜기"}`}
        onClick={() => post({ op, id, key: keyName, active: !active }, () => router.refresh(), setError)}
        className="min-h-11 rounded-xl border border-navy-200 bg-white px-3 text-[14px] font-bold text-navy-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400"
      >
        {active ? "켜짐 - 끄기" : "꺼짐 - 켜기"}
      </button>
      {error && <ErrorSummary title={error.title} messages={error.details} />}
    </span>
  );
}

export function CalendarForm() {
  const router = useRouter();
  const [mode, setMode] = useState("once");
  const [error, setError] = useState<Problem>(null);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "");
    void post({ op: "calendar_save", mode, text: get("text"), startMd: get("startMd"), endMd: get("endMd"), startOn: get("startOn"), endOn: get("endOn") }, () => router.refresh(), setError);
  }
  return (
    <form onSubmit={submit} className="mt-3 space-y-3" data-testid="brief-calendar-form">
      <label className="block text-[14px] font-bold text-navy-900">
        방식
        <select value={mode} onChange={(e) => setMode(e.target.value)} className={input}>
          <option value="once">한 번만 (날짜)</option>
          <option value="yearly">매년 반복 (월-일)</option>
          <option value="always">상시 안내</option>
        </select>
      </label>
      <label className="block text-[14px] font-bold text-navy-900">
        안내 글 (날짜는 아래 칸에 적고 글에는 쓰지 않습니다)
        <input name="text" required maxLength={300} className={input} />
      </label>
      {mode === "yearly" && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-[14px] font-bold text-navy-900">시작 (MM-DD)<input name="startMd" required placeholder="07-16" className={input} /></label>
          <label className="block text-[14px] font-bold text-navy-900">끝 (MM-DD, 선택)<input name="endMd" placeholder="07-31" className={input} /></label>
        </div>
      )}
      {mode === "once" && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-[14px] font-bold text-navy-900">시작일<input name="startOn" type="date" required className={input} /></label>
          <label className="block text-[14px] font-bold text-navy-900">끝일 (선택)<input name="endOn" type="date" className={input} /></label>
        </div>
      )}
      <DarkButton type="submit">날짜 추가</DarkButton>
      {error && <ErrorSummary title={error.title} messages={error.details} />}
    </form>
  );
}

export function OngoingForm() {
  const router = useRouter();
  const [error, setError] = useState<Problem>(null);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "");
    void post({ op: "ongoing_save", name: get("name"), stage: get("stage"), asOf: get("asOf"), source: get("source"), sourceUrl: get("sourceUrl"), points: get("points") }, () => router.refresh(), setError);
  }
  return (
    <form onSubmit={submit} className="mt-3 space-y-3" data-testid="brief-ongoing-form">
      <label className="block text-[14px] font-bold text-navy-900">개정안 이름<input name="name" required maxLength={200} className={input} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-[14px] font-bold text-navy-900">진행 단계 (입법예고·정부안·국회 심의·공포·시행)<input name="stage" required maxLength={100} className={input} /></label>
        <label className="block text-[14px] font-bold text-navy-900">기준일<input name="asOf" type="date" required className={input} /></label>
      </div>
      <label className="block text-[14px] font-bold text-navy-900">출처 이름 (선택)<input name="source" maxLength={200} className={input} /></label>
      <label className="block text-[14px] font-bold text-navy-900">출처 주소 (선택, https)<input name="sourceUrl" type="url" className={input} /></label>
      <label className="block text-[14px] font-bold text-navy-900">
        요점 (한 줄에 하나, 초안 작성 자료로만 쓰이고 호에는 직접 나가지 않습니다)
        <textarea name="points" rows={4} className="mt-1 block w-full rounded-xl border border-navy-200 p-3 text-[16px]" />
      </label>
      <DarkButton type="submit">개정안 추가</DarkButton>
      {error && <ErrorSummary title={error.title} messages={error.details} />}
    </form>
  );
}
