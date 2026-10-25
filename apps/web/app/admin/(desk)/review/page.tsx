import type { Metadata } from "next";
import { FieldDataControls } from "@/components/admin/FieldDataControls";
import { AmendmentApplyForm } from "@/components/admin/BriefControls";
import { ReviewItemControls } from "@/components/admin/ReviewControls";
import { fieldCandidateView } from "@/lib/field-data/review-ui";
import { EmptyNote, MONO, PageTitle, Panel, ToneChip } from "@/components/admin/ui";
import { isoToKstDate, isoToKstDateTime } from "@/lib/admin/form-utils";
import { CHECK_LABELS, KIND_LABELS, STALE_HOURS, STATUS_LABELS, hoursOpen, isStale, type ReviewKind, type ReviewStatus } from "@/lib/review/rules";
import { pageViewer, queryValue, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { getReviewDetail, listReviewItems, type ReviewRow } from "@/lib/server/review/service";

// 공통 검수 (/admin/review, PRD-02 REV-01~03 · W10-c) - 편집 책임자·관리자(review_item.decide).
//  · 원문(스냅샷 앞부분)과 후보(구조화 요약)를 나란히 보고, 체크리스트를 다 확인해야 [승인]이 열립니다. 반려는 사유 필수, 부분 승인 가능
//  · 상태 전이는 DB 함수가 판정합니다(허용 밖 전이 거부, 재시도 최대 3회). 72시간을 넘게 머문 항목은 경고 칩과 첫 줄 알림
//  · 승인은 검수 상태만 바꿉니다. 공개 자료 반영은 승인된 항목만 읽는 종류별 처리 단위가 합니다
export const metadata: Metadata = { title: "공통 검수" };
export const dynamic = "force-dynamic";

const TONE: Record<ReviewStatus, "navy" | "amber" | "emerald" | "rose"> = { drafted: "navy", in_review: "amber", approved: "emerald", published: "emerald", rejected: "rose", failed: "rose" };

function PayloadList({ payload }: { payload: Record<string, unknown> }) {
  const entries = Object.entries(payload).filter(([, v]) => v !== null && v !== undefined && typeof v !== "object");
  if (entries.length === 0) return <EmptyNote>후보 내용이 비어 있습니다.</EmptyNote>;
  return (
    <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[14px]">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-navy-600">{k}</dt>
          <dd className={`${MONO} break-all text-navy-900`}>{String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 분야 데이터 후보(W10-h) - 대상·원천 항목 번호·공공누리 유형과 후보 칸 전체(바뀐 칸 표시). 유형이 없으면 승인할 수 없다는 안내 */
function FieldCandidateList({ payload }: { payload: Record<string, unknown> }) {
  const v = fieldCandidateView(payload);
  if (!v) return <PayloadList payload={payload} />;
  return (
    <div data-testid="field-candidate">
      <p className="text-[14px] text-navy-900">
        <ToneChip tone="plain">{v.targetLabel}</ToneChip> <span className={MONO}>원천 항목 {v.sourceItemId}</span> · {v.koglLabel ?? "공공누리 유형 없음"}
      </p>
      {v.typeMissing && <p role="status" className="mt-1 text-[14px] font-bold text-rose-800">공공누리 유형이 없어 승인할 수 없습니다 (유형이 기록되어야 공개됩니다).</p>}
      {v.koglType === "kogl_4" && <p className="mt-1 text-[14px] text-navy-700">제4유형 - 원문 전재 금지. 본문이 있으면 [제4유형 검사]를 통과해야 공개 반영됩니다.</p>}
      <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[14px]">
        {v.rows.map((row) => (
          <div key={row.name} className="contents" data-changed={row.changed ? "true" : "false"}>
            <dt className="text-navy-600">{row.name}{row.changed ? " (바뀜)" : ""}</dt>
            <dd className={`${MONO} break-all text-navy-900`}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default async function ReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await pageViewer();
  requirePage(viewer, "review_item.decide");
  const sp = await searchParams;
  const kind = queryValue(sp.kind) || undefined;
  const db = serviceDb();
  const { open, done } = await listReviewItems(db, { kind: kind && kind in KIND_LABELS ? kind : undefined });
  const now = new Date();
  const stale = open.filter((r) => isStale(r.status as ReviewStatus, r.status_changed_at, now));
  const amendmentRows = open.some((r) => r.kind === "amendment_stage" && r.status === "approved") ? ((await db.from("amendments").select("id, title").order("id", { ascending: false }).limit(200)).data ?? []) as { id: number; title: string }[] : [];
  const detailOf = new Map<number, Awaited<ReturnType<typeof getReviewDetail>>>();
  for (const r of open.slice(0, 20)) detailOf.set(r.id, await getReviewDetail(db, r.id));

  const row = (r: ReviewRow) => {
    const detail = detailOf.get(r.id);
    const status = r.status as ReviewStatus;
    const old = isStale(status, r.status_changed_at, now);
    return (
      <li key={r.id} data-review-id={r.id} data-kind={r.kind} data-status={r.status} data-stale={old ? "true" : "false"} className="rounded-xl border border-navy-100 p-4">
        <p className="text-[15px] font-bold text-navy-900">
          <ToneChip tone={TONE[status]}>{STATUS_LABELS[status]}</ToneChip> <ToneChip tone="plain">{KIND_LABELS[r.kind as ReviewKind] ?? r.kind}</ToneChip> {r.title}
          {old && <ToneChip tone="rose" className="ml-2">{STALE_HOURS}시간 넘음</ToneChip>}
        </p>
        <p className={`${MONO} mt-1 text-navy-600`}>
          #{r.id} · {r.source_key} · 머문 {Math.floor(hoursOpen(r.status_changed_at, now))}시간 · 연 날 {isoToKstDateTime(r.created_at)}
          {r.assignee ? ` · 담당 ${r.assignee}` : " · 담당 없음"}
        </p>
        {r.last_error && <p className="mt-1 text-[14px] text-rose-800">오류 요약: {r.last_error}</p>}
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <section aria-label="원문" data-testid="review-original">
            <h3 className="text-[14px] font-bold text-navy-900">원문 (스냅샷 앞부분)</h3>
            {detail?.original ? (
              <>
                <p className={`${MONO} text-navy-600`}>해시 {detail.original.hash.slice(0, 12)} · 받은 날 {isoToKstDate(detail.original.fetchedAt)}</p>
                <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-navy-50 p-3 text-[13px] text-navy-900">{detail.original.excerpt}{detail.original.truncated ? "\n…(이하 생략)" : ""}</pre>
              </>
            ) : (
              <EmptyNote>연결된 원문 스냅샷이 없습니다.</EmptyNote>
            )}
          </section>
          <section aria-label="후보" data-testid="review-draft">
            <h3 className="text-[14px] font-bold text-navy-900">후보 (초안 요약)</h3>
            {r.kind === "field_data" ? <FieldCandidateList payload={r.payload} /> : <PayloadList payload={r.payload} />}
            {r.parts.length > 0 && <p className="mt-1 text-[14px] text-navy-700">부분 승인 단위: {r.parts.join(", ")}</p>}
          </section>
        </div>
        {r.status === "approved" || r.status === "published" ? (
          <p className="mt-2 text-[14px] text-navy-700">확인한 체크: {r.checked_keys.map((k) => CHECK_LABELS[k] ?? k).join(" · ")}</p>
        ) : null}
        <ReviewItemControls item={{ id: r.id, status, attempts: r.attempts, required_checks: r.required_checks, parts: r.parts, assignee: r.assignee }} />
        {r.kind === "field_data" && (() => {
          const fv = fieldCandidateView(r.payload);
          return fv ? <FieldDataControls id={r.id} status={r.status} koglType={fv.koglType} hasBody={fv.hasBody} /> : null;
        })()}
        {r.kind === "amendment_stage" && r.status === "approved" && amendmentRows.length > 0 && <AmendmentApplyForm itemId={r.id} amendments={amendmentRows} />}
      </li>
    );
  };

  return (
    <>
      <PageTitle title="공통 검수" description="수집기와 자동 감지가 올린 후보를 원문과 나란히 보고 처리합니다. 승인 전에는 공개 화면에 아무것도 반영되지 않습니다." />
      <div className="space-y-8">
        {stale.length > 0 && (
          <p role="status" data-testid="review-stale-alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-[15px] font-bold text-rose-800">
            {STALE_HOURS}시간을 넘게 머문 항목이 {stale.length}건 있습니다.
          </p>
        )}
        <Panel id="open-review" title={`열린 항목 ${open.length}건`}>
          {open.length === 0 ? <EmptyNote>열린 검수 항목이 없습니다.</EmptyNote> : <ul className="space-y-6" data-testid="review-open">{open.map(row)}</ul>}
        </Panel>
        <Panel id="done-review" title="최근 처리 20건">
          {done.length === 0 ? (
            <EmptyNote>처리한 항목이 없습니다.</EmptyNote>
          ) : (
            <ul className="space-y-2 text-[14px] text-navy-800" data-testid="review-done">
              {done.map((r) => (
                <li key={r.id} data-review-id={r.id}>
                  <span className={MONO}>{isoToKstDate(r.decided_at)}</span> {STATUS_LABELS[r.status as ReviewStatus]} · {KIND_LABELS[r.kind as ReviewKind] ?? r.kind} · {r.title}
                  {r.reject_reason ? <span className="text-navy-600">{` · 사유: ${r.reject_reason}`}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
