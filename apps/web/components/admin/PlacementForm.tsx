"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckboxField, DarkButton, TextField } from "@ltr/ui";
import { adminApi, apiErrorMessage } from "@/lib/admin/api-client";
import { blank, isoToKstDateTime } from "@/lib/admin/form-utils";
import { ErrorSummary, StatusNote } from "./fields";
import { useHydrated } from "./useHydrated";

/** 기사 배치 (편집 책임자 — 편집국 외 역할은 403) — HOT 고정 종료 시각, 뉴스 전송 후보(편집 승인된 보도기사만) */
export function PlacementForm({
  articleId,
  hotPinUntil,
  navCandidate,
  canHot,
  navAllowed,
}: {
  articleId: number;
  hotPinUntil: string | null;
  navCandidate: boolean;
  canHot: boolean;
  /** 편집 승인된 보도기사인가 (NAV-02) */
  navAllowed: boolean;
}) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [until, setUntil] = useState("");
  const [nav, setNav] = useState(navCandidate);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [pending, setPending] = useState(false);
  const base = `place-${articleId}`;

  async function send(body: Record<string, unknown>, message: string) {
    setPending(true);
    setError("");
    setDone("");
    const r = await adminApi("POST", `/api/admin/articles/${articleId}/placement`, body);
    setPending(false);
    if (r.status === 200) {
      setDone(message);
      router.refresh();
      return;
    }
    setError(apiErrorMessage(r));
  }

  function pin(e: FormEvent) {
    e.preventDefault();
    if (blank(until)) return setError("HOT 고정이 끝나는 시각을 골라 주세요");
    // datetime-local은 한국 시각으로 받는다
    void send({ hotPinUntil: `${until}:00+09:00` }, "HOT으로 고정했습니다");
  }

  return (
    <div className="space-y-3">
      {canHot && (
        <form onSubmit={pin} noValidate className="space-y-2" aria-label="HOT 고정">
          <p className="text-[15px] text-navy-800">지금 HOT 고정: {hotPinUntil ? `${isoToKstDateTime(hotPinUntil)}까지` : "없음"}</p>
          <TextField id={`${base}-hot`} label="HOT 고정 끝나는 시각" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <DarkButton type="submit" disabled={pending || !hydrated}>
              HOT 고정
            </DarkButton>
            {hotPinUntil && (
              <DarkButton type="button" disabled={pending || !hydrated} onClick={() => void send({ hotPinUntil: null }, "HOT 고정을 풀었습니다")}>
                HOT 해제
              </DarkButton>
            )}
          </div>
        </form>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send({ navCandidate: nav }, nav ? "뉴스 전송 후보로 지정했습니다" : "뉴스 전송 후보에서 뺐습니다");
        }}
        noValidate
        className="space-y-2"
        aria-label="뉴스 전송 후보"
      >
        <CheckboxField
          id={`${base}-nav`}
          label="뉴스 전송 후보"
          hint={navAllowed ? undefined : "편집 승인된 보도기사만 후보가 됩니다 (NAV-02)"}
          disabled={!navAllowed && !navCandidate}
          checked={nav}
          onChange={(e) => setNav(e.target.checked)}
        />
        <DarkButton type="submit" disabled={pending || !hydrated || (!navAllowed && !navCandidate)}>
          후보 저장
        </DarkButton>
      </form>
      {error && <ErrorSummary title={error} messages={[]} />}
      {done && <StatusNote>{done}</StatusNote>}
    </div>
  );
}
