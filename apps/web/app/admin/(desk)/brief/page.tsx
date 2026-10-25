import type { Metadata } from "next";
import { ActiveToggle, CalendarForm, OngoingForm } from "@/components/admin/BriefSourcesForms";
import { kstDate, ongoingNeedsRefresh } from "@ltr/workflows/ops";
import { ApplyAiDraftButton, IssueControls, NewDraftButton } from "@/components/admin/BriefControls";
import { EmptyNote, MONO, PageTitle, Panel, ToneChip } from "@/components/admin/ui";
import { isoToKstDateTime } from "@/lib/admin/form-utils";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";

// 브리핑 (/admin/brief, W10-e - BRIEF-01~04) - 편집 책임자·관리자(review_item.decide).
//  · 호별 초안을 고치고, 검사기 8종을 돌려 차단 0이 되면 승인합니다. 경고는 확인 표시 뒤에 승인됩니다. AI가 쓴 항목은 확인(reviewed) 전에는 승인되지 않습니다
//  · 발행은 정시 작업만 합니다 - 승인해도 발행 시각 전에는 공개되지 않습니다
export const metadata: Metadata = { title: "브리핑" };
export const dynamic = "force-dynamic";

const TONE = { draft: "navy", approved: "amber", published: "emerald", withdrawn: "rose" } as const;
const LABEL = { draft: "초안", approved: "승인(발행 대기)", published: "발행", withdrawn: "철회" } as const;

interface Finding { check: string; level: string; where: string; message: string }
interface Issue {
  id: number; issue_no: number; title: string; publish_at: string; status: keyof typeof LABEL; has_ad: boolean; corners: unknown;
  check_report: { blocking: number; warnings: number; findings: Finding[]; checked_at: string } | null;
}

export default async function BriefAdminPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "review_item.decide");
  const db = serviceDb();
  const [issues, pending, cal, ong, tgt, src] = await Promise.all([
    db.from("brief_issues").select("id, issue_no, title, publish_at, status, has_ad, corners, check_report").order("issue_no", { ascending: false }).limit(30),
    db.from("review_items").select("id, title, payload, status, kind").eq("status", "approved").eq("kind", "ai_draft").order("id").limit(50),
    db.from("brief_calendar_items").select("id, text, is_always, is_yearly, start_md, end_md, start_on, end_on, active").order("id"),
    db.from("brief_ongoing_items").select("id, name, stage, as_of, active").order("id"),
    db.from("brief_collect_targets").select("key, source_key, api_target, queries, enabled").order("key"),
    db.from("data_sources").select("key, terms_status, contract_verified_at"),
  ]);
  const today = kstDate(new Date());
  const calRows = (cal.data ?? []) as { id: number; text: string; is_always: boolean; is_yearly: boolean; start_md: string | null; end_md: string | null; start_on: string | null; end_on: string | null; active: boolean }[];
  const ongRows = (ong.data ?? []) as { id: number; name: string; stage: string; as_of: string; active: boolean }[];
  const tgtRows = (tgt.data ?? []) as { key: string; source_key: string; api_target: string; queries: string[]; enabled: boolean }[];
  const srcMap = new Map(((src.data ?? []) as { key: string; terms_status: string; contract_verified_at: string | null }[]).map((s) => [s.key, s]));
  const rows = (issues.data ?? []) as unknown as Issue[];
  const aiApproved = (pending.data ?? []) as { id: number; title: string; payload: { failed?: boolean } }[];
  return (
    <>
      <PageTitle title="브리핑" description="호별 초안을 고치고 검사기 8종을 통과시킨 뒤 승인합니다. 승인해도 발행 시각(한국 시간) 전에는 공개되지 않습니다.">
        <NewDraftButton />
      </PageTitle>
      <div className="space-y-8">
        <Panel id="ai-approved" title={`승인된 AI 초안 ${aiApproved.length}건`} description="검수 큐에서 승인한 AI 초안만 초안 호에 넣을 수 있습니다. 넣은 항목은 검수 완료로 표시됩니다.">
          {aiApproved.length === 0 ? <EmptyNote>반영 대기 중인 초안이 없습니다.</EmptyNote> : (
            <ul className="space-y-2" data-testid="brief-ai-approved">
              {aiApproved.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 text-[15px] text-navy-900">
                  <span className={MONO}>#{r.id}</span> {r.title}
                  {r.payload.failed ? <ToneChip tone="rose">요약 실패 - 검수자 작성</ToneChip> : <ApplyAiDraftButton itemId={r.id} />}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel id="brief-calendar" title={`알아둘 날짜 ${calRows.length}건`} description="호의 '알아둘 날짜' 코너에 발행일부터 30일 안에 걸리는 날짜가 최대 7줄 들어갑니다.">
          {calRows.length === 0 ? <EmptyNote>아직 입력한 날짜가 없습니다.</EmptyNote> : (
            <ul className="space-y-2" data-testid="brief-calendar-list">
              {calRows.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 text-[15px] text-navy-900">
                  <ToneChip tone={c.active ? "emerald" : "navy"}>{c.is_always ? "상시" : c.is_yearly ? `매년 ${c.start_md}${c.end_md ? ` ~ ${c.end_md}` : ""}` : `${c.start_on}${c.end_on ? ` ~ ${c.end_on}` : ""}`}</ToneChip> {c.text}
                  <ActiveToggle op="calendar_active" id={c.id} active={c.active} label={`날짜 ${c.id}`} />
                </li>
              ))}
            </ul>
          )}
          <CalendarForm />
        </Panel>
        <Panel id="brief-ongoing" title={`진행 중 개정안 ${ongRows.length}건`} description="국회 제출·통과·공포를 확인하면 단계와 기준일을 고칩니다. 기준일이 45일을 넘으면 확인 표시가 붙습니다.">
          {ongRows.length === 0 ? <EmptyNote>아직 입력한 개정안이 없습니다.</EmptyNote> : (
            <ul className="space-y-2" data-testid="brief-ongoing-list">
              {ongRows.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-2 text-[15px] text-navy-900">
                  <ToneChip tone={o.active ? "emerald" : "navy"}>{o.stage}</ToneChip> {o.name} <span className={MONO}>기준일 {o.as_of}</span>
                  {ongoingNeedsRefresh({ id: o.id, name: o.name, stage: o.stage, asOf: o.as_of }, today) && <ToneChip tone="amber">단계 다시 확인</ToneChip>}
                  <ActiveToggle op="ongoing_active" id={o.id} active={o.active} label={`개정안 ${o.id}`} />
                </li>
              ))}
            </ul>
          )}
          <OngoingForm />
        </Panel>
        <Panel id="brief-targets" title={`수집 대상 ${tgtRows.length}개`} description="대상을 켜도 원천의 이용 조건 확인과 견본 계약 확인이 없으면 수집 요청은 0입니다.">
          {tgtRows.length === 0 ? <EmptyNote>수집 대상이 없습니다.</EmptyNote> : (
            <ul className="space-y-2" data-testid="brief-targets-list">
              {tgtRows.map((t) => {
                const s = srcMap.get(t.source_key);
                const runnable = s?.terms_status === "allowed" && !!s.contract_verified_at;
                return (
                  <li key={t.key} className="flex flex-wrap items-center gap-2 text-[15px] text-navy-900">
                    <span className={MONO}>{t.key}</span> {t.api_target} · 질의 {t.queries.length}개
                    <ToneChip tone={runnable ? "emerald" : "rose"}>{runnable ? "원천 허용됨" : `원천 ${s?.terms_status ?? "없음"} - 요청 0`}</ToneChip>
                    <ActiveToggle op="target_enabled" keyName={t.key} active={t.enabled} label={`수집 대상 ${t.key}`} />
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <Panel id="issues" title={`호 ${rows.length}개`}>
          {rows.length === 0 ? <EmptyNote>아직 호가 없습니다. [다음 호 초안 만들기]로 시작하세요.</EmptyNote> : (
            <ul className="space-y-6" data-testid="brief-issues">
              {rows.map((r) => (
                <li key={r.id} data-issue-id={r.id} data-status={r.status} className="rounded-xl border border-navy-100 p-4">
                  <p className="text-[15px] font-bold text-navy-900">
                    <ToneChip tone={TONE[r.status]}>{LABEL[r.status]}</ToneChip> {r.title}
                  </p>
                  <p className={`${MONO} mt-1 text-navy-600`}>#{r.issue_no} · 발행 시각 {isoToKstDateTime(r.publish_at)}</p>
                  {r.check_report ? (
                    <div className="mt-2 text-[14px] text-navy-800" data-testid="brief-report">
                      <p>
                        검사 {isoToKstDateTime(r.check_report.checked_at)} - 차단 {r.check_report.blocking}건 · 경고 {r.check_report.warnings}건
                      </p>
                      {r.check_report.findings.length > 0 && (
                        <ul className="mt-1 list-disc pl-5">
                          {r.check_report.findings.map((f, i) => (
                            <li key={i}>
                              <ToneChip tone={f.level === "block" ? "rose" : "amber"}>{f.level === "block" ? "차단" : "경고"}</ToneChip> {f.where}: {f.message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : r.status === "draft" ? (
                    <p className="mt-2 text-[14px] text-navy-600">검사 전입니다 (본문을 고치면 보고서가 비워집니다).</p>
                  ) : null}
                  <IssueControls issue={{ id: r.id, title: r.title, has_ad: r.has_ad, status: r.status, corners: r.corners }} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
