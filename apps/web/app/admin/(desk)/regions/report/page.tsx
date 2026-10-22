import type { Metadata } from "next";
import { DataTable, EmptyNote, MONO, PageTitle, Panel, TD, TEXT_LINK, ToneChip } from "@/components/admin/ui";
import { REGION_INDEX_KEY_LABELS, type PilotRegionView } from "@/lib/server/public/region-index-logic";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { loadRegionIndexReport } from "@/lib/server/regions/report";

// 시범 지역 최소선 판정 리포트 (/admin/regions/report — W4 11단계, PRD-01B 9.2 · REG-09 · REG1-12, docs/dev/W4_설계.md 1장 11단계 · 5장) — 편집 책임자·관리자(regional.judge).
//  · 시범 지역(설정 pilot_regions)마다 자체 취재 기사 수·공식 원문/자료 수와 최소선(설정 region_index_threshold), 판정(색인 대상·미달)
//  · 시·도 분포 — 서로 다른 시·도 2곳 이상. 한 시·도뿐이면 '시·도 분포 미달', 시범 지역이 비면 '시범 지역 미지정'
//  · 판정은 DB 뷰 region_index_status가 이 화면을 열 때 계산한다(배포 없이 설정·기사 변경이 바로 보인다). 설정은 운영 설정 화면(관리자)에서 고친다
export const metadata: Metadata = { title: "시범 지역 최소선 리포트" };
export const dynamic = "force-dynamic";

function CountCell({ item, testId }: { item: PilotRegionView["reported"]; testId: string }) {
  return (
    <td className={TD} data-testid={testId} data-count={item.count} data-min={item.min ?? ""} data-ok={item.ok ? "true" : "false"}>
      <span className={MONO}>
        {item.count} / 최소 {item.min ?? "—"}
      </span>{" "}
      <ToneChip tone={item.ok ? "emerald" : "rose"}>{item.ok ? "충족" : "미달"}</ToneChip>
    </td>
  );
}

export default async function RegionReportPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "regional.judge");
  const report = await loadRegionIndexReport(serviceDb());

  return (
    <>
      <PageTitle
        title="시범 지역 최소선 리포트"
        description="시범 지역마다 자체 취재 기사와 공식 원문/자료가 최소선 이상인지, 시범 지역이 서로 다른 시·도 2곳 이상인지 봅니다. 최소선 미달 지역은 검색 노출 제외(noindex)이고 사이트맵에 없습니다."
      >
        <a className={TEXT_LINK} href="/admin/regions">
          지역 기사 판정으로
        </a>
      </PageTitle>
      <div className="space-y-8">
        <Panel id="region-report-summary" title="판정">
          <div data-testid="region-report-summary" data-status={report.status} className="space-y-3">
            <p className="text-[17px] font-bold text-navy-900">
              <ToneChip tone={report.status === "met" ? "emerald" : report.status === "short" ? "rose" : "amber"}>{report.label}</ToneChip>
            </p>
            {report.problems.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-[15px] text-navy-800" data-testid="region-report-problems">
                {report.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            <p className={`${MONO} text-navy-700`}>
              최소선 — {REGION_INDEX_KEY_LABELS.reported_news} <span data-testid="threshold-reported">{report.threshold.reported ?? "—"}</span>건 이상 · {REGION_INDEX_KEY_LABELS.official_sources}{" "}
              <span data-testid="threshold-official">{report.threshold.official ?? "—"}</span>건 이상 · 시·도 분포 <span data-testid="sido-count">{report.sidoCount}</span>곳 / 최소 {report.minSido}곳 · 전국 색인 대상{" "}
              <span data-testid="indexed-count">{report.indexedCount}</span>곳
            </p>
          </div>
        </Panel>

        <Panel id="region-report-pilots" title={`시범 지역 ${report.regions.length}곳`} description="자체 취재 기사 = 그 지역 태그·편집 분야·편집 승인이 있는 공개 보도기사(보도자료 재게시·보류·별도 상품·금주 핫뉴스·칼럼 제외). 공식 원문/자료 = 원문 URL·발표기관·기준일·확인일·공공누리 유형·원본 스냅샷이 모두 있는 것(같은 원문은 하나).">
          {report.regions.length === 0 ? (
            <EmptyNote>시범 지역이 지정되지 않았습니다. 운영 설정의 pilot_regions에 법정동코드를 넣습니다.</EmptyNote>
          ) : (
            <DataTable caption="시범 지역별 최소선 판정" head={["지역", "자체 취재 기사", "공식 원문/자료", "판정"]}>
              {report.regions.map((r) => (
                <tr key={r.code} data-testid="pilot-row" data-region-code={r.code} data-indexable={r.indexable ? "true" : "false"}>
                  <td className={TD}>
                    <span className="font-bold text-navy-900">{r.sidoName && r.sidoName !== r.name ? `${r.sidoName} ${r.name}` : r.name}</span>
                    <span className={`${MONO} ml-2 text-navy-600`}>{r.code}</span>
                    {r.path && (
                      <span className={`${MONO} block text-navy-600`}>
                        {r.path}
                      </span>
                    )}
                    {!r.current && <ToneChip tone="amber">오늘 유효하지 않음</ToneChip>}
                  </td>
                  <CountCell item={r.reported} testId="pilot-reported" />
                  <CountCell item={r.official} testId="pilot-official" />
                  <td className={TD}>
                    <ToneChip tone={r.indexable ? "emerald" : "rose"}>{r.indexable ? "색인 대상" : "미달 — noindex"}</ToneChip>
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
      </div>
    </>
  );
}
