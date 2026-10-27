import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { featureOn } from "@/lib/server/brief/policy";
import { getViewer } from "@/lib/server/dal";
import { listBriefings, openBriefing, resolveItems } from "@/lib/server/notify/service";
import { adminClient } from "@/lib/server/supabase";

// 내 맞춤 브리핑 (W13-d, WS-06) - 이미 공개된 기사·승인된 결정례 요지의 목록뿐이다. 새 문장 없음, 항목마다 출처 링크와 기준일.
// 항목은 열 때 지금의 공개 상태로 다시 읽으므로 내려간 항목은 보이지 않는다. 요청마다 그리고 검색에 나오지 않는다.
export const metadata: Metadata = { title: "내 브리핑", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const REASON: Record<string, string> = { saved_search: "저장 검색", region: "관심 지역", interest: "관심 분야", case_summary: "승인된 결정례 요지" };

export default async function MyBriefingsPage() {
  const db = adminClient();
  if (!db) throw new Error("서버 설정이 끝나지 않았습니다");
  if (!(await featureOn(db, "my_briefings").catch(() => false))) notFound();
  const viewer = await getViewer().catch(() => null);
  if (!viewer) redirect(`/login?next=${encodeURIComponent("/my/briefings")}`);
  const rows = await listBriefings(db, viewer.userId);
  const now = new Date();
  const views = await Promise.all(
    rows.map(async (r) => {
      await openBriefing(db, viewer.userId, r.id, now).catch(() => null);
      return { ...r, items: await resolveItems(db, r.items).catch(() => []) };
    }),
  );
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16">
      <h1 className="text-[28px] font-black text-navy-900">내 브리핑</h1>
      <div className="mt-6 space-y-5" data-testid="briefing-list">
        {views.length === 0 && <p className="text-[15px] text-navy-600">아직 받은 브리핑이 없습니다</p>}
        {views.map((b) => (
          <section key={b.id} className="rounded-2xl border border-navy-100 bg-white p-5" aria-labelledby={`b-${b.id}`}>
            <h2 id={`b-${b.id}`} className="text-[18px] font-black text-navy-900">
              {b.period}
            </h2>
            <ul className="mt-3 space-y-3">
              {b.items.map((i) => (
                <li key={`${i.type}-${i.id}`}>
                  <a href={i.link} className="text-[16px] font-bold text-navy-900 underline underline-offset-4">
                    {i.title}
                  </a>
                  <p className="text-[14px] text-navy-600">
                    {REASON[i.reason] ?? i.reason} · 기준일 {i.basisOn}
                  </p>
                  {i.lines.length > 0 && (
                    <ul className="mt-1 list-disc pl-5 text-[15px] text-navy-700">
                      {i.lines.map((l, n) => (
                        <li key={n}>{l}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
              {b.items.length === 0 && <li className="text-[15px] text-navy-600">공개된 항목이 없습니다</li>}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
