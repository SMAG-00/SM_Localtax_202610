import type { Metadata } from "next";
import { WeeklyIssueForm, WeeklyItemsForm } from "@/components/admin/WeeklyForms";
import { EmptyNote, MONO, PageTitle, Panel } from "@/components/admin/ui";
import { can } from "@/lib/access";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { dbError } from "@/lib/server/http";
import { isoWeekKst, weekLabel } from "@/lib/server/public/realestate-weekly-logic";

// 금주 부동산 재테크 (/admin/realestate-weekly, PR-15) - 기자·편집 책임자가 호를 만들고 기사 3~7건과 세금 관점 한 줄을 넣고, 편집 책임자가 승인 발행합니다.
// 발행 권고 시각은 금요일 10:00(한국 시각)이며 발행은 편집자가 직접 합니다(정시 작업 없음).
export const metadata: Metadata = { title: "금주 부동산 재테크" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = { draft: "초안", approved: "승인됨", published: "발행됨", withdrawn: "철회됨" };
type Issue = { id: number; week: string; status: string; edited_by: string; published_at: string | null };
type Item = { issue_id: number; article_id: number; rank: number; tax_items: string[]; point: string };

export default async function RealestateWeeklyAdminPage() {
  const viewer = await pageViewer();
  requirePage(viewer, ["weekly_point.edit", "weekly_point.publish"]);
  const db = serviceDb();
  const [issues, items] = await Promise.all([
    db.from("realestate_weekly_issues").select("id, week, status, edited_by, published_at").order("week", { ascending: false }).limit(30),
    db.from("realestate_weekly_items").select("issue_id, article_id, rank, tax_items, point").order("rank"),
  ]);
  for (const r of [issues, items]) if (r.error) throw dbError(r.error, "금주 부동산 재테크 화면");
  const byIssue = new Map<number, Item[]>();
  for (const it of (items.data ?? []) as Item[]) byIssue.set(it.issue_id, [...(byIssue.get(it.issue_id) ?? []), it]);
  const canPublish = can(viewer, "weekly_point.publish");
  const list = (issues.data ?? []) as Issue[];
  return (
    <div className="space-y-8">
      <PageTitle title="금주 부동산 재테크" />
      <Panel id="weekly-new" title="새 호">
        <WeeklyIssueForm defaultWeek={isoWeekKst(new Date(nowIso()))} />
      </Panel>
      <Panel id="weekly-list" title="호 목록">
        {list.length === 0 ? (
          <EmptyNote>호가 없습니다. 발행된 호가 없으면 공개 화면과 바로가기는 보이지 않습니다.</EmptyNote>
        ) : (
          <ul className="space-y-6" data-part="weekly-issues">
            {list.map((i) => (
              <li key={i.id} className="space-y-2 border-b border-navy-100 pb-4" data-week={i.week}>
                <p className="text-[15px] font-bold">
                  <span className={MONO}>{i.week}</span> · {weekLabel(i.week) ?? ""} · {STATUS_LABEL[i.status] ?? i.status} · 작성 {i.edited_by}
                </p>
                <WeeklyItemsForm
                  issueId={i.id}
                  status={i.status}
                  canPublish={canPublish}
                  initial={(byIssue.get(i.id) ?? []).map((x) => ({ articleId: Number(x.article_id), taxItems: x.tax_items, point: x.point }))}
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
