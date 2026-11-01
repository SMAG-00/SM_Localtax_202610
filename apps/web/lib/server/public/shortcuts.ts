import "server-only";
import { cache } from "react";
import type { Features } from "./constants";
import { publicDb, rowsOf } from "./db";
import { NO_SHORTCUT_INPUTS, type ShortcutInputs } from "./shortcuts-logic";

// 바로가기에 필요한 DB 값 (HOME-12) - 재테크 포인트 발행 여부. 바로가기는 메뉴라 이 값이 비어도 항목은 사라지지 않는다
// (재테크 포인트는 /realestate/weekly 준비 중 화면으로 간다). 최신법령·유권해석은 하위 분야 목록 고정 주소라 읽을 값이 없다 (주간 브리핑 호는 PO 2026-11-01 지움).
// 키가 꺼진 도착은 DB를 읽지 않는다 (공개 뷰는 키가 꺼지면 0행이라 결과는 같다)
export const readShortcutInputs = cache(async (features: Features): Promise<ShortcutInputs> => {
  if (!features.shortcuts) return NO_SHORTCUT_INPUTS;
  const weekly = features.realestate_weekly ? await rowsOf<{ issue_id: number }>(publicDb().from("public_realestate_weekly").select("issue_id").limit(1), "금주 부동산 재테크") : [];
  return { weeklyOpen: weekly.length > 0 };
});
