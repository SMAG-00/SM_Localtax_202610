import type { Metadata } from "next";
import { SECTIONS } from "@ltr/editorial";
import { CategoryForm, CategoryList } from "@/components/admin/CategoryControls";
import { EmptyNote, PageTitle, Panel } from "@/components/admin/ui";
import { SECTION_LABELS } from "@/lib/admin/labels";
import { listCategoryRows } from "@/lib/server/admin/backoffice";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";

// 분야 (/admin/categories, CAT-01) — 4대 분야(허브)별 하위 분야. 더하기·고치기·순서 바꾸기·공개 여부. 편집 책임자·관리자.
// 허브(section)는 4개로 고정이다. 바꾸면 배포 없이 다음 화면부터 메뉴·허브·기사 편집기의 하위 분야 목록에 반영된다.
export const metadata: Metadata = { title: "분야" };

export default async function CategoriesPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "category.edit");
  const rows = await listCategoryRows(serviceDb());

  return (
    <>
      <PageTitle
        title="분야"
        description="허브는 4대 분야(지방세·부동산·부동산개발금융·지자체뉴스)로 정해져 있습니다. 그 아래 하위 분야를 더하고, 고치고, 순서를 바꿉니다."
      />
      <div className="space-y-8">
        {SECTIONS.map((section) => {
          const items = rows.filter((r) => r.section === section);
          return (
            <Panel key={section} id={`section-${section}`} title={SECTION_LABELS[section]} description={`허브 주소 /${section} · 하위 분야 ${items.length}개`}>
              {items.length === 0 ? <EmptyNote>하위 분야가 없습니다.</EmptyNote> : <CategoryList section={section} categories={items} />}
              <details className="rounded-xl border border-dashed border-navy-200 p-4">
                <summary className="min-h-11 cursor-pointer text-[15px] font-bold text-navy-800">이 분야에 하위 분야 더하기</summary>
                <CategoryForm mode="create" section={section} />
              </details>
            </Panel>
          );
        })}
      </div>
    </>
  );
}
