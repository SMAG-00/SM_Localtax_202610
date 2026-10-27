import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { featureOn } from "@/lib/server/brief/policy";

// /my의 알림·맞춤 브리핑 링크 (W13-d) - 기능 키가 켜진 것만 보인다 (꺼진 기능 링크 0).
export async function MyNotifyLinks({ db }: { db: SupabaseClient }) {
  const [noti, brief] = await Promise.all([featureOn(db, "my_notifications").catch(() => false), featureOn(db, "my_briefings").catch(() => false)]);
  if (!noti && !brief) return null;
  return (
    <ul className="mt-4 space-y-1 text-[15px]" data-testid="my-notify-links">
      {noti && (
        <li>
          <Link href="/my/notifications" className="inline-flex min-h-11 items-center font-bold text-navy-700 underline underline-offset-4">
            알림 설정
          </Link>
        </li>
      )}
      {brief && (
        <li>
          <Link href="/my/briefings" className="inline-flex min-h-11 items-center font-bold text-navy-700 underline underline-offset-4">
            맞춤 브리핑
          </Link>
        </li>
      )}
    </ul>
  );
}
