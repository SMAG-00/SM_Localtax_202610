"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DarkButton } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { ErrorSummary, StatusNote } from "./fields";

// 이번 주 재테크 포인트 백오피스 입력 (PR-15) - 세금 관점 한 줄은 사람이 직접 쓴다. 값 검사는 서버/DB.
const BOX = "min-h-11 w-full rounded-lg border border-navy-200 px-3 text-[15px]";

function useSend() {
  const router = useRouter();
  const [error, setError] = useState<{ title: string; details: string[] } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const send = async (body: Record<string, unknown>, okText: string) => {
    setError(null);
    setDone(null);
    const r = await adminApi("POST", "/api/admin/realestate-weekly", body);
    if (r.status === 200) {
      setDone(okText);
      router.refresh();
    } else setError({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  };
  return { error, done, send };
}

export function WeeklyIssueForm({ defaultWeek }: { defaultWeek: string }) {
  const { error, done, send } = useSend();
  const [week, setWeek] = useState(defaultWeek);
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void send({ op: "create_issue", week }, "호를 만들었습니다.");
      }}
      className="space-y-3"
      data-form="weekly-issue"
    >
      <label className="block text-[14px] font-bold">
        주 (yyyy-ww, 한국 시각 기준 월~일)
        <input className={BOX} value={week} onChange={(e) => setWeek(e.target.value)} />
      </label>
      <DarkButton type="submit">호 만들기</DarkButton>
      {error && <ErrorSummary title={error.title} messages={error.details} />}
      {done && <StatusNote>{done}</StatusNote>}
    </form>
  );
}

type Row = { articleId: string; taxItems: string; point: string };
const EMPTY: Row = { articleId: "", taxItems: "", point: "" };

export function WeeklyItemsForm({ issueId, status, initial, canPublish }: { issueId: number; status: string; initial: { articleId: number; taxItems: string[]; point: string }[]; canPublish: boolean }) {
  const { error, done, send } = useSend();
  const [rows, setRows] = useState<Row[]>(initial.length ? initial.map((i) => ({ articleId: String(i.articleId), taxItems: i.taxItems.join(", "), point: i.point })) : [{ ...EMPTY }, { ...EMPTY }, { ...EMPTY }]);
  const locked = status !== "draft" && status !== "approved";
  const patch = (i: number, p: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const items = () => rows.filter((r) => r.articleId.trim() || r.point.trim()).map((r) => ({ articleId: Number(r.articleId), taxItems: r.taxItems.split(",").map((t) => t.trim()).filter(Boolean), point: r.point }));
  return (
    <div className="space-y-3" data-part="weekly-items-form" data-issue-id={issueId}>
      {rows.map((r, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[110px_1fr_2fr]">
          <input className={BOX} placeholder="기사 번호" disabled={locked} value={r.articleId} onChange={(e) => patch(i, { articleId: e.target.value })} />
          <input className={BOX} placeholder="관련 세목 (쉼표로 구분)" disabled={locked} value={r.taxItems} onChange={(e) => patch(i, { taxItems: e.target.value })} />
          <input className={BOX} placeholder="세금 관점 한 줄 (60자 이하)" disabled={locked} value={r.point} onChange={(e) => patch(i, { point: e.target.value })} />
        </div>
      ))}
      {!locked && (
        <div className="flex flex-wrap gap-3">
          {rows.length < 7 && (
            <button type="button" className="min-h-11 px-2 text-[14px] font-bold underline" onClick={() => setRows([...rows, { ...EMPTY }])}>
              항목 더하기
            </button>
          )}
          <DarkButton type="button" onClick={() => void send({ op: "set_items", issueId, items: items() }, "항목을 저장했습니다.")}>
            항목 저장
          </DarkButton>
          {canPublish && (
            <DarkButton type="button" onClick={() => void send({ op: "publish", issueId }, "발행했습니다.")}>
              승인 발행
            </DarkButton>
          )}
        </div>
      )}
      {error && <ErrorSummary title={error.title} messages={error.details} />}
      {done && <StatusNote>{done}</StatusNote>}
    </div>
  );
}
