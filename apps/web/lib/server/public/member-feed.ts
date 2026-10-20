import "server-only";
import { adminClient } from "../supabase";
import { PublicDataError } from "./db";
import { MEMBER_FEED_DAYS, MEMBER_FEED_LIMIT, memberFeedItems, type MemberFeedItem, type MemberFeedRow } from "./member-feed-logic";
import { uncachedFetch } from "./cache";

// 내 관심 분야 새 글 (HOME-07, W2-e 설계 5.2) — 사용자별 인자라 공용 캐시에 섞이지 않게 캐시하지 않는다(uncachedFetch).
// 읽는 것은 본인의 관심 값뿐이고, 호출하는 쪽이 로그인 확인(viewer)을 마친 userId의 값만 넘긴다. analytics_events는 읽지 않는다.

export async function getMemberFeed(interests: readonly string[], regionCodes: readonly string[]): Promise<MemberFeedItem[]> {
  if (interests.length === 0 && regionCodes.length === 0) return [];
  const db = adminClient({ fetch: uncachedFetch });
  if (!db) throw new PublicDataError("서버 설정 — 회원 새 글");
  const { data, error } = await db.rpc("member_feed", {
    p_interests: [...interests],
    p_region_codes: [...regionCodes],
    p_days: MEMBER_FEED_DAYS,
    p_limit: MEMBER_FEED_LIMIT,
  });
  if (error) {
    console.error("[member-feed]", error.code, error.message);
    throw new PublicDataError("회원 새 글", error.code);
  }
  return memberFeedItems((data ?? []) as MemberFeedRow[]);
}
