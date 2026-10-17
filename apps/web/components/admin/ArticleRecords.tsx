// 기사 기록 보기 (서버에서 그린다) — 머리(상태·승인 상태 2개·버전·기자) · 검토 기록 · 수정 이력 · 정정 이력(전후 버전)
// NAV-03: 편집 승인과 세무 감수는 서로 다른 상태로 보인다. NAV-06: 정정·삭제·제목 변경은 이유와 전후 버전을 보인다.
import type { EditorView } from "@/lib/server/articles/editor-view";
import { changedBlocks } from "@/lib/admin/correction-form";
import { isoToKstDateTime } from "@/lib/admin/form-utils";
import {
  ARTICLE_STATUS_LABELS,
  CONTENT_TYPE_LABELS,
  CORRECTION_KIND_LABELS,
  EDITORIAL_STATUS_LABELS,
  REPORTING_METHOD_LABELS,
  REVIEW_DECISION_LABELS,
  REVIEW_KIND_LABELS,
  SECTION_LABELS,
  TAX_REVIEW_STATUS_LABELS,
  UPDATE_KIND_LABELS,
  labelOf,
} from "@/lib/admin/labels";
import { EmptyNote, MONO, Panel, ToneChip } from "./ui";

const STATUS_TONE: Record<string, "navy" | "emerald" | "amber" | "rose"> = { published: "emerald", approved: "emerald", held: "amber", deleted: "rose" };
const APPROVAL_TONE: Record<string, "navy" | "emerald" | "amber" | "rose"> = { approved: "emerald", rejected: "rose", held: "amber", pending: "amber" };

export function ArticleHeader({ view, authorName }: { view: EditorView; authorName: string | null }) {
  const a = view.article;
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center gap-2">
        <ToneChip tone={STATUS_TONE[a.status] ?? "navy"}>
          <span className="sr-only">게재 상태 </span>
          <span data-testid="article-status">{labelOf(ARTICLE_STATUS_LABELS, a.status)}</span>
        </ToneChip>
        <ToneChip tone={APPROVAL_TONE[a.editorialStatus] ?? "navy"}>편집 승인: {labelOf(EDITORIAL_STATUS_LABELS, a.editorialStatus)}</ToneChip>
        <ToneChip tone={APPROVAL_TONE[a.taxReviewStatus] ?? "navy"}>세무 감수: {labelOf(TAX_REVIEW_STATUS_LABELS, a.taxReviewStatus)}</ToneChip>
        <span className={`text-navy-600 ${MONO}`} data-testid="article-version">
          버전 {a.version}
        </span>
      </div>
      <h1 className="mt-2 text-[28px] leading-tight font-black tracking-tight text-navy-900 [overflow-wrap:anywhere]">{a.title}</h1>
      <p className="mt-1 text-[15px] text-navy-600 [overflow-wrap:anywhere]">
        {labelOf(SECTION_LABELS, a.section)} · {labelOf(CONTENT_TYPE_LABELS, a.contentType)}
        {a.reportingMethod && ` · ${labelOf(REPORTING_METHOD_LABELS, a.reportingMethod)}`} · 기자 {authorName ?? "없음"} · 주소 <span className={MONO}>{a.slug}</span>
        {a.firstPublishedAt && ` · 최초 발행 ${isoToKstDateTime(a.firstPublishedAt)}`}
      </p>
    </div>
  );
}

export function ReviewHistory({ view, names }: { view: EditorView; names: Record<number, string> }) {
  return (
    <Panel id="review-history" title="검토 기록" description="편집 승인과 세무 감수는 따로 기록됩니다. 승인은 그 버전에만 해당합니다.">
      {view.reviews.length === 0 ? (
        <EmptyNote>검토 기록이 없습니다.</EmptyNote>
      ) : (
        <ol data-testid="review-history" className="space-y-3">
          {[...view.reviews].reverse().map((r) => {
            const checks = typeof r.checklist === "object" && r.checklist !== null ? Object.entries(r.checklist as Record<string, unknown>).filter(([, v]) => v === true) : [];
            return (
              <li key={r.id} className="rounded-xl border border-navy-100 p-4 text-[15px] text-navy-800">
                <div className="flex flex-wrap items-center gap-2">
                  <ToneChip tone="plain">{labelOf(REVIEW_KIND_LABELS, r.kind)}</ToneChip>
                  <ToneChip tone={r.decision === "approve" ? "emerald" : r.decision === "reject" ? "rose" : "amber"}>{labelOf(REVIEW_DECISION_LABELS, r.decision)}</ToneChip>
                  <span className={MONO}>버전 {r.version}</span>
                  <span className={`text-navy-600 ${MONO}`}>{isoToKstDateTime(r.at)}</span>
                </div>
                <p className="mt-1">{names[r.reviewer_id] ?? `인물 ${r.reviewer_id}`}</p>
                {r.reason && <p className="text-[14px] text-navy-700 [overflow-wrap:anywhere]">사유: {r.reason}</p>}
                {checks.length > 0 && <p className="text-[14px] text-navy-600">확인 항목 {checks.length}개 체크</p>}
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

export function RevisionList({ view }: { view: EditorView }) {
  return (
    <Panel id="revisions" title="수정 이력">
      <ol className="space-y-2">
        {[...view.revisions].reverse().map((r) => (
          <li key={r.id} className="flex flex-wrap gap-x-3 text-[15px] text-navy-800">
            <span className={MONO}>버전 {r.version}</span>
            <span className={`text-navy-600 ${MONO}`}>{isoToKstDateTime(r.edited_at)}</span>
            {r.update_kind && <ToneChip tone="plain">{labelOf(UPDATE_KIND_LABELS, r.update_kind)}</ToneChip>}
            {r.reason && <span className="[overflow-wrap:anywhere]">{r.reason}</span>}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export function CorrectionsList({ view }: { view: EditorView }) {
  if (view.corrections.length === 0) return null;
  return (
    <Panel id="corrections" title={`정정 이력 ${view.corrections.length}건`} description="무엇을 왜 고쳤는지, 전후 버전과 함께 남습니다 (NAV-06).">
      <ol data-testid="correction-list" className="space-y-4">
        {view.corrections.map((c) => {
          const diff = c.before && c.after ? changedBlocks(c.before.body, c.after.body) : [];
          return (
            <li key={c.id} data-testid={`correction-${c.id}`} className="rounded-xl border border-navy-100 p-4 text-[15px] text-navy-800">
              <div className="flex flex-wrap items-center gap-2">
                <ToneChip tone="navy">{labelOf(CORRECTION_KIND_LABELS, c.kind)}</ToneChip>
                <span className={`text-navy-600 ${MONO}`}>{isoToKstDateTime(c.publishedAt ?? c.createdAt)}</span>
                <span className={MONO} data-testid="correction-versions">
                  {c.before ? `버전 ${c.before.version}` : "전 버전 없음"} → {c.after ? `버전 ${c.after.version}` : "새 버전 없음"}
                </span>
              </div>
              <p className="mt-1 [overflow-wrap:anywhere]">이유: {c.reason}</p>
              {c.readerNotice && c.readerNotice !== c.reason && <p className="text-[14px] text-navy-700 [overflow-wrap:anywhere]">독자 표시: {c.readerNotice}</p>}
              {c.before && c.after && c.before.title !== c.after.title && (
                <dl className="mt-2 text-[14px]">
                  <dt className="font-bold text-navy-600">제목 전</dt>
                  <dd className="[overflow-wrap:anywhere]">{c.before.title}</dd>
                  <dt className="font-bold text-navy-600">제목 후</dt>
                  <dd className="[overflow-wrap:anywhere]">{c.after.title}</dd>
                </dl>
              )}
              {diff.length > 0 && (
                <ul className="mt-2 space-y-2 text-[14px]">
                  {diff.map((d) => (
                    <li key={d.index} className="rounded-lg bg-ivory p-3">
                      <p className="font-bold text-navy-600">본문 {d.index + 1}번째 블록</p>
                      <p className="[overflow-wrap:anywhere]">
                        <span className="font-bold text-navy-600">전 </span>
                        <del>{d.before || "(없음)"}</del>
                      </p>
                      <p className="[overflow-wrap:anywhere]">
                        <span className="font-bold text-navy-600">후 </span>
                        <ins>{d.after || "(없음)"}</ins>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
