import "server-only";
import { cache } from "react";
import { issueSlug } from "@ltr/workflows/ops";
import type { Features } from "./constants";
import { publicDb, rowsOf } from "./db";
import { NO_SHORTCUT_INPUTS, type ShortcutInputs } from "./shortcuts-logic";

// 바로가기에 필요한 DB 값 (HOME-12) - 최신 브리핑 호 주소와 재테크 포인트 발행 여부. 바로가기는 메뉴라 이 값이 비어도 항목은 사라지지 않는다
// (브리핑은 /brief, 재테크 포인트는 /realestate/weekly 준비 중 화면으로 간다). 키가 꺼진 도착은 DB를 읽지 않는다 (공개 뷰는 키가 꺼지면 0행이라 결과는 같다)
export const readShortcutInputs = cache(async (features: Features): Promise<ShortcutInputs> => {
  if (!features.shortcuts) return NO_SHORTCUT_INPUTS;
  const db = publicDb();
  // 브리핑 호 읽기는 메일 설정이 필요 없다 (메일은 구독 양식·API만 쓴다) - /brief/[date]와 같은 조건: 키 brief_regular + 공개 호
  const [brief, weekly] = await Promise.all([
    features.brief_regular ? rowsOf<{ publish_at: string }>(db.from("public_brief_issues").select("publish_at").order("publish_at", { ascending: false }).limit(1), "최신 브리핑 호") : Promise.resolve([]),
    features.realestate_weekly ? rowsOf<{ issue_id: number }>(db.from("public_realestate_weekly").select("issue_id").limit(1), "금주 부동산 재테크") : Promise.resolve([]),
  ]);
  return { briefHref: brief[0] ? `/brief/${issueSlug(new Date(brief[0].publish_at))}` : null, weeklyOpen: weekly.length > 0 };
});
