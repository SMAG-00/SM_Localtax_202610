import type { Metadata } from "next";
import { CampaignActions, CampaignForm } from "@/components/admin/CampaignForms";
import { EmptyNote, MONO, PageTitle, Panel } from "@/components/admin/ui";
import { maskSmallCount } from "@/lib/campaigns/input";
import { can } from "@/lib/access";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { dbError } from "@/lib/server/http";

// 캠페인 랜딩 (/admin/campaigns, GROW-03·04·05) - 편집 책임자·광고 담당이 작성·제출, 관리자가 검토 기록·승인·철회.
// 집계(최근 28일)는 캠페인별 열람·버튼 누름 수뿐이고 5건 미만은 가린다. 콘텐츠 -> 도구 전환(/admin/calc-links)과 분모가 다르다.
export const metadata: Metadata = { title: "캠페인 랜딩" };
export const dynamic = "force-dynamic";

const DAY = 86_400_000;
const STATUS_LABEL: Record<string, string> = { draft: "초안", submitted: "제출됨", approved: "승인됨", withdrawn: "철회됨" };
type Row = { id: number; campaign_key: string; title: string; status: string; channel: string; primary_target: string; secondary_target: string | null; starts_at: string; ends_at: string; created_by: string };

export default async function CampaignsPage() {
  const viewer = await pageViewer();
  requirePage(viewer, ["campaign.edit", "campaign.approve"]);
  const db = serviceDb();
  const since = new Date(Date.parse(nowIso()) - 28 * DAY).toISOString();
  const [rows, events] = await Promise.all([
    db.from("campaign_landings").select("id, campaign_key, title, status, channel, primary_target, secondary_target, starts_at, ends_at, created_by").order("id", { ascending: false }).limit(100),
    db.from("analytics_events").select("name, props").in("name", ["campaign_landing_viewed", "campaign_cta_clicked"]).eq("is_bot", false).eq("is_staff", false).gte("occurred_at", since).limit(20000),
  ]);
  for (const r of [rows, events]) if (r.error) throw dbError(r.error, "캠페인 화면");
  const stat = new Map<string, { views: number; primary: number; secondary: number }>();
  for (const e of (events.data ?? []) as { name: string; props: Record<string, unknown> | null }[]) {
    const key = String(e.props?.campaign ?? "");
    if (!key) continue;
    const s = stat.get(key) ?? { views: 0, primary: 0, secondary: 0 };
    if (e.name === "campaign_landing_viewed") s.views += 1;
    else if (e.props?.cta === "secondary") s.secondary += 1;
    else s.primary += 1;
    stat.set(key, s);
  }
  const canApprove = can(viewer, "campaign.approve");
  const canReview = can(viewer, "campaign.review_record");
  const list = (rows.data ?? []) as Row[];
  return (
    <div className="space-y-8">
      <PageTitle title="캠페인 랜딩" />
      <Panel id="campaign-new" title="새 캠페인 (초안)">
        <CampaignForm />
      </Panel>
      <Panel id="campaign-list" title="캠페인 목록">
        {list.length === 0 ? (
          <EmptyNote>캠페인이 없습니다. 캠페인이 없으면 /go/* 주소는 모두 404입니다.</EmptyNote>
        ) : (
          <ul className="space-y-6" data-part="campaigns">
            {list.map((c) => {
              const s = stat.get(c.campaign_key) ?? { views: 0, primary: 0, secondary: 0 };
              return (
                <li key={c.id} className="space-y-2 border-b border-navy-100 pb-4" data-campaign-key={c.campaign_key}>
                  <p className="text-[15px] font-bold">
                    <span className={MONO}>/go/{c.campaign_key}</span> · {c.title} · {STATUS_LABEL[c.status] ?? c.status}
                  </p>
                  <p className="text-[13px] text-navy-600">
                    채널 {c.channel} · 도착 {c.primary_target}
                    {c.secondary_target ? ` + ${c.secondary_target}` : ""} · {c.starts_at.slice(0, 10)} ~ {c.ends_at.slice(0, 10)} · 작성 {c.created_by}
                  </p>
                  <p className="text-[13px]" data-part="campaign-stats">
                    최근 28일 열람 {maskSmallCount(s.views)} · 주 버튼 {maskSmallCount(s.primary)} · 보조 {maskSmallCount(s.secondary)}
                  </p>
                  <CampaignActions id={c.id} status={c.status} canApprove={canApprove} canReview={canReview} />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
