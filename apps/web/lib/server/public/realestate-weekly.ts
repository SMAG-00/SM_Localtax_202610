import "server-only";
import { publicDb, rowsOf } from "./db";
import { groupWeekly, type WeeklyIssue, type WeeklyItemRow } from "./realestate-weekly-logic";

// 금주 부동산 재테크 공개 읽기 (PR-15) - 공개 뷰 public_realestate_weekly만. 기능 키가 꺼지면 뷰가 0행이라 null(404)
const COLUMNS = "issue_id, week, published_at, rank, tax_items, point, article_id, slug, title";

/** 호 하나 - week가 없으면 최신 호. 없으면 null */
export async function getRealestateWeekly(week?: string): Promise<WeeklyIssue | null> {
  let q = publicDb().from("public_realestate_weekly").select(COLUMNS);
  if (week) q = q.eq("week", week);
  const rows = await rowsOf<WeeklyItemRow>(q.order("published_at", { ascending: false }).limit(200), "금주 부동산 재테크");
  return groupWeekly(rows)[0] ?? null;
}
