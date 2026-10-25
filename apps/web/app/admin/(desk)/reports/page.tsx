import type { Metadata } from "next";
import { DataTable, EmptyNote, MONO, PageTitle, Panel, TD, ToneChip } from "@/components/admin/ui";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { dbError } from "@/lib/server/http";

// 프리미엄 리포트 (/admin/reports, BIZ-07 · W11-f) - 편집 책임자·관리자(report.publish). 읽기 보드입니다.
//  · 쓰기(메타·본문·발행)는 /api/admin/reports. 발행은 기준일·출처·세무 감수 서명·편집 승인·법률(자본시장법) 검토 기록이 모두 있어야 DB가 받습니다
//  · 본문 글자는 이 화면에 나오지 않습니다 (미리보기 길이·판매 권리 확인 여부만)
export const metadata: Metadata = { title: "프리미엄 리포트" };
export const dynamic = "force-dynamic";

interface ReportRow {
  slug: string; title: string; period_label: string; as_of: string | null; status: string;
  tax_reviewer: string | null; editor_approved_by: string | null; legal_review_ref: string | null;
}

export default async function ReportsAdminPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "report.publish");
  const db = serviceDb();
  const [reports, bodies] = await Promise.all([
    db.from("premium_reports").select("slug, title, period_label, as_of, status, tax_reviewer, editor_approved_by, legal_review_ref").order("id", { ascending: false }).limit(200),
    db.from("paid_bodies").select("ref_key, preview, sale_allowed").eq("kind", "premium_report").limit(200),
  ]);
  for (const [r, ctx] of [[reports, "premium_reports"], [bodies, "paid_bodies"]] as const) if (r.error) throw dbError(r.error, ctx);
  const body = new Map(((bodies.data ?? []) as Array<{ ref_key: string; preview: string; sale_allowed: boolean }>).map((b) => [b.ref_key, b]));
  const rows = (reports.data ?? []) as ReportRow[];
  return (
    <div className="grid gap-8">
      <PageTitle title="프리미엄 리포트" description="분기 리포트의 기록 현황입니다. 쓰기는 /api/admin/reports 로 합니다." />
      <Panel id="reports" title="리포트">
        {rows.length === 0 ? <EmptyNote>등록된 리포트가 없습니다.</EmptyNote> : (
          <DataTable caption="리포트 목록" head={["리포트", "분기", "상태", "기준일", "세무 감수", "편집 승인", "법률 검토", "본문", "판매 권리"]}>
            {rows.map((r) => {
              const b = body.get(r.slug);
              return (
                <tr key={r.slug}>
                  <td className={TD}>{r.title} <span className={MONO}>{r.slug}</span></td>
                  <td className={TD}>{r.period_label}</td>
                  <td className={TD}><ToneChip tone={r.status === "published" ? "navy" : "plain"}>{r.status}</ToneChip></td>
                  <td className={TD}>{r.as_of ?? "빈 칸"}</td>
                  <td className={TD}>{r.tax_reviewer ? "기록됨" : "빈 칸"}</td>
                  <td className={TD}>{r.editor_approved_by ? "기록됨" : "빈 칸"}</td>
                  <td className={TD}>{r.legal_review_ref ? "기록됨" : "빈 칸"}</td>
                  <td className={TD}>{b ? `저장됨 (미리보기 ${b.preview.length}자)` : "없음"}</td>
                  <td className={TD}>{b?.sale_allowed ? "확인됨" : "미확인"}</td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Panel>
    </div>
  );
}
