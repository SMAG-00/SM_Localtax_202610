import type { Metadata } from "next";
import { GuideForm, ToolTargetForm } from "@/components/admin/CalcAdminForms";
import { EmptyNote, MONO, PageTitle, Panel, ToneChip } from "@/components/admin/ui";
import { isoToKstDate } from "@/lib/admin/form-utils";
import { conversionRows, hiddenGuides } from "@/lib/calc/admin-helpers";
import { needsRecheck, type GuideRow } from "@/lib/calc/guide";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { dbError } from "@/lib/server/http";

// 계산기 연결 (/admin/calc-links, GROW-02 · WETAX-02) — 편집 책임자만(link.manage).
// ① 기사별 도구 지정(대상 도구 + 미리 채울 값) ② 콘텐츠 -> 도구 전환 보고서(최근 28일, 이벤트에는 콘텐츠 유형·도구뿐) ③ 위택스 이용 안내(출처·확인일·재확인 목록)
export const metadata: Metadata = { title: "계산기 연결" };
export const dynamic = "force-dynamic";

const DAY = 86_400_000;
const TOOL_LABEL: Record<string, string> = { acquisition: "취득세", holding: "재산세·종부세", refund: "환급 진단", compare: "비교" };

export default async function CalcLinksPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "link.manage");
  const db = serviceDb();
  const since = new Date(Date.parse(nowIso()) - 28 * DAY).toISOString();
  const [arts, targets, events, views, guides] = await Promise.all([
    db.from("articles").select("id, title").eq("status", "published").order("first_published_at", { ascending: false }).limit(100),
    db.from("article_tool_targets").select("article_id, tool, prefill, updated_at").order("updated_at", { ascending: false }),
    db.from("analytics_events").select("props").eq("name", "content_to_tool").eq("is_bot", false).eq("is_staff", false).gte("occurred_at", since).limit(20000),
    db.from("analytics_events").select("id", { count: "exact", head: true }).eq("name", "article_viewed").eq("is_bot", false).eq("is_staff", false).gte("occurred_at", since),
    db.from("wetax_guides").select("key, label, body, source, confirmed_on, active").order("sort"),
  ]);
  for (const r of [arts, targets, events, views, guides]) if (r.error) throw dbError(r.error, "계산기 연결 화면");
  const today = isoToKstDate(nowIso());
  const report = conversionRows((events.data ?? []) as { props: Record<string, unknown> | null }[], { article: views.count ?? 0 });
  const guideRows = (guides.data ?? []) as (GuideRow & { active: boolean })[];
  const titleOf = new Map((arts.data ?? []).map((a: { id: number; title: string }) => [Number(a.id), a.title]));
  const recheck = guideRows.filter((g) => needsRecheck(g, today));
  const hidden = hiddenGuides(guideRows);

  return (
    <div className="space-y-8">
      <PageTitle title="계산기 연결" />

      <Panel id="tool-targets" title="기사별 도구 지정 (GROW-02)">
        <ToolTargetForm articles={(arts.data ?? []).map((a: { id: number; title: string }) => ({ id: Number(a.id), title: a.title }))} />
        {(targets.data ?? []).length === 0 ? (
          <EmptyNote>지정한 기사가 없습니다.</EmptyNote>
        ) : (
          <ul className="mt-4 space-y-1 text-[14px]" data-part="tool-targets">
            {(targets.data as { article_id: number; tool: string; prefill: Record<string, unknown> }[]).map((t) => (
              <li key={t.article_id}>
                <span className={MONO}>{t.article_id}</span> {titleOf.get(Number(t.article_id)) ?? "(발행 기사 아님)"} → {TOOL_LABEL[t.tool] ?? t.tool}
                {Object.keys(t.prefill).length > 0 && <span className={`ml-2 ${MONO}`}>{Object.keys(t.prefill).join(", ")}</span>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel id="tool-conversion" title="콘텐츠 → 도구 전환 (최근 28일)">
        {report.length === 0 ? (
          <EmptyNote>전환 이벤트가 아직 없습니다.</EmptyNote>
        ) : (
          <table className="w-full text-[14px]" data-part="conversion-report">
            <thead className="text-left text-navy-600">
              <tr><th className="py-1">콘텐츠 유형</th><th className="py-1">도구</th><th className="py-1 text-right">이동</th><th className="py-1 text-right">열람</th><th className="py-1 text-right">전환율</th></tr>
            </thead>
            <tbody>
              {report.map((r) => (
                <tr key={`${r.contentKind}:${r.tool}`} className="border-t border-navy-100">
                  <td className="py-1">{r.contentKind}</td>
                  <td className="py-1">{TOOL_LABEL[r.tool] ?? r.tool}</td>
                  <td className={`py-1 text-right ${MONO}`}>{r.clicks}</td>
                  <td className={`py-1 text-right ${MONO}`}>{r.views ?? "—"}</td>
                  <td className={`py-1 text-right ${MONO}`}>{r.rate === null ? "—" : `${r.rate}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel id="wetax-guides" title="위택스 이용 안내 (WETAX-02)">
        {recheck.length > 0 && (
          <p data-part="guide-recheck" className="mb-3 text-[14px] font-bold">
            재확인 필요 {recheck.length}건: {recheck.map((g) => g.label).join(" · ")}
          </p>
        )}
        {hidden.length > 0 && <p className="mb-3 text-[14px]">출처·확인일이 없어 공개 화면에 나오지 않는 항목: {hidden.join(", ")}</p>}
        {guideRows.length === 0 ? (
          <EmptyNote>입력한 안내가 없습니다.</EmptyNote>
        ) : (
          <ul className="mb-4 space-y-1 text-[14px]">
            {guideRows.map((g) => (
              <li key={g.key} data-guide={g.key}>
                <span className={MONO}>{g.key}</span> {g.label} <ToneChip>{g.confirmed_on ?? "확인일 없음"}</ToneChip>
                {needsRecheck(g, today) && <ToneChip>재확인</ToneChip>}
              </li>
            ))}
          </ul>
        )}
        <GuideForm />
      </Panel>
    </div>
  );
}
