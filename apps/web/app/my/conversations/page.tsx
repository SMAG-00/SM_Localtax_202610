import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/server/dal";
import { listMySessions, memberSaveGet } from "@/lib/server/agent/d-store";
import { adminClient } from "@/lib/server/supabase";

// 내 지방세봇 대화 (W12-d d5 - ASK-12): 목록과 검색. 삭제와 저장 끄기는 /api/my/conversations. 로그인한 본인 것만, 검색 노출 0.
export const metadata: Metadata = { title: "내 대화", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function MyConversationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await getViewer().catch(() => null);
  if (!viewer) redirect(`/login?next=${encodeURIComponent("/my/conversations")}`);
  const admin = adminClient();
  if (!admin) throw new Error("서버 설정이 끝나지 않았습니다");
  const q = await searchParams;
  const query = typeof q.q === "string" ? q.q.slice(0, 60) : "";
  const [rows, saving] = await Promise.all([listMySessions(admin, viewer.userId, query || null), memberSaveGet(admin, viewer.userId)]);
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16">
      <h1 className="text-[28px] font-black text-navy-900">내 대화</h1>
      <p data-testid="conv-save-state" className="mt-3 text-[15px] text-navy-600">대화 저장: {saving ? "켜짐" : "꺼짐"}</p>
      <form method="get" className="mt-4">
        <label className="text-[15px] font-bold text-navy-900">
          대화 검색
          <input name="q" defaultValue={query} className="mt-1 block min-h-11 w-full rounded-xl border border-navy-200 px-3 text-[16px]" />
        </label>
      </form>
      <ul className="mt-6 space-y-3" data-testid="conv-list">
        {rows.length === 0 && <li className="text-[15px] text-navy-600">저장된 대화가 없습니다</li>}
        {rows.map((r) => (
          <li key={r.id} className="rounded-2xl border border-navy-100 bg-white p-4">
            <p className="text-[16px] font-bold text-navy-900">{r.first_question ?? "(저장하지 않은 대화)"}</p>
            <p className="mt-1 text-[14px] text-navy-600">
              {r.turn_count}번 주고받음 · 보관 기한 {r.retain_until.slice(0, 10)}
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
