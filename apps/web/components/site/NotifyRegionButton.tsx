import { featureOn } from "@/lib/server/brief/policy";
import { adminClient } from "@/lib/server/supabase";

// 지자체 허브 [이 지자체 소식 받기] (W13-d, NOTI-01) - 기능 키 my_notifications가 켜졌을 때만 보인다.
// 누르면 관심 지역에 담고 지역 알림을 켠다(로그인·수신 동의가 없으면 알림 설정 화면이 안내한다). 비로그인은 로그인 화면으로 간다.
export async function NotifyRegionButton({ regionCode }: { regionCode: string }) {
  const db = adminClient();
  if (!db || !(await featureOn(db, "my_notifications").catch(() => false))) return null;
  return (
    <form method="post" action="/api/my/notifications" className="mx-auto w-full max-w-5xl px-4 py-4" data-testid="notify-region">
      <input type="hidden" name="action" value="follow" />
      <input type="hidden" name="region" value={regionCode} />
      <button type="submit" className="min-h-11 rounded-xl border border-navy-200 px-4 text-[15px] font-bold text-navy-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400">
        이 지자체 소식 받기
      </button>
    </form>
  );
}
