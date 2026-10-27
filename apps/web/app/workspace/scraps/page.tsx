import type { Metadata } from "next";
import { ERROR_TEXT, ExportLinks, ModeToggle, PostButton, WorkspaceNav, cardCls, density } from "@/components/workspace/parts";
import { TARGET_LABELS } from "@/lib/server/workspace/logic";
import { preparePage } from "@/lib/server/workspace/page-data";
import { listScraps } from "@/lib/server/workspace/store";

// 내 스크랩 (W13-b, WS-03) - 대상 종류+번호+원문 버전만 저장한다. 지금 버전과 다르면 "개정됨". 새 스크랩은 각 자료 화면의 스크랩 버튼이 /api/workspace/items(scrap_add)로 보낸다.
export const metadata: Metadata = { title: "내 스크랩", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ScrapsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { db, userId, mode } = await preparePage("/workspace/scraps");
  const q = await searchParams;
  const error = typeof q.e === "string" && Object.hasOwn(ERROR_TEXT, q.e) ? ERROR_TEXT[q.e] : null;
  const scraps = await listScraps(db, userId);
  return (
    <main className={`mx-auto w-full max-w-3xl px-4 py-12 ${density(mode)}`} data-mode={mode}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-black text-navy-900">내 스크랩</h1>
        <ModeToggle mode={mode} />
      </div>
      <WorkspaceNav current="/workspace/scraps" />
      {error && <p role="alert" className="mt-4 text-[15px] font-bold text-navy-900">{error}</p>}
      <ExportLinks target="scraps" />
      <ul className="mt-6 space-y-3" data-testid="scrap-list">
        {scraps.length === 0 && <li className="text-[15px] text-navy-600">스크랩이 없습니다</li>}
        {scraps.map((s) => (
          <li key={s.id} className={cardCls}>
            <p className="font-bold text-navy-900">
              {s.label}
              {s.revised && <span className="ml-2 text-hermes-500" data-testid="revised-badge">개정됨</span>}
            </p>
            <p className="mt-1 text-[14px] text-navy-600">{TARGET_LABELS[s.target_kind]} · 번호 {s.target_id} · 확인일 {s.checked_on}</p>
            <div className="mt-3"><PostButton action="scrap_remove" id={s.id} label="삭제" ret="/workspace/scraps" /></div>
          </li>
        ))}
      </ul>
    </main>
  );
}
