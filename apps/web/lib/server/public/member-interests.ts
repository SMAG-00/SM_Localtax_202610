import "server-only";
import { cache } from "react";
import { getViewer } from "@/lib/server/dal";
import { adminClient } from "@/lib/server/supabase";
import { parseInterests } from "@/lib/site/shortcut-order";

// 로그인한 회원의 저장된 관심 분야(기존 profiles.interests - /my가 읽는 것과 같은 값)를 바로가기 순서에만 쓴다 (W10-i 결정 14).
//  · 새 개인 정보를 저장하지 않는다. 읽기만 하고 화면에는 값을 싣지 않는다 - 순서만 바뀐다.
//  · 공개 레이아웃은 요청 때 그리고(connection) 이 읽기는 회원 쿠키 세션 + 서비스 키 조회라 공개 데이터 캐시(PUBLIC_DATA_TAG)에 들어가지 않는다 - 회원마다 다른 값이 캐시에 섞이지 않는다.
//  · 호출하는 쪽이 키 shortcuts가 켜졌을 때만 부른다(꺼짐이면 쿠키도 읽지 않아 1단계와 같다). 실패하면 비회원처럼 빈 목록.
export const readMemberInterests = cache(async (): Promise<string[]> => {
  try {
    const viewer = await getViewer();
    const db = adminClient();
    if (!viewer || !db) return [];
    const { data, error } = await db.from("profiles").select("interests").eq("id", viewer.userId).maybeSingle();
    return error ? [] : parseInterests(data?.interests);
  } catch {
    return [];
  }
});
