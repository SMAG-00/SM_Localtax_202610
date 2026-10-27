import type { Metadata } from "next";
import { ERROR_TEXT, ExportLinks, ModeToggle, PostButton, WorkspaceNav, buttonCls, cardCls, density, inputCls } from "@/components/workspace/parts";
import { canCreate } from "@/lib/server/workspace/logic";
import { preparePage } from "@/lib/server/workspace/page-data";
import { listFolders, listNotes } from "@/lib/server/workspace/store";

// 내 메모와 폴더 (W13-b, WS-03) - 본인 것만. 권한이 끝나도 열람·삭제·내보내기는 남는다(새로 만들기만 닫힘).
export const metadata: Metadata = { title: "내 메모", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function NotesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { db, userId, access, mode } = await preparePage("/workspace/notes");
  const q = await searchParams;
  const error = typeof q.e === "string" && Object.hasOwn(ERROR_TEXT, q.e) ? ERROR_TEXT[q.e] : null;
  const [notes, folders] = await Promise.all([listNotes(db, userId), listFolders(db, userId)]);
  const create = canCreate(access.view);
  return (
    <main className={`mx-auto w-full max-w-3xl px-4 py-12 ${density(mode)}`} data-mode={mode}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-black text-navy-900">내 메모</h1>
        <ModeToggle mode={mode} />
      </div>
      <WorkspaceNav current="/workspace/notes" />
      {error && <p role="alert" className="mt-4 text-[15px] font-bold text-navy-900">{error}</p>}
      {create ? (
        <form method="post" action="/api/workspace/items" className={`${cardCls} mt-6`} data-testid="note-form">
          <input type="hidden" name="action" value="note_save" />
          <input type="hidden" name="return" value="/workspace/notes" />
          <label className="block text-[15px] font-bold text-navy-900">
            제목 (선택)
            <input name="title" maxLength={120} className={inputCls} />
          </label>
          <label className="mt-3 block text-[15px] font-bold text-navy-900">
            메모
            <textarea name="body" required maxLength={20000} rows={4} className={inputCls} />
          </label>
          <label className="mt-3 block text-[15px] font-bold text-navy-900">
            폴더
            <select name="folderId" className={inputCls}>
              <option value="">(폴더 없음)</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </label>
          <button type="submit" className={`${buttonCls} mt-4`}>메모 저장</button>
        </form>
      ) : (
        <p className="mt-6 text-[15px] text-navy-600" data-testid="readonly-note">이용 권한이 없어 새 메모는 만들 수 없습니다. 이전 메모는 열람하고 내보낼 수 있습니다.</p>
      )}
      <ExportLinks target="notes" />
      <ul className="mt-6 space-y-3" data-testid="note-list">
        {notes.length === 0 && <li className="text-[15px] text-navy-600">메모가 없습니다</li>}
        {notes.map((n) => (
          <li key={n.id} className={cardCls}>
            <p className="font-bold text-navy-900">{n.title ?? "메모"}{n.ai_draft ? " (AI 초안)" : ""}</p>
            <p className="mt-1 whitespace-pre-wrap text-navy-700">{n.body}</p>
            <div className="mt-3"><PostButton action="note_delete" id={n.id} label="삭제" ret="/workspace/notes" /></div>
          </li>
        ))}
      </ul>
      {create && (
        <form method="post" action="/api/workspace/items" className="mt-6 flex gap-2">
          <input type="hidden" name="action" value="folder_create" />
          <input type="hidden" name="return" value="/workspace/notes" />
          <input name="name" required maxLength={60} aria-label="새 폴더 이름" className={inputCls} />
          <button type="submit" className={buttonCls}>폴더 만들기</button>
        </form>
      )}
    </main>
  );
}
