import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CorrectionForm, PublishForm, StageEventForm } from "@/components/admin/ProjectControls";
import { ConfirmLinkForm, CreateLinkForm, RemoveLinkForm, SuggestLinksButton } from "@/components/admin/RegionalLinkControls";
import { EmptyNote, MONO, PageTitle, Panel, TEXT_LINK, ToneChip } from "@/components/admin/ui";
import { LICENSE_TYPE_LABELS, type LicenseType } from "@ltr/editorial";
import { isoToKstDate, isoToKstDateTime } from "@/lib/admin/form-utils";
import { errorsByField } from "@/lib/admin/project-rules";
import { LINK_RELATION_LABELS, LINK_STATUS_LABELS, LINK_TYPE_LABELS } from "@/lib/admin/regional-link-rules";
import { pageId, pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { loadProject, loadProjectSettings, type EventView } from "@/lib/server/projects/board";
import { loadLinkBoard, type LinkView } from "@/lib/server/regional-links/board";

// 프로젝트 한 건 (/admin/projects/[id] — W4 14단계, PRD-01B PR-02 · PR-03 · PR-05 · REG1-10) — 편집 책임자·관리자(project.manage).
//  · 단계 기록(추가만) — 단계마다 고시 번호·고시일·고시 기관·원문 주소(새 창)·공공누리·원본 스냅샷 번호, 정정·정정됨·해당 없음·비공개·`검토 중`(원문 검수 큐) 표시
//  · 단계 기록하기(고시 6칸) · 정정(사유 + 한 번만 — 바꿔 적기·거두기) · 공개(공개 단계 1건 + 데이터 출처 + 정보 확인일) · 내리기
//  · 지역 연결 — 13단계와 같은 작업(같은 지역 후보 찾기·만들기·확인·지우기, 출발 = 이 프로젝트). 후보는 이 화면에만, 확인된 연결만 공개
// 가격·분양가·분담금·수익률·시세 입력 요소는 없다(PR-05). 원본 스냅샷 글자는 그리지 않는다(번호만 — 12장 #19).
export const metadata: Metadata = { title: "프로젝트" };
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = { draft: "초안", public: "공개", hidden: "내림" };
const KIND_LABELS: Record<string, string> = { stage: "단계 기록", not_applicable: "해당 없음", correction: "정정" };

function EventLine({ e }: { e: EventView }) {
  const withdrawn = e.kind === "correction" && e.stage === null;
  return (
    <li
      data-event-id={e.id}
      data-kind={e.kind}
      data-corrected={e.corrected_by === null ? "false" : "true"}
      className={`rounded-xl border border-navy-100 p-4 text-[15px] ${e.corrected_by === null ? "" : "text-navy-500"}`}
    >
      <p className="font-bold text-navy-900 [overflow-wrap:anywhere]">
        <span className={MONO}>기록 {e.id}</span> {KIND_LABELS[e.kind] ?? e.kind}
        {e.stage_label && ` · ${e.stage_label}`}
        {withdrawn && " · 거두기"}{" "}
        {!e.public && <ToneChip tone="navy">비공개 기록</ToneChip>} {e.under_review && <ToneChip tone="amber">검토 중</ToneChip>}{" "}
        {e.corrected_by !== null && <ToneChip tone="navy">기록 {e.corrected_by}로 정정됨</ToneChip>}
      </p>
      {e.notice_no && (
        <p className={`${MONO} mt-1 text-navy-700 [overflow-wrap:anywhere]`}>
          고시 {e.notice_no} · 고시일 {e.notice_date} · {e.issuer} · {e.license_type ? LICENSE_TYPE_LABELS[e.license_type as LicenseType] : "공공누리 없음"} · 스냅샷 #{e.snapshot_id}
        </p>
      )}
      {e.source_url && (
        <a className={`${TEXT_LINK} [overflow-wrap:anywhere]`} href={e.source_url} target="_blank" rel="noopener noreferrer">
          원문 보기 (새 창)
        </a>
      )}
      <p className={`${MONO} mt-1 text-navy-600 [overflow-wrap:anywhere]`}>
        {e.correction_of !== null && `기록 ${e.correction_of} 정정 · `}
        {e.reason && `사유 ${e.reason} · `}
        {e.note && `메모 ${e.note} · `}
        {isoToKstDateTime(e.recorded_at)} {e.recorded_by}
      </p>
    </li>
  );
}

function LinkLine({ link, projectId }: { link: LinkView; projectId: number }) {
  return (
    <li data-link-id={link.id} data-to={`${link.to_type}:${link.to_id}`} className="rounded-xl border border-navy-100 p-4">
      <p className="text-[15px] text-navy-900 [overflow-wrap:anywhere]">
        <ToneChip tone={link.status === "confirmed" ? "emerald" : "amber"}>{LINK_STATUS_LABELS[link.status]}</ToneChip> <ToneChip tone="navy">{LINK_RELATION_LABELS[link.relation]}</ToneChip>{" "}
        <span className="font-semibold">→ {LINK_TYPE_LABELS[link.to_type]}</span>{" "}
        {link.to.adminHref ? (
          <a className={TEXT_LINK} href={link.to.adminHref}>
            {link.to.title}
          </a>
        ) : (
          <span>{link.to.title}</span>
        )}{" "}
        <span className={`${MONO} text-navy-600`}>{link.to.note}</span>
      </p>
      <p className="mt-1 text-[14px]">{link.to_public ? "도착 공개" : "도착 비공개 — 확인할 수 없습니다(확인된 연결이면 공개 화면 링크 0)"}</p>
      {link.status === "candidate" && link.to_public && link.in_scope && <ConfirmLinkForm id={link.id} relation={link.relation} projectId={projectId} />}
      <RemoveLinkForm id={link.id} projectId={projectId} />
    </li>
  );
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await pageViewer();
  requirePage(viewer, "project.manage");
  const id = pageId((await params).id);
  const db = serviceDb();
  const settings = await loadProjectSettings(db);
  const detail = await loadProject(db, id, settings);
  if (!detail) notFound();
  const { project: p, stages, events, publishBlockers } = detail;
  const links = await loadLinkBoard(db, { type: "project", id: String(p.id) });
  const blockers = errorsByField(publishBlockers);
  const targets = events.filter((e) => e.corrected_by === null).map((e) => ({ id: e.id, label: `기록 ${e.id} · ${KIND_LABELS[e.kind]}${e.stage_label ? ` · ${e.stage_label}` : ""}` }));

  return (
    <>
      <PageTitle title={p.name} description={`${STATUS_LABELS[p.status] ?? p.status} · ${p.region_name ?? ""} ${p.region_code} · ${p.type_label} · 주소 ${p.slug}`}>
        <Link className={TEXT_LINK} href="/admin/projects">
          프로젝트 목록으로
        </Link>
      </PageTitle>
      <div className="space-y-8" data-testid="project-detail" data-project-id={p.id} data-status={p.status}>
        <Panel id="project-summary" title="현재 단계·데이터 출처">
          <p className="text-[15px] text-navy-900" data-part="current-stage">
            현재 단계: {p.current_stage_label ?? "공개 단계 기록 없음"}
          </p>
          <p className="mt-1 text-[15px] text-navy-800 [overflow-wrap:anywhere]">
            데이터 출처: {p.source_name ?? "없음"} · 정보 확인일: {p.last_verified_at ? isoToKstDate(p.last_verified_at) : "없음"}
          </p>
          {p.summary && <p className="mt-2 text-[15px] text-navy-800 [overflow-wrap:anywhere]">{p.summary}</p>}
        </Panel>

        <Panel id="project-events" title={`단계 기록 ${events.length}건`} description="기록은 추가만 됩니다. 잘못된 기록은 아래 정정으로 한 번만 고칩니다.">
          {events.length === 0 ? (
            <EmptyNote>단계 기록이 없습니다.</EmptyNote>
          ) : (
            <ol className="space-y-3" data-testid="project-events">
              {events.map((e) => (
                <EventLine key={e.id} e={e} />
              ))}
            </ol>
          )}
        </Panel>

        <Panel id="project-event-input" title="단계 기록하기" description="이 사업 유형의 단계 목록 안에서 고릅니다. 같은 단계를 두 번 적거나 앞 순서로 돌아가는 기록은 거부됩니다.">
          {stages.length === 0 ? <EmptyNote>이 사업 유형의 단계 목록이 없습니다 — 운영 설정 project_stage_lists를 확인하세요.</EmptyNote> : <StageEventForm projectId={p.id} stages={stages} />}
        </Panel>

        <Panel id="project-correct" title="정정" description="정정은 사유가 필수이고 한 기록에 한 번만 합니다. 정정을 다시 고치려면 정정 기록을 정정합니다.">
          {targets.length === 0 ? <EmptyNote>정정할 기록이 없습니다.</EmptyNote> : <CorrectionForm projectId={p.id} stages={stages} targets={targets} />}
        </Panel>

        <Panel id="project-publish" title="공개" description="공개 단계 기록 1건 이상 · 데이터 출처 · 정보 확인일이 있어야 공개합니다.">
          {publishBlockers.length > 0 && p.status !== "public" && (
            <ul className="mb-4 space-y-1 text-[15px] text-rose-700" data-testid="publish-blockers">
              {Object.entries(blockers).map(([field, messages]) => (
                <li key={field} data-field={field} className="[overflow-wrap:anywhere]">
                  {messages.join(" ")}
                </li>
              ))}
            </ul>
          )}
          <PublishForm projectId={p.id} status={p.status} sourceName={p.source_name} />
        </Panel>

        <Panel id="project-links" title="지역 연결" description="이 프로젝트에서 기사·공식 자료·지역 허브로 가는 연결입니다. 같은 지역 자동 후보는 이 화면에만 보이고, 이유를 적어 확인한 연결만 공개됩니다.">
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-4">
              <SuggestLinksButton fromType="project" fromId={String(p.id)} projectId={p.id} />
              <a className={TEXT_LINK} href={`/admin/regions/links?from=project:${p.id}`} data-testid="project-links-board">
                지역 연결 화면에서 보기
              </a>
            </div>
            {links.candidates.length + links.confirmed.length === 0 ? (
              <EmptyNote>연결이 없습니다.</EmptyNote>
            ) : (
              <ul className="space-y-4" data-testid="project-links">
                {[...links.candidates, ...links.confirmed].map((l) => (
                  <LinkLine key={l.id} link={l} projectId={p.id} />
                ))}
              </ul>
            )}
            <CreateLinkForm fromType="project" fromId={String(p.id)} projectId={p.id} />
          </div>
        </Panel>
      </div>
    </>
  );
}
