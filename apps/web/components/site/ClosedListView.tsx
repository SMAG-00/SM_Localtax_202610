import { FieldHubHead } from "@ltr/ui";
import { SECTION_INFO, type SectionKey } from "@/lib/server/public/constants";
import { SiteSection } from "./SiteSection";
import { UnavailableNotice } from "./Unavailable";

// 닫힌 목록 — 공개 데이터를 읽지 못했을 때의 하위 분야·칼럼 목록(200). DB가 필요 없는 분야 허브 머리(이름·아이브로)와 안내 한 줄만 — 낡은 목록 0
export function ClosedListView({ section }: { section: SectionKey | "news" }) {
  const info = section === "news" ? { name: "뉴스 전체", eyebrow: "NEWS" } : SECTION_INFO[section];
  return (
    <div data-ui="closed-list" data-section={section}>
      <SiteSection id="closed-head" tone="ivory" first data={{ "data-hub-part": "head" }}>
        <FieldHubHead field={section} eyebrow={info.eyebrow} title={info.name} tabs={{ items: [], current: "all", label: "하위 분야" }} />
        <UnavailableNotice />
      </SiteSection>
    </div>
  );
}
