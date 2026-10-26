import { getRegionStage3 } from "@/lib/server/public/region-stage3";
import { MeasureView } from "./Measure";

// 지자체 허브 3단계 블록 (W11-e e5) - ③ 정비 현황(부동산·개발) · ⑤ 조례(공식 자료/해설). 항목이 0이면 블록째 렌더 0 (빈 상자·'준비 중' 0).
// 지도 요소 0. 조례는 원문 상자와 편집 요약 상자를 나눈다. 블록 순서(LG-08)는 기존 LocalHubBlocks 뒤에 붙는다.

const LINK = "text-navy-700 underline underline-offset-2";

function External({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
      {children}
    </a>
  );
}

const KIND_LABEL = { urban_redevelopment: "도시정비 조례", tax_reduction: "지방세 감면 조례", tax_rate: "지방세 세율 조례" } as const;

export async function RegionStage3Blocks({ regionCode, level }: { regionCode: string; level: "sido" | "sigungu" }) {
  const { zones, ordinances } = await getRegionStage3(regionCode, level);
  if (!zones && !ordinances) return null;
  return (
    <div data-region-part="stage3" className="mt-12 space-y-10">
      {zones && (
        <section data-ui="region-zones" aria-labelledby="region-zones-title" className="rounded-2xl border border-navy-100 bg-white p-6">
          <MeasureView name="zone_viewed" section="local" props={{ region_code: regionCode, project_type: zones.items[0]!.projectType, entry: "local_hub_block" }} />
          <h2 id="region-zones-title" className="text-[22px] font-black tracking-tight text-navy-900">
            정비사업 현황
          </h2>
          <ul className="mt-4 divide-y divide-navy-100">
            {zones.items.map((z) => (
              <li key={z.slug} data-zone={z.slug} data-stale={z.stale ? "true" : "false"} className="py-4">
                <p className="text-[17px] font-black text-navy-900">{z.name}</p>
                <dl className="mt-2 grid gap-x-6 gap-y-1 text-[15px] text-navy-700 sm:grid-cols-2">
                  {z.typeLabel && (
                    <div>
                      <dt className="inline font-bold">사업 유형 </dt>
                      <dd className="inline">{z.typeLabel}</dd>
                    </div>
                  )}
                  {z.stageLabel && (
                    <div>
                      <dt className="inline font-bold">현재 단계 </dt>
                      <dd className="inline">{z.stageLabel}</dd>
                    </div>
                  )}
                  {z.designationDate && (
                    <div>
                      <dt className="inline font-bold">지정 고시일 </dt>
                      <dd className="inline font-mono">{z.designationDate}</dd>
                    </div>
                  )}
                  {z.operator && (
                    <div>
                      <dt className="inline font-bold">시행자 </dt>
                      <dd className="inline">{z.operator}</dd>
                    </div>
                  )}
                </dl>
                <p className="mt-2 text-[14px] text-navy-600">
                  출처 <External href={z.sourceUrl}>{z.sourceName}</External> · 확인일 <span className="font-mono">{z.verifiedOn}</span>
                  {z.stale && <span data-part="stale"> · 확인일이 오래되어 다시 확인하는 중입니다</span>}
                </p>
              </li>
            ))}
          </ul>
          <p data-part="disclaimer" className="mt-4 text-[14px] text-navy-600">
            {zones.disclaimer}
          </p>
        </section>
      )}
      {ordinances && (
        <section data-ui="region-ordinances" aria-labelledby="region-ordinances-title" className="rounded-2xl border border-navy-100 bg-white p-6">
          <MeasureView name="ordinance_viewed" section="local" props={{ region_code: regionCode, kind: ordinances.items[0]!.kind, entry: "local_hub" }} />
          <h2 id="region-ordinances-title" className="text-[22px] font-black tracking-tight text-navy-900">
            조례
          </h2>
          <ul className="mt-4 space-y-8">
            {ordinances.items.map((o) => (
              <li key={o.id} data-ordinance={o.id} data-ordinance-kind={o.kind} data-stale={o.stale ? "true" : "false"}>
                <p className="text-[17px] font-black text-navy-900">
                  {o.name} <span className="text-[14px] font-normal text-navy-600">{KIND_LABEL[o.kind]}</span>
                </p>
                <p className="mt-1 text-[14px] text-navy-600">
                  시행일 <span className="font-mono">{o.effectiveFrom}</span> · 확인일 <span className="font-mono">{o.verifiedOn}</span> · <External href={o.sourceUrl}>원문 출처</External>
                  {o.stale && <span data-part="stale"> · 확인일이 오래되어 다시 확인하는 중입니다</span>}
                </p>
                <div data-part="ordinance-text" className="mt-3 rounded-lg border border-navy-100 p-4">
                  <h3 className="text-[15px] font-black text-navy-900">조례 원문</h3>
                  {o.articles.map((a) => (
                    <p key={a.label} className="mt-2 text-[15px] text-navy-800">
                      <span className="font-bold">{a.label}</span>
                      {a.title ? ` (${a.title})` : ""} {a.body}
                    </p>
                  ))}
                </div>
                {o.summary && (
                  <div data-part="ordinance-summary" className="mt-3 rounded-lg bg-ivory-50 p-4">
                    <h3 className="text-[15px] font-black text-navy-900">
                      편집 요약 <span data-part="review-badge" className="ml-2 rounded bg-navy-900 px-2 py-0.5 text-[12px] text-white">감수</span>
                    </h3>
                    <p className="mt-2 text-[15px] text-navy-800">{o.summary.text}</p>
                    <p className="mt-2 text-[13px] text-navy-600">
                      기준일 <span className="font-mono">{o.summary.signedOn}</span> · 요약은 원문이 아니며 원문과 다르면 원문이 우선합니다
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
