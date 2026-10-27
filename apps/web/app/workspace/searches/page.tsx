import type { Metadata } from "next";
import { ERROR_TEXT, ExportLinks, ModeToggle, PostButton, WorkspaceNav, buttonCls, cardCls, density, inputCls } from "@/components/workspace/parts";
import { canCreate } from "@/lib/server/workspace/logic";
import { preparePage } from "@/lib/server/workspace/page-data";
import { listSearches } from "@/lib/server/workspace/store";

// 저장 검색 (W13-b, WS-04) - 개수 한도는 settings saved_search_limit(비면 0). 새 결과는 공개·무료 기사 제목만 센다.
export const metadata: Metadata = { title: "저장 검색", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function SearchesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { db, userId, access, mode } = await preparePage("/workspace/searches");
  const q = await searchParams;
  const error = typeof q.e === "string" && Object.hasOwn(ERROR_TEXT, q.e) ? ERROR_TEXT[q.e] : null;
  const rows = await listSearches(db, userId, true);
  return (
    <main className={`mx-auto w-full max-w-3xl px-4 py-12 ${density(mode)}`} data-mode={mode}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-black text-navy-900">저장 검색</h1>
        <ModeToggle mode={mode} />
      </div>
      <WorkspaceNav current="/workspace/searches" />
      {error && <p role="alert" className="mt-4 text-[15px] font-bold text-navy-900" data-testid="search-error">{error}</p>}
      {canCreate(access.view) && (
        <form method="post" action="/api/workspace/items" className={`${cardCls} mt-6`} data-testid="search-form">
          <input type="hidden" name="action" value="search_create" />
          <input type="hidden" name="return" value="/workspace/searches" />
          <label className="block text-[15px] font-bold text-navy-900">
            이름
            <input name="name" required maxLength={80} className={inputCls} />
          </label>
          <label className="mt-3 block text-[15px] font-bold text-navy-900">
            검색어
            <input name="q" required maxLength={200} className={inputCls} />
          </label>
          <label className="mt-3 flex items-center gap-2 text-[15px] text-navy-900">
            <input type="checkbox" name="notify" value="true" className="size-5" /> 새 결과 알림 받기
          </label>
          <button type="submit" className={`${buttonCls} mt-4`}>저장</button>
        </form>
      )}
      <ExportLinks target="saved_searches" />
      <ul className="mt-6 space-y-3" data-testid="search-list">
        {rows.length === 0 && <li className="text-[15px] text-navy-600">저장한 검색이 없습니다</li>}
        {rows.map((s) => (
          <li key={s.id} className={cardCls}>
            <p className="font-bold text-navy-900">{s.name}</p>
            <p className="mt-1 text-[14px] text-navy-600">검색어 {s.conditions?.q ?? ""} · 새 결과 {s.newCount ?? 0}건</p>
            <div className="mt-3"><PostButton action="search_delete" id={s.id} label="삭제" ret="/workspace/searches" /></div>
          </li>
        ))}
      </ul>
    </main>
  );
}
