import type { Metadata } from "next";
import { SourceTermsForm } from "@/components/admin/ReviewControls";
import { EmptyNote, MONO, PageTitle, Panel, ToneChip } from "@/components/admin/ui";
import { isoToKstDateTime } from "@/lib/admin/form-utils";
import { TERMS_LABELS, type TermsStatus } from "@/lib/review/rules";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { dbError } from "@/lib/server/http";

// 수집 파이프라인 (/admin/pipelines, PRD-02 PIPE-01~09 · AIOPS-06 · W10-c) - 관리자(pipeline.manage).
//  · 원천 등록부: 이용 조건(미확인·허용·링크만·금지)과 실응답 견본 계약 확인. 허용 + 견본 확인이 모두 있어야 수집기가 돕니다(미확인 원천 실행 0)
//  · 최근 실행(pipeline-law·pipeline-docs)의 건너뜀 이유·수, 법령 감시 상태(감시 중·오류), 열린 수집 실패 항목
//  · 인증키(LAW_API_OC)는 이 화면 어디에도 나오지 않습니다 - 설정 여부(있음·없음)도 서버가 알려 주지 않습니다
export const metadata: Metadata = { title: "수집 파이프라인" };
export const dynamic = "force-dynamic";

interface SourceRow {
  key: string; name: string; kind: string; api_target: string | null; priority: string;
  terms_status: TermsStatus; terms_note: string | null; terms_checked_at: string | null; contract_verified_at: string | null;
}
interface RunRow { id: number; job: string; trigger: string; status: string; started_at: string; detail: Record<string, unknown> | null; error: string | null }

export default async function PipelinesPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "pipeline.manage");
  const db = serviceDb();
  const [sources, runs, states, failures] = await Promise.all([
    db.from("data_sources").select("key, name, kind, api_target, priority, terms_status, terms_note, terms_checked_at, contract_verified_at").order("priority").order("key"),
    db.from("agent_runs").select("id, job, trigger, status, started_at, detail, error").in("job", ["pipeline-law", "pipeline-docs"]).order("started_at", { ascending: false }).limit(10),
    db.from("law_watch_state").select("status"),
    db.from("review_items").select("id", { count: "exact", head: true }).eq("kind", "pipeline_failure").in("status", ["drafted", "in_review", "failed"]),
  ]);
  for (const [r, ctx] of [[sources, "data_sources"], [runs, "agent_runs"], [states, "law_watch_state"], [failures, "review_items"]] as const) if (r.error) throw dbError(r.error, ctx);
  const sourceRows = (sources.data ?? []) as SourceRow[];
  const runRows = (runs.data ?? []) as RunRow[];
  const stateRows = (states.data ?? []) as { status: string }[];
  const watching = stateRows.filter((s) => s.status === "watching").length;
  const errors = stateRows.filter((s) => s.status === "api_error").length;

  return (
    <>
      <PageTitle title="수집 파이프라인" description="법령·행정규칙·해석·결정례 수집기가 돌 수 있는 원천을 관리합니다. 이용 조건이 허용이고 실응답 견본 계약 시험을 통과한 원천만 돕니다." />
      <div className="space-y-8">
        <Panel id="sources" title="수집 원천">
          <ul className="space-y-4" data-testid="pipeline-sources">
            {sourceRows.map((s) => {
              const runnable = s.terms_status === "allowed" && s.contract_verified_at !== null;
              return (
                <li key={s.key} data-source-key={s.key} data-terms={s.terms_status} data-runnable={runnable ? "true" : "false"} className="rounded-xl border border-navy-100 p-4">
                  <p className="text-[15px] font-bold text-navy-900">
                    <ToneChip tone={s.terms_status === "allowed" ? "emerald" : s.terms_status === "unchecked" ? "amber" : "rose"}>{TERMS_LABELS[s.terms_status]}</ToneChip>{" "}
                    <ToneChip tone={runnable ? "emerald" : "plain"}>{runnable ? "수집 가능" : "수집 안 함"}</ToneChip> {s.name} <span className={MONO}>{s.key}</span>
                    {s.priority === "p1" && <span className="ml-2 text-[13px] font-normal text-navy-600">(P1)</span>}
                  </p>
                  <p className={`${MONO} mt-1 text-navy-600`}>
                    대상 {s.api_target ?? "확인 필요"} · 이용 조건 확인 {s.terms_checked_at ? isoToKstDateTime(s.terms_checked_at) : "—"} · 견본 계약 {s.contract_verified_at ? isoToKstDateTime(s.contract_verified_at) : "미확인"}
                  </p>
                  {s.terms_note && <p className="mt-1 text-[14px] text-navy-700">근거: {s.terms_note}</p>}
                  <SourceTermsForm sourceKey={s.key} status={s.terms_status} />
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel id="law-watch" title="법령 감시">
          <p className="text-[15px] text-navy-800" data-testid="pipeline-law-state">감시 중 {watching}건 · 오류 {errors}건 · 열린 수집 실패 항목 {failures.count ?? 0}건</p>
        </Panel>

        <Panel id="runs" title="최근 실행 10건">
          {runRows.length === 0 ? (
            <EmptyNote>아직 실행 기록이 없습니다. 기능 키 pipelines를 켜고 원천 조건을 갖추면 하루 한 번 실행됩니다.</EmptyNote>
          ) : (
            <ul className="space-y-2 text-[14px] text-navy-800" data-testid="pipeline-runs">
              {runRows.map((r) => (
                <li key={r.id} data-run-id={r.id}>
                  <span className={MONO}>{isoToKstDateTime(r.started_at)}</span> {r.job} · {r.status === "succeeded" ? "성공" : r.status === "failed" ? "실패" : "실행 중"} ({r.trigger})
                  {r.detail ? <span className={`${MONO} text-navy-600`}>{` · ${JSON.stringify(r.detail).slice(0, 240)}`}</span> : null}
                  {r.error ? <span className="text-rose-800">{` · ${r.error.slice(0, 200)}`}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
