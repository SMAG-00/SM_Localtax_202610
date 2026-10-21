import type { Metadata } from "next";
import { HubPointForm } from "@/components/admin/HubPointControls";
import { MONO, PageTitle, Panel, ToneChip } from "@/components/admin/ui";
import { can } from "@/lib/access";
import { HUB_POINT_SECTIONS, pointState, readStoredPoints } from "@/lib/admin/hub-point-rules";
import { readSetting } from "@/lib/server/admin/backoffice";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { SECTION_INFO } from "@/lib/server/public/constants";

// 허브 지방세 포인트 (/admin/hub-points, CORE-02 · W3 9단계) — 편집 책임자(초안)·세무 감수위원(서명). 부동산·개발금융·지자체뉴스 허브 머리의
// "이 분야의 지방세 포인트"와 홈 4대 분야 카드의 한 줄이 여기서 온다. 서명 전 분야는 공개 화면에서 블록째 숨는다.
export const metadata: Metadata = { title: "허브 지방세 포인트" };
export const dynamic = "force-dynamic";

const STATE_LABEL = { none: "없음", draft: "감수 전 (공개 안 됨)", reviewed: "감수 완료 (공개 중)" } as const;

export default async function HubPointsPage() {
  const viewer = await pageViewer();
  requirePage(viewer, ["hub_point.edit", "review.tax_review"]);
  const points = readStoredPoints((await readSetting(serviceDb(), "hub_tax_points"))?.value);
  const canEdit = can(viewer, "hub_point.edit");
  const canReview = can(viewer, "review.tax_review");
  return (
    <>
      <PageTitle
        title="허브 지방세 포인트"
        description="부동산·부동산개발금융·지자체뉴스 허브 머리에 보이는 '이 분야의 지방세 포인트'입니다. 문구 3줄까지·기준일·지방세 해설 링크가 필요하고, 세무 감수 서명 뒤에만 공개됩니다. 초안을 고치면 서명이 지워집니다."
      />
      <div className="space-y-8">
        {HUB_POINT_SECTIONS.map((section) => {
          const point = points[section] ?? null;
          const state = pointState(point ?? undefined);
          return (
            <Panel key={section} id={`hub-point-${section}`} title={SECTION_INFO[section].name}>
              <p className="mb-3 text-[15px] text-navy-800">
                <ToneChip>{STATE_LABEL[state]}</ToneChip>
                {point?.reviewed_at && <span className={`${MONO} ml-2 text-navy-500`}>서명 {point.reviewed_at.slice(0, 10)}</span>}
              </p>
              <HubPointForm row={{ section, name: SECTION_INFO[section].name, state, point }} canEdit={canEdit} canReview={canReview} />
            </Panel>
          );
        })}
      </div>
    </>
  );
}
