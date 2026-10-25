// 금주 부동산 재테크 (PR-15, W10-i i3) - 순수 함수 (시험 realestate-weekly-logic.test.ts)
//  · 한 호 = 3~7건. 기사마다 세금 관점 한 줄(60자 이하)과 관련 세목 1개 이상. 가격·수익률·추천·투자 권유 표현과 세액(숫자 + 원)은 발행 전에 막는다
//  · 발행 함수(DB publish_realestate_weekly)가 건수·공개·분야·주를 한 번 더 본다. 여기는 편집 화면과 공개 화면이 같은 규칙을 쓴다
import { pointLineProblems } from "@ltr/editorial";

export const WEEKLY_MIN_ITEMS = 3;
export const WEEKLY_MAX_ITEMS = 7;
export const WEEKLY_POINT_MAX = 60;
/** 자본시장법 - 투자 권유로 읽히는 표현 (PRD-00 8.8 금지 표현 가운데 이 화면에 해당하는 것). 운영 사전의 금지 표현과 합쳐 쓴다 */
export const WEEKLY_INVESTMENT_PHRASES: readonly string[] = ["투자 유망", "지금 사야 할", "추천 단지", "수익 보장", "수익률", "시세 차익", "급등", "상승 기대"];

export interface WeeklyItemRow {
  issue_id: number;
  week: string;
  published_at: string;
  rank: number;
  tax_items: string[];
  point: string;
  article_id: number;
  slug: string;
  title: string;
}
export interface WeeklyItem {
  rank: number;
  taxItems: string[];
  point: string;
  articleId: number;
  href: string;
  title: string;
}
export interface WeeklyIssue {
  issueId: number;
  week: string;
  publishedAt: string;
  items: WeeklyItem[];
}

/** 공개 뷰 행 -> 호 목록 (최신 발행 먼저). 건수가 3~7이 아닌 호는 화면에 올리지 않는다 (DB가 막지만 한 번 더) */
export function groupWeekly(rows: readonly WeeklyItemRow[]): WeeklyIssue[] {
  const by = new Map<number, WeeklyIssue>();
  for (const r of rows) {
    const issue = by.get(r.issue_id) ?? { issueId: r.issue_id, week: r.week, publishedAt: r.published_at, items: [] };
    issue.items.push({ rank: r.rank, taxItems: r.tax_items, point: r.point, articleId: r.article_id, href: `/news/${r.slug}`, title: r.title });
    by.set(r.issue_id, issue);
  }
  return [...by.values()]
    .map((i) => ({ ...i, items: i.items.sort((a, b) => a.rank - b.rank) }))
    .filter((i) => i.items.length >= WEEKLY_MIN_ITEMS && i.items.length <= WEEKLY_MAX_ITEMS)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || b.issueId - a.issueId);
}

/** 'yyyy-ww' -> 'yyyy년 ww주차' (모양이 틀리면 null) */
export function weekLabel(week: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(week);
  return m ? `${m[1]}년 ${Number(m[2])}주차` : null;
}

/** 편집 화면 저장·발행 전 검사 - 고칠 문장 목록 (없으면 발행 가능). forbidden = 운영 사전의 금지 표현 */
export function weeklyDraftProblems(items: readonly { point: string; taxItems: readonly string[] }[], forbidden: readonly string[] = []): string[] {
  const out: string[] = [];
  if (items.length < WEEKLY_MIN_ITEMS) out.push(`항목은 ${WEEKLY_MIN_ITEMS}건 이상이어야 합니다 (지금 ${items.length}건)`);
  if (items.length > WEEKLY_MAX_ITEMS) out.push(`항목은 ${WEEKLY_MAX_ITEMS}건 이하여야 합니다 (지금 ${items.length}건)`);
  const phrases = [...new Set([...WEEKLY_INVESTMENT_PHRASES, ...forbidden])];
  items.forEach((it, i) => {
    const n = i + 1;
    const point = it.point.trim();
    if (point === "") out.push(`${n}번 항목: 세금 관점 한 줄이 비어 있습니다`);
    if (point.length > WEEKLY_POINT_MAX) out.push(`${n}번 항목: 한 줄은 ${WEEKLY_POINT_MAX}자 이하여야 합니다`);
    if (it.taxItems.filter((t) => t.trim() !== "").length < 1) out.push(`${n}번 항목: 관련 세목을 1개 이상 적어 주세요`);
    for (const p of pointLineProblems([point], phrases)) out.push(`${n}번 항목: ${p.message}`);
  });
  return out;
}

/** 한국 시각 기준 ISO 주 'yyyy-ww' (월요일 시작) - DB 발행 함수의 to_char('IYYY-IW')와 같은 규칙 */
export function isoWeekKst(now: Date): string {
  const d = new Date(now.getTime() + 9 * 3_600_000);
  const day = (d.getUTCDay() + 6) % 7; // 월=0
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.floor((thursday.getTime() - jan1) / 86_400_000 / 7) + 1;
  return `${year}-${String(week).padStart(2, "0")}`;
}
