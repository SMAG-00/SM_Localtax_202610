"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DarkButton, TextField } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { errorsByField } from "@/lib/admin/project-rules";
import { LENS_LIMITS, LENS_LINK_KINDS, LENS_LINK_LABELS, LENS_STATUS_LABELS, lensFormValues, lensRequestBody, splitLensLines, type LensState, type StageLensRow } from "@/lib/admin/project-lens-rules";
import { ErrorSummary, StatusNote, TextAreaField } from "./fields";
import { useHydrated } from "./useHydrated";

// 단계별 「지방세로 읽기」 템플릿 폼 (W4 16단계 — PRD-01B PR-08 · CORE-01). 초안은 편집 책임자·관리자(project.manage), 서명은 세무 감수위원(review.tax_review).
// 값 검사는 서버(lib/admin/project-lens-rules.ts + DB 트리거)가 하고, 오류 "칸: 문장"은 그 칸 옆에 보인다. 4번째 포인트 줄은 화면이 먼저 알린다(서버도 422).
// 문구를 채워 넣는 기본값은 없다 — 편집국이 쓴다. 계산기 링크 칸은 없다(SM 취득세 카드가 박스 옆에 붙는다). 가격 입력 요소 0(PR-05).

type Failure = { title: string; details: string[]; fields: Record<string, string[]> } | null;

function useLensSubmit() {
  const router = useRouter();
  const [error, setError] = useState<Failure>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function send(body: Record<string, unknown>, ok: (b: Record<string, unknown>) => string) {
    setError(null);
    setDone(null);
    setPending(true);
    const r = await adminApi("POST", "/api/admin/project-lenses", body);
    setPending(false);
    if (r.status === 200 || r.status === 201) {
      setDone(ok((r.body ?? {}) as Record<string, unknown>));
      router.refresh();
    } else {
      const details = apiErrorDetails(r);
      setError({ title: apiErrorMessage(r), details, fields: errorsByField(details) });
    }
  }
  const fieldError = (...names: string[]) => names.flatMap((n) => error?.fields[n] ?? []).join(" ") || undefined;
  return { error, done, pending, send, fieldError };
}

const TONE: Record<LensState, string> = {
  none: "border-navy-200 bg-white text-navy-700",
  draft: "border-amber-300 bg-amber-50 text-amber-900",
  rereview_needed: "border-rose-300 bg-rose-50 text-rose-900",
  reviewed: "border-emerald-300 bg-emerald-50 text-emerald-900",
};

export function LensStateChip({ state }: { state: LensState }) {
  return (
    <span data-lens-state={state} className={`inline-flex rounded-md border px-2 py-0.5 text-[13px] font-bold ${TONE[state]}`}>
      {LENS_STATUS_LABELS[state]}
    </span>
  );
}

/** 저장된 문구 미리보기 — 공개 화면 박스와 같은 칸(세목·포인트·링크·기준일) */
function LensPreview({ row }: { row: StageLensRow }) {
  return (
    <div data-part="lens-preview" className="mt-3 rounded-xl border border-navy-100 p-4 text-[15px] text-navy-900">
      <p className="[overflow-wrap:anywhere]">세목: {row.lens.topics.join(" · ")}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5" data-list="lens-points">
        {row.lens.points.map((p, i) => (
          <li key={i} className="[overflow-wrap:anywhere]">
            {p}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[14px] text-navy-700 [overflow-wrap:anywhere]">
        링크: {row.lens.links.map((l) => `${LENS_LINK_LABELS[l.kind]} ${l.label} (${l.url})`).join(" · ")}
      </p>
      <p className="mt-1 font-mono text-[13px] tracking-wide text-navy-600 [overflow-wrap:anywhere]">
        기준일 {row.lens.base_date} · 초안 {row.drafted_by} {row.drafted_at}
        {row.reviewed_by && ` · 서명 ${row.reviewed_by} ${row.reviewed_at}`}
      </p>
    </div>
  );
}

/** 초안 폼 — 세목(한 줄에 하나) · 포인트(1~3줄) · 해설·도서·전문가 링크(이름·주소) · 법령 기준일 */
function LensDraftForm({ projectType, stage, row, prefix }: { projectType: string; stage: string; row: StageLensRow | null; prefix: string }) {
  const hydrated = useHydrated();
  const s = useLensSubmit();
  const [f, setF] = useState(() => lensFormValues(row));
  const pointCount = splitLensLines(f.points).length;
  const tooMany = pointCount > LENS_LIMITS.pointsMax;
  return (
    <form
      noValidate
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (tooMany) return;
        void s.send(lensRequestBody(projectType, stage, f), (b) => {
          const warnings = Array.isArray(b.warnings) ? (b.warnings as string[]) : [];
          const base = b.unchanged ? "바뀐 내용이 없습니다." : row?.reviewed_by ? "저장했습니다 — 감수 서명이 지워졌습니다(재감수 필요). 다시 서명될 때까지 공개 화면에 박스가 없습니다." : "초안을 저장했습니다 — 감수 서명 뒤 공개 화면에 보입니다.";
          return warnings.length ? `${base} ${warnings.map((w) => w.replace(/^[^:]+: /, "")).join(" ")}` : base;
        });
      }}
      aria-label={`${stage} 단계 「지방세로 읽기」 초안`}
      data-form="lens-draft"
      data-lens-stage={stage}
      className="mt-4 grid gap-4 sm:grid-cols-2"
    >
      <TextAreaField id={`${prefix}-topics`} label={`관련 세목 (한 줄에 하나, ${LENS_LIMITS.topics}개까지)`} rows={2} value={f.topics} onChange={(e) => setF({ ...f, topics: e.target.value })} error={s.fieldError("topics")} />
      <TextField id={`${prefix}-base-date`} label="법령 기준일 (YYYY-MM-DD)" value={f.base_date} onChange={(e) => setF({ ...f, base_date: e.target.value })} error={s.fieldError("base_date")} />
      <div className="sm:col-span-2">
        <TextAreaField
          id={`${prefix}-points`}
          label={`핵심 포인트 (한 줄에 하나, ${LENS_LIMITS.pointsMin}~${LENS_LIMITS.pointsMax}줄 — 세액·감면 단정 쓰지 않음)`}
          rows={3}
          value={f.points}
          onChange={(e) => setF({ ...f, points: e.target.value })}
          error={tooMany ? `핵심 포인트는 ${LENS_LIMITS.pointsMax}줄까지입니다 — ${pointCount}번째 줄은 저장하지 않습니다 (지금 ${pointCount}줄)` : s.fieldError("points")}
        />
      </div>
      <fieldset className="grid gap-4 sm:col-span-2 sm:grid-cols-2" data-part="lens-links">
        <legend className="mb-2 text-[15px] font-bold text-navy-900">링크 (1개 이상 — 사이트 안 주소, 계산기는 SM 취득세 카드가 따로 붙습니다)</legend>
        {LENS_LINK_KINDS.map((k) => (
          <div key={k} className="contents">
            <TextField
              id={`${prefix}-link-${k}-label`}
              label={`${LENS_LINK_LABELS[k]} 링크 이름`}
              value={f.links[k].label}
              onChange={(e) => setF({ ...f, links: { ...f.links, [k]: { ...f.links[k], label: e.target.value } } })}
            />
            <TextField
              id={`${prefix}-link-${k}-url`}
              label={`${LENS_LINK_LABELS[k]} 링크 주소 (/로 시작)`}
              value={f.links[k].url}
              onChange={(e) => setF({ ...f, links: { ...f.links, [k]: { ...f.links[k], url: e.target.value } } })}
            />
          </div>
        ))}
        {s.fieldError("links") && (
          <p id={`${prefix}-links-error`} className="text-[14px] text-rose-700 sm:col-span-2">
            {s.fieldError("links")}
          </p>
        )}
      </fieldset>
      <div className="space-y-3 sm:col-span-2">
        {s.done && <StatusNote>{s.done}</StatusNote>}
        {s.error && <ErrorSummary id={`${prefix}-error`} title={s.error.title} messages={s.error.details} />}
        <DarkButton type="submit" disabled={!hydrated || s.pending || tooMany}>
          {row ? "고쳐 저장 (서명 지움)" : "초안 저장"}
        </DarkButton>
      </div>
    </form>
  );
}

/** 세무 감수 서명 — 지금 보이는 초안 그대로일 때만(그 사이 고쳐졌으면 409) */
function LensReviewForm({ row, prefix }: { row: StageLensRow; prefix: string }) {
  const hydrated = useHydrated();
  const s = useLensSubmit();
  return (
    <form
      noValidate
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void s.send({ op: "review", project_type: row.project_type, stage: row.stage, drafted_at: row.drafted_at }, (b) => (b.unchanged ? "이미 서명되어 있습니다." : "서명했습니다 — 다음 렌더부터 이 유형의 모든 프로젝트 화면에 박스가 보입니다."));
      }}
      aria-label={`${row.stage} 단계 「지방세로 읽기」 서명`}
      data-form="lens-review"
      data-lens-stage={row.stage}
      className="mt-3 space-y-3"
    >
      {s.done && <StatusNote>{s.done}</StatusNote>}
      {s.error && <ErrorSummary id={`${prefix}-review-error`} title={s.error.title} messages={s.error.details} />}
      <DarkButton type="submit" disabled={!hydrated || s.pending}>
        위 문구에 세무 감수 서명
      </DarkButton>
    </form>
  );
}

/** 한 단계 — 상태 · 저장된 문구 · 초안 폼(편집) · 서명(감수) */
export function StageLensItem({
  projectType,
  stage,
  stageLabel,
  row,
  canEdit,
  canReview,
}: {
  projectType: string;
  stage: string;
  stageLabel: string;
  row: StageLensRow | null;
  canEdit: boolean;
  canReview: boolean;
}) {
  const state: LensState = row ? row.review_status : "none";
  const prefix = `lens-${projectType}-${stage}`;
  return (
    <li data-lens-type={projectType} data-lens-stage={stage} data-lens-status={state} className="rounded-xl border border-navy-100 p-4">
      <p className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-navy-900">
        <span className="[overflow-wrap:anywhere]">{stageLabel}</span> <LensStateChip state={state} />
      </p>
      {row ? <LensPreview row={row} /> : <p className="mt-2 text-[15px] text-navy-600">템플릿이 없습니다 — 공개 화면의 이 단계에는 박스가 없습니다.</p>}
      {canReview && row && row.review_status !== "reviewed" && <LensReviewForm key={`${row.drafted_at}`} row={row} prefix={prefix} />}
      {canEdit && <LensDraftForm key={`${row?.drafted_at ?? "new"}`} projectType={projectType} stage={stage} row={row} prefix={prefix} />}
    </li>
  );
}
