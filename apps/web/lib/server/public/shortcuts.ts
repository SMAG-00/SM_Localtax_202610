import "server-only";
import { cache } from "react";
import { issueSlug } from "@ltr/workflows/ops";
import type { Features } from "./constants";
import { publicDb, rowsOf } from "./db";
import { NO_SHORTCUT_INPUTS, type ShortcutInputs } from "./shortcuts-logic";

// 바로가기 도착이 열려 있는지 읽는 DB 값 (HOME-12) - 키가 꺼진 도착은 DB를 읽지 않는다 (공개 뷰는 키가 꺼지면 0행이라 결과는 같다)
export const readShortcutInputs = cache(async (features: Features): Promise<ShortcutInputs> => {
  if (!features.shortcuts) return NO_SHORTCUT_INPUTS;
  const db = publicDb();
  const [brief, weekly] = await Promise.all([
    features.brief_regular ? rowsOf<{ publish_at: string }>(db.from("public_brief_issues").select("publish_at").order("publish_at", { ascending: false }).limit(1), "최신 브리핑 호") : Promise.resolve([]),
    features.realestate_weekly ? rowsOf<{ issue_id: number }>(db.from("public_realestate_weekly").select("issue_id").limit(1), "이번 주 재테크 포인트") : Promise.resolve([]),
  ]);
  return { briefHref: brief[0] ? `/brief/${issueSlug(new Date(brief[0].publish_at))}` : null, weeklyOpen: weekly.length > 0 };
});
