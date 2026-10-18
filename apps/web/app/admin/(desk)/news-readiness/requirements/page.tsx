import type { Metadata } from "next";
import Link from "next/link";
import { Callout } from "@ltr/ui";
import { RequirementConfirm } from "@/components/admin/RequirementConfirm";
import { RequirementForm } from "@/components/admin/RequirementForm";
import { EmptyNote, MONO, OUTLINE_BUTTON, PageTitle, Panel, ToneChip } from "@/components/admin/ui";
import { can } from "@/lib/access";
import { isoToKstDateTime } from "@/lib/admin/form-utils";
import { READINESS_PATH, criterionText, filterText, METRIC_LABELS } from "@/lib/admin/readiness-view";
import { emptyRequirementForm, formFromRow } from "@/lib/admin/requirement-form";
import { PLATFORM_LABELS, PLATFORMS, confirmProblems, readStoredItems, readStoredReviewPeriod, type RequirementRow } from "@/lib/readiness/requirements";
import { WINDOW_BASIS_LABELS } from "@/lib/readiness/windows";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { kstDate } from "@/lib/server/articles/gate";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { actorNames, listRequirementRows } from "@/lib/server/readiness/requirements";

// 제휴 규정 버전 (/admin/news-readiness/requirements — NAV-13, docs/dev/W2-c_설계.md 8.5) — 편집 책임자·관리자.
// 새 버전은 작성 중으로 저장하고, 원문 URL·확인일·등록 유형·적용 시작일·심사 대상 기간·요건을 채운 뒤 담당자가 확정한다.
// 확정된 버전은 고칠 수 없다 — '이 버전을 바탕으로 새 버전 적기'로 새 버전을 만들면 앞 버전은 기록으로 남는다. 모든 변경은 감사 로그.
export const metadata: Metadata = { title: "제휴 규정 버전" };

function VersionCard({ row, names, canEdit, today }: { row: RequirementRow; names: Map<string, string>; canEdit: boolean; today: string }) {
  const items = readStoredItems(row.requirements);
  const period = readStoredReviewPeriod(row.review_period);
  const confirmed = row.status === "confirmed";
  const label = `${PLATFORM_LABELS[row.platform as keyof typeof PLATFORM_LABELS] ?? row.platform} ${row.version}번`;
  return (
    <li data-requirement={row.id} data-version={row.version} data-status={row.status} className="rounded-2xl border border-navy-100 bg-white p-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[19px] font-black text-navy-900 [overflow-wrap:anywhere]">
          {label} 「{row.title}」
        </span>
        <ToneChip tone={confirmed ? "emerald" : "amber"}>
          <span data-cell="status">{confirmed ? "확정" : "작성 중"}</span>
        </ToneChip>
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-[15px] text-navy-800 sm:grid-cols-[9rem_minmax(0,1fr)]">
        <dt className="font-bold text-navy-600">원문 주소</dt>
        <dd className="min-w-0 [overflow-wrap:anywhere]">{row.source_url ?? "없음"}</dd>
        <dt className="font-bold text-navy-600">원문 보관 위치</dt>
        <dd className="min-w-0 [overflow-wrap:anywhere]">{row.source_text_ref ?? "없음"}</dd>
        <dt className="font-bold text-navy-600">확인일</dt>
        <dd className={MONO}>{row.checked_at ?? "없음"}</dd>
        <dt className="font-bold text-navy-600">매체 등록 유형</dt>
        <dd>{row.media_type ?? "없음"}</dd>
        <dt className="font-bold text-navy-600">적용 기간</dt>
        <dd className={MONO}>
          {row.effective_from ?? "시작일 없음"} ~ {row.effective_to ?? "끝날 없음"}
        </dd>
        <dt className="font-bold text-navy-600">심사 대상 기간</dt>
        <dd>{period ? `${period.text} — ${period.months}개월, ${WINDOW_BASIS_LABELS[period.basis]}` : "없음"}</dd>
        {row.supersedes_id !== null && (
          <>
            <dt className="font-bold text-navy-600">이어받은 버전</dt>
            <dd className={MONO}>id {row.supersedes_id}</dd>
          </>
        )}
        <dt className="font-bold text-navy-600">작성</dt>
        <dd>
          {names.get(row.created_by) ?? row.created_by} · <span className={MONO}>{isoToKstDateTime(row.created_at)}</span>
        </dd>
        <dt className="font-bold text-navy-600">확정</dt>
        <dd data-cell="approved">
          {confirmed ? (
            <>
              {names.get(row.approved_by ?? "") ?? row.approved_by} · <span className={MONO}>{isoToKstDateTime(row.approved_at)}</span>
            </>
          ) : (
            "아직"
          )}
        </dd>
        {row.note && (
          <>
            <dt className="font-bold text-navy-600">메모</dt>
            <dd className="[overflow-wrap:anywhere]">{row.note}</dd>
          </>
        )}
      </dl>
      <div className="mt-4 space-y-2">
        <p className="text-[15px] font-bold text-navy-900">요건 {items ? `${items.length}개` : "(모양이 틀립니다 — 새 버전으로 다시 적으세요)"}</p>
        {items && items.length > 0 && (
          <ul className="space-y-2">
            {items.map((i) => (
              <li key={i.key} data-item={i.key} className="rounded-xl border border-navy-100 bg-ivory px-4 py-3 text-[14px] text-navy-800">
                <p className="font-bold text-navy-900">
                  {i.label} <span className={MONO}>({i.key})</span> · {METRIC_LABELS[i.metric]} · <span data-cell="criterion">{criterionText(i)}</span>
                </p>
                <p>분자 {i.numeratorText} — {filterText(i.numerator)}</p>
                {i.denominatorText && <p>분모 {i.denominatorText}{i.denominator ? ` — ${filterText(i.denominator)}` : ""}</p>}
                <p>제외 {i.exclusionsText}</p>
                {i.sourceRef && <p>원문 조항 {i.sourceRef}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {canEdit && !confirmed && (
        <>
          <details className="mt-3">
            <summary className="min-h-11 cursor-pointer text-[15px] font-bold text-navy-800">고치기</summary>
            <RequirementForm mode="patch" base={`req-${row.id}`} initial={formFromRow(row)} id={row.id} label={`${label} 고치기`} />
          </details>
          <details className="mt-3">
            <summary className="min-h-11 cursor-pointer text-[15px] font-bold text-navy-800">확정하기 (담당자 승인)</summary>
            <RequirementConfirm id={row.id} missing={confirmProblems(row, { attested: true }, today)} label={`${label} 확정`} />
          </details>
        </>
      )}
      {canEdit && confirmed && (
        <details className="mt-3">
          <summary className="min-h-11 cursor-pointer text-[15px] font-bold text-navy-800">이 버전을 바탕으로 새 버전 적기</summary>
          <RequirementForm mode="create" base={`req-next-${row.id}`} initial={formFromRow(row)} supersedesId={row.id} label={`${label}을 바탕으로 새 버전`} />
        </details>
      )}
    </li>
  );
}

export default async function RequirementsPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "readiness.read");
  const canEdit = can(viewer, "readiness.requirements");
  const db = serviceDb();
  const today = kstDate(nowIso());
  const rows = await listRequirementRows(db);
  const names = await actorNames(db, rows.flatMap((r) => [r.created_by, r.approved_by]));

  return (
    <>
      <PageTitle
        title="제휴 규정 버전"
        description="네이버·카카오 뉴스 제휴의 공식 규정 원문을 버전으로 적습니다. 확정된 버전이 있어야 대시보드가 공식 정의 숫자와 기준 비교를 보입니다 (NAV-13)."
      >
        <Link href={READINESS_PATH} className={OUTLINE_BUTTON}>
          대시보드로
        </Link>
      </PageTitle>
      <Callout className="mb-6">
        규정의 숫자(기사 수·비율·합격선)는 원문을 확인한 담당자가 요건마다 적습니다. 화면이 미리 채우는 숫자는 없습니다. 확정된 버전은 고칠 수 없고, 바뀐 규정은 새 버전으로 적습니다.
      </Callout>
      {canEdit && (
        <Panel id="requirement-new" title="새 규정 버전" className="mb-8">
          <details>
            <summary className="min-h-11 cursor-pointer text-[15px] font-bold text-navy-800">새 버전 적기</summary>
            <RequirementForm mode="create" base="req-new" initial={emptyRequirementForm()} label="새 규정 버전" />
          </details>
        </Panel>
      )}
      <div className="space-y-8">
        {PLATFORMS.map((p) => {
          const mine = rows.filter((r) => r.platform === p).sort((a, b) => b.version - a.version);
          return (
            <section key={p} data-platform={p} aria-labelledby={`req-platform-${p}`} className="space-y-3">
              <h2 id={`req-platform-${p}`} className="text-[23px] font-black text-navy-900">
                {PLATFORM_LABELS[p]} — 버전 기록 {mine.length}개
              </h2>
              {mine.length === 0 ? <EmptyNote>적은 버전이 없습니다.</EmptyNote> : (
                <ul className="space-y-4">
                  {mine.map((r) => (
                    <VersionCard key={r.id} row={r} names={names} canEdit={canEdit} today={today} />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
