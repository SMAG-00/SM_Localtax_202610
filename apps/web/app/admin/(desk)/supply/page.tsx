import type { Metadata } from "next";
import Link from "next/link";
import { LICENSE_TYPE_LABELS, type LicenseType } from "@ltr/editorial";
import { SupplyForm, SupplyPublishControls } from "@/components/admin/SupplyControls";
import { EmptyNote, MONO, PageTitle, Panel, TEXT_LINK, ToneChip } from "@/components/admin/ui";
import { isoToKstDate } from "@/lib/admin/form-utils";
import { SUPPLY_STATUS_LABELS, type SupplyStatus } from "@/lib/admin/supply-rules";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { listSupply } from "@/lib/server/supply/board";

// 분양 정보 관리 (/admin/supply — W4 17단계, PRD-01B PR-04 · PR-05, docs/dev/W4_설계.md 1장 17단계 · 5장 · 6장) — 편집 책임자·관리자(supply.manage).
//  · 목록 — 상태·사업명·지역·청약 일정·모집공고일·공고 기관·확인일·공개 조건 미달 사유, 항목마다 고치기·공개·내리기
//  · 만들기 — 초안. 공식 공고 URL·공고 기관·모집공고일·청약 일정·공공누리 유형은 필수, 공개는 확인일·공급 규모까지
// 가격·분양가·분담금·수익률·시세 입력 요소는 어디에도 없다(PR-05) — 분양가는 공식 공고 링크로만(12장 #11).
// 시행사·분양대행사가 준 홍보 원고는 이 목록이 아니라 광고·협찬(sponsored) 기사로만 낸다(PR-04 — 출처 종류 '분양 홍보 원고').
// 공개 화면(/realestate/supply·지역 허브 ③·프로젝트 화면)은 기능 키 supply_notices가 켜졌을 때만 보인다 — 분양 광고 표시 기준 법률 검토 기록 전에는 꺼 둔다(12장 #12).
export const metadata: Metadata = { title: "분양 정보" };
export const dynamic = "force-dynamic";

const TONE: Record<SupplyStatus, "emerald" | "amber" | "navy"> = { draft: "amber", public: "emerald", hidden: "navy" };

export default async function SupplyPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "supply.manage");
  const notices = await listSupply(serviceDb());

  return (
    <>
      <PageTitle
        title="분양 정보"
        description="분양 공고를 기사와 나눈 정보 목록으로 기록합니다. 공식 공고를 보고 사업명·지역·공급 규모·청약 일정·모집공고일·공고 기관·공식 공고 주소를 넣고, 공개 전에 공식 공고와 대조해 확인일을 적습니다. 청약 마감일 다음 날 00:00(한국 시각)부터 예정 목록에서 빠지고 프로젝트 화면 기록으로 남습니다."
      />
      <div className="space-y-8">
        <Panel id="supply-list" title={`분양 정보 ${notices.length}건`} description="최근 고친 순입니다. 시행사·분양대행사가 준 홍보 원고는 여기에 넣지 않고 광고·협찬 기사로만 냅니다.">
          {notices.length === 0 ? (
            <EmptyNote>분양 정보가 없습니다.</EmptyNote>
          ) : (
            <ul className="space-y-6" data-testid="supply-list">
              {notices.map((n) => (
                <li key={n.id} data-supply-id={n.id} data-status={n.status} className="rounded-xl border border-navy-100 p-4 text-[15px]">
                  <p className="font-bold text-navy-900 [overflow-wrap:anywhere]">
                    {n.name} <ToneChip tone={TONE[n.status] ?? "navy"}>{SUPPLY_STATUS_LABELS[n.status] ?? n.status}</ToneChip>
                  </p>
                  <p className={`${MONO} mt-1 text-navy-600 [overflow-wrap:anywhere]`}>
                    #{n.id} · {n.region_name ?? "지역 이름 없음"} {n.region_code} · 청약 {n.apply_start} ~ {n.apply_end} · 모집공고일 {n.notice_date}
                  </p>
                  <p className="mt-1 text-navy-800 [overflow-wrap:anywhere]">
                    공고 기관 {n.notice_issuer} · 공공누리 {LICENSE_TYPE_LABELS[n.license_type as LicenseType] ?? n.license_type} · 확인일 {n.verified_at ? isoToKstDate(n.verified_at) : "없음"}
                    {n.supply_scale && ` · 공급 규모 ${n.supply_scale}`}
                  </p>
                  <p className="mt-1">
                    <a className={TEXT_LINK} href={n.official_notice_url} target="_blank" rel="noopener noreferrer">
                      공식 공고 열기<span className="sr-only"> (새 창)</span>
                    </a>
                    {n.project_id !== null && (
                      <>
                        {" · "}
                        <Link className={TEXT_LINK} href={`/admin/projects/${n.project_id}`}>
                          연결 프로젝트 {n.project_name ?? `#${n.project_id}`}
                        </Link>
                      </>
                    )}
                  </p>
                  {n.publish_problems.length > 0 && (
                    <ul data-part="publish-problems" className="mt-2 list-disc pl-5 text-navy-700">
                      {n.publish_problems.map((p) => (
                        <li key={p}>{p.replace(/^[^:]+: /, "")}</li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-4">
                    <SupplyPublishControls id={n.id} status={n.status} />
                  </div>
                  <details className="mt-4">
                    <summary className="cursor-pointer font-bold text-navy-900">고치기</summary>
                    <div className="mt-4">
                      <SupplyForm
                        id={n.id}
                        initial={{
                          name: n.name,
                          region_code: n.region_code,
                          project_id: n.project_id === null ? "" : String(n.project_id),
                          supply_scale: n.supply_scale ?? "",
                          apply_start: n.apply_start,
                          apply_end: n.apply_end,
                          notice_date: n.notice_date,
                          notice_issuer: n.notice_issuer,
                          official_notice_url: n.official_notice_url,
                          license_type: n.license_type,
                        }}
                      />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel id="supply-create" title="분양 정보 만들기" description="초안으로 만듭니다. 공개는 공급 규모와 확인일을 갖춘 뒤 목록에서 합니다.">
          <SupplyForm />
        </Panel>
      </div>
    </>
  );
}
