import type { Metadata } from "next";
import { CreateProjectForm } from "@/components/admin/ProjectControls";
import { EmptyNote, MONO, PageTitle, Panel, TEXT_LINK, ToneChip } from "@/components/admin/ui";
import { can } from "@/lib/access";
import { isoToKstDate } from "@/lib/admin/form-utils";
import { NO_PROJECT_TYPES } from "@/lib/admin/project-rules";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { listProjects, loadProjectSettings } from "@/lib/server/projects/board";

// 프로젝트 트래커 관리 (/admin/projects — W4 14단계, PRD-01B PR-02 · PR-03 · PR-05, docs/dev/W4_설계.md 1장 14단계 · 5장 · 6장) — 편집 책임자·관리자(project.manage).
//  · 목록 — 이름·주소·지역·사업 유형·현재 단계(정정되지 않은 공개 단계 기록 중 가장 늦은 순서)·기록 수·상태
//  · 만들기 — 사업 유형·단계 목록(운영 설정)이 비면 안내만 보이고 폼을 두지 않는다(12장 #10). 만들면 초안, 단계 기록·공개는 프로젝트 화면에서
// 가격·분양가·분담금·수익률·시세 입력 요소는 어디에도 없다(PR-05).
export const metadata: Metadata = { title: "프로젝트" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: "emerald" | "amber" | "navy" }> = {
  draft: { label: "초안", tone: "amber" },
  public: { label: "공개", tone: "emerald" },
  hidden: { label: "내림", tone: "navy" },
};

export default async function ProjectsPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "project.manage");
  const db = serviceDb();
  const settings = await loadProjectSettings(db);
  const projects = await listProjects(db, settings);

  return (
    <>
      <PageTitle
        title="프로젝트"
        description="지역 대표 개발 프로젝트를 표준 단계로 기록합니다. 단계 기록마다 고시 번호·고시일·고시 기관·원문 주소·원본 스냅샷·공공누리 유형이 있어야 하고, 잘못된 기록은 사유를 적은 정정으로 한 번만 고칩니다."
      />
      <div className="space-y-8">
        <Panel id="project-list" title={`프로젝트 ${projects.length}건`} description="최근 고친 순입니다. 이름을 누르면 단계 기록·정정·공개·지역 연결 화면으로 갑니다.">
          {projects.length === 0 ? (
            <EmptyNote>프로젝트가 없습니다.</EmptyNote>
          ) : (
            <ul className="space-y-4" data-testid="project-list">
              {projects.map((p) => (
                <li key={p.id} data-project-id={p.id} data-status={p.status} className="rounded-xl border border-navy-100 p-4 text-[15px]">
                  <p className="font-bold text-navy-900 [overflow-wrap:anywhere]">
                    <a className={TEXT_LINK} href={`/admin/projects/${p.id}`}>
                      {p.name}
                    </a>{" "}
                    <ToneChip tone={STATUS[p.status]?.tone ?? "navy"}>{STATUS[p.status]?.label ?? p.status}</ToneChip>
                    {p.landmark && (
                      <>
                        {" "}
                        <ToneChip tone="navy">지역 대표</ToneChip>
                      </>
                    )}
                  </p>
                  <p className={`${MONO} mt-1 text-navy-600 [overflow-wrap:anywhere]`}>
                    #{p.id} · {p.slug} · {p.region_name ?? "지역 이름 없음"} {p.region_code} · {p.type_label}
                  </p>
                  <p className="mt-1 text-navy-800" data-part="current-stage">
                    현재 단계: {p.current_stage_label ?? "공개 단계 기록 없음"} · 기록 {p.events}건
                    {p.last_verified_at && ` · 정보 확인일 ${isoToKstDate(p.last_verified_at)}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel id="project-create" title="프로젝트 만들기" description="초안으로 만듭니다. 공개는 단계 기록·데이터 출처·정보 확인일을 갖춘 뒤 프로젝트 화면에서 합니다.">
          {settings.usable.length === 0 ? (
            <div data-testid="project-types-empty" className="space-y-2 text-[15px] text-navy-800">
              <p className="font-bold text-navy-900 [overflow-wrap:anywhere]">{NO_PROJECT_TYPES}</p>
              {can(viewer, "settings.edit") && (
                <a className={TEXT_LINK} href="/admin/settings">
                  운영 설정으로
                </a>
              )}
            </div>
          ) : (
            <CreateProjectForm types={settings.usable} />
          )}
        </Panel>
      </div>
    </>
  );
}
