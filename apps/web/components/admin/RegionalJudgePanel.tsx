"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { EDITORIAL_JUDGEMENTS, EDITORIAL_JUDGEMENT_LABELS, type RegionalState } from "@ltr/editorial";
import { DarkButton, SelectField } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { optionsOf } from "@/lib/admin/labels";
import { ErrorSummary, StatusNote, TextAreaField } from "./fields";
import { useHydrated } from "./useHydrated";

const STATE_TEXT: Record<RegionalState, string> = {
  not_regional: "지역 기사 아님",
  candidate: "기사 후보",
  held: "보류(held) — 기사 후보가 아닙니다",
  separate_product: "별도 상품 검토 대상 — 검토 큐에 있는 동안 공개하지 않고, 보도기사·해설로는 발행하지 않습니다",
};

/**
 * 지역 기사 판정 줄 (REG1-17 — W4 7단계). 판정 상태(후보·보류·별도 상품)와 이유는 발행 판정과 같은 검사에서 나온다.
 * 편집자 판정(기사 후보·여행 후기·맛집 추천·행사 홍보)은 편집 책임자·관리자만 — POST /api/admin/regions op judge (광고·협찬 담당 403 + 감사)
 */
export function RegionalJudgePanel({
  articleId,
  regional,
  judgement,
  judgedAt,
  canJudge,
}: {
  articleId: number;
  regional: { state: RegionalState; reasons: string[] };
  judgement: string | null;
  judgedAt: string | null;
  canJudge: boolean;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [value, setValue] = useState(judgement ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<{ title: string; details: string[] } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);
    const r = await adminApi("POST", "/api/admin/regions", { op: "judge", articleId, judgement: value === "" ? null : value, ...(note.trim() ? { note: note.trim() } : {}) });
    if (r.status === 200) {
      setDone(value === "" ? "판정을 지웠습니다" : `판정했습니다 — ${EDITORIAL_JUDGEMENT_LABELS[value as keyof typeof EDITORIAL_JUDGEMENT_LABELS]}`);
      router.refresh();
      return;
    }
    setError({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }

  return (
    <div className="space-y-3" data-part="regional-judge" data-state={regional.state}>
      <p className="text-[15px] text-navy-900">
        <span className="font-bold">판정 상태: </span>
        <span data-part="regional-state">{STATE_TEXT[regional.state]}</span>
      </p>
      {regional.reasons.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-[14px] text-navy-700" data-part="regional-reasons">
          {regional.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {regional.state === "separate_product" && canJudge && (
        <p className="text-[14px] text-navy-700" data-part="separate-product-link">
          <a className="font-bold text-navy-900 underline underline-offset-4" href="/admin/regions#separate-product-open">
            별도 상품 검토 큐 보기
          </a>{" "}
          — 검토를 닫을 때 결정(광고·협찬 상품 전환·행사안내 등록·폐기)을 적습니다
        </p>
      )}
      <p className="text-[14px] text-navy-700" data-part="regional-judgement">
        편집자 판정: {judgement ? EDITORIAL_JUDGEMENT_LABELS[judgement as keyof typeof EDITORIAL_JUDGEMENT_LABELS] ?? judgement : "없음"}
        {judgedAt ? ` (${judgedAt.slice(0, 10)})` : ""}
      </p>
      {canJudge && (
        <form onSubmit={submit} noValidate className="space-y-3" aria-label="지역 기사 판정">
          <SelectField
            id="regional-judgement"
            label="편집자 판정"
            hint="여행 후기·맛집 추천·행사 홍보로 판정하면 별도 상품 검토 큐에 들어가 공개되지 않습니다 (REG1-14·17)"
            options={optionsOf(EDITORIAL_JUDGEMENT_LABELS, [...EDITORIAL_JUDGEMENTS])}
            placeholder="판정 없음"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <TextAreaField id="regional-judgement-note" label="판정 메모 (감사 기록에 남습니다)" value={note} onChange={(e) => setNote(e.target.value)} />
          {error && <ErrorSummary id="regional-judgement-error" title={error.title} messages={error.details} />}
          {done && <StatusNote>{done}</StatusNote>}
          <DarkButton type="submit" disabled={!hydrated}>
            판정 저장
          </DarkButton>
        </form>
      )}
    </div>
  );
}
