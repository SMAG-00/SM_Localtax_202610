import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { featureOn } from "@/lib/server/brief/policy";
import { getViewer } from "@/lib/server/dal";
import { listInbox, readNotiPrefs } from "@/lib/server/notify/service";
import { adminClient } from "@/lib/server/supabase";
import { BRIEFING_MODES, NOTI_FREQ_LABEL, NOTI_UI_FREQUENCIES, NOTI_KIND_LABEL, NOTI_UI_KINDS } from "@/lib/notify/logic";

// 내 알림 (W13-d, NOTI-01) - 설정(종류·빈도·브리핑)과 알림함. 켜기 전에는 아무것도 보내지 않는다. 요청마다 그리고 검색에 나오지 않는다.
export const metadata: Metadata = { title: "내 알림", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  no_consent: "수신 동의가 있어야 알림을 켤 수 있습니다. 내 정보에서 수신 동의를 확인하세요.",
  region_limit: "관심 지역을 더 담을 수 없습니다.",
  region_invalid: "담을 수 없는 지역입니다.",
  invalid: "입력을 확인하세요.",
};
const BRIEFING_LABEL: Record<(typeof BRIEFING_MODES)[number], string> = { off: "받지 않음", web: "웹에서만", mail: "웹과 메일" };

export default async function MyNotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const db = adminClient();
  if (!db) throw new Error("서버 설정이 끝나지 않았습니다");
  if (!(await featureOn(db, "my_notifications").catch(() => false))) notFound();
  const viewer = await getViewer().catch(() => null);
  if (!viewer) redirect(`/login?next=${encodeURIComponent("/my/notifications")}`);
  const q = await searchParams;
  const briefingOn = await featureOn(db, "my_briefings").catch(() => false);
  const [prefs, inbox] = await Promise.all([readNotiPrefs(db, viewer.userId), listInbox(db, viewer.userId)]);
  const error = typeof q.error === "string" ? (ERRORS[q.error] ?? ERRORS.invalid) : null;
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16">
      <h1 className="text-[28px] font-black text-navy-900">내 알림</h1>
      {q.saved === "1" && (
        <p role="status" data-testid="noti-saved" className="mt-4 rounded-xl border border-navy-100 bg-navy-50 px-4 py-3 text-[15px] font-bold text-navy-900">
          저장했습니다
        </p>
      )}
      {error && (
        <p role="alert" data-testid="noti-error" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] font-bold text-rose-800">
          {error}
        </p>
      )}
      <form method="post" action="/api/my/notifications" className="mt-6 rounded-2xl border border-navy-100 bg-white p-5" data-testid="noti-form">
        <input type="hidden" name="action" value="save" />
        <fieldset>
          <legend className="text-[18px] font-black text-navy-900">받을 알림</legend>
          {NOTI_UI_KINDS.map((k) => (
            <label key={k} className="mt-2 flex min-h-11 items-center gap-3 text-[16px] text-navy-900">
              <input type="checkbox" name="kinds" value={k} defaultChecked={prefs.kinds.includes(k)} className="h-5 w-5" />
              {NOTI_KIND_LABEL[k]}
            </label>
          ))}
        </fieldset>
        <label className="mt-4 block text-[16px] font-bold text-navy-900">
          빈도
          <select name="frequency" defaultValue={prefs.frequency === "instant" ? "daily" : prefs.frequency} className="mt-1 block min-h-11 w-full rounded-xl border border-navy-200 bg-white px-3 text-[16px]">
            {NOTI_UI_FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {NOTI_FREQ_LABEL[f]}
              </option>
            ))}
          </select>
        </label>
        {briefingOn ? (
          <label className="mt-4 block text-[16px] font-bold text-navy-900">
            맞춤 브리핑
            <select name="briefing" defaultValue={prefs.briefing} className="mt-1 block min-h-11 w-full rounded-xl border border-navy-200 bg-white px-3 text-[16px]">
              {BRIEFING_MODES.map((m) => (
                <option key={m} value={m}>
                  {BRIEFING_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <input type="hidden" name="briefing" value={prefs.briefing} />
        )}
        <button type="submit" className="mt-5 min-h-11 rounded-xl bg-navy-900 px-4 text-[16px] font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400">
          저장
        </button>
      </form>
      <h2 className="mt-8 text-[18px] font-black text-navy-900">알림함</h2>
      <ul className="mt-3 space-y-3" data-testid="noti-inbox">
        {inbox.length === 0 && <li className="text-[15px] text-navy-600">받은 알림이 없습니다</li>}
        {inbox.map((n) => (
          <li key={n.id} className="rounded-2xl border border-navy-100 bg-white p-4">
            <p className="text-[14px] text-navy-600">
              {NOTI_KIND_LABEL[n.kind]} · {n.created_at.slice(0, 10)}
              {n.read_at ? " · 읽음" : ""}
            </p>
            <a href={n.link} className="mt-1 inline-block min-h-11 text-[16px] font-bold text-navy-900 underline underline-offset-4" data-noti-id={n.id}>
              {n.label}
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
