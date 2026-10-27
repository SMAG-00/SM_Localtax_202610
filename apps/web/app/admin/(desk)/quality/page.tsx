import type { Metadata } from "next";
import { OpButton, OpForm } from "@/components/admin/LocalNewsControls";
import { DataTable, EmptyNote, MONO, PageTitle, Panel, TD, ToneChip } from "@/components/admin/ui";
import { can } from "@/lib/access";
import { ALERT_LABEL, VERDICT_LABEL, VERDICTS } from "@/lib/eval/quality";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { loadQualityBoard } from "@/lib/server/quality/service";

// 품질 콘솔 (/admin/quality - W12-e e5, PRD-04 QUAL-01~04, docs/dev/W12-e_설계.md 6장).
//  · 경보(차단율 5분 20% 초과·예산 80%/100%·표본 감수 부족)는 확인(ack) 전까지 열린 상태로 남습니다.
//  · 표본 판정은 사람이 합니다. 질문·답변은 마스킹본만 보이고, 평가셋 후보 표시는 문항 등록(익명화 검토) 전 단계의 표시일 뿐입니다.
export const metadata: Metadata = { title: "품질 콘솔" };
export const dynamic = "force-dynamic";

const ENDPOINT = "/api/admin/quality";
const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") : "-");

export default async function QualityPage() {
  const viewer = await pageViewer();
  requirePage(viewer, ["quality.review"]);
  const canRunLive = can(viewer, "eval.gate_approve");
  const b = await loadQualityBoard(serviceDb());
  const open = b.alerts.filter((a) => !a.acked_at);
  return (
    <>
      <PageTitle title="품질 콘솔" description="지방세봇의 경보, 검증기 차단 기록, 실시간 조회 기록, 질문당 비용, 표본 판정을 한곳에서 봅니다. 예산 값은 설정(ask_budget)에서 PO가 넣기 전에는 예산 경보가 꺼져 있습니다." />
      <div className="space-y-8">
        <Panel id="q-alerts" title={`경보 (열린 경보 ${open.length}건)`} description="확인한 경보는 닫힙니다. 같은 사유의 경보는 한 번만 만들어집니다.">
          <OpButton id="q-run-daily" op="run_daily" label="지금 검사 실행" ctx={{}} endpoint={ENDPOINT} />
          {b.alerts.length === 0 ? <EmptyNote>경보가 없습니다.</EmptyNote> : (
            <DataTable caption="품질 경보" head={["번호", "종류", "내용", "시각", "상태", "처리"]}>
              {b.alerts.map((a) => (
                <tr key={a.id} data-alert-id={a.id} data-kind={a.kind} data-open={a.acked_at ? "false" : "true"}>
                  <td className={`${TD} ${MONO}`}>{a.id}</td>
                  <td className={TD}>{ALERT_LABEL[a.kind] ?? a.kind}</td>
                  <td className={`${TD} ${MONO}`}>{JSON.stringify(a.detail)}</td>
                  <td className={`${TD} ${MONO}`}>{when(a.created_at)}</td>
                  <td className={TD}><ToneChip tone={a.acked_at ? "plain" : "amber"}>{a.acked_at ? `확인 ${when(a.acked_at)}` : "열림"}</ToneChip></td>
                  <td className={TD}>{!a.acked_at && <OpButton id={`q-ack-${a.id}`} op="ack" label="확인" ctx={{ alert_id: a.id }} endpoint={ENDPOINT} />}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>

        <Panel id="q-sample" title="표본 판정" description={`오늘 판정 ${b.judgedToday}건 (하루 50건 이상이 목표입니다). 판정은 사람만 남기며 고칠 수 없습니다.`}>
          {b.sample.length === 0 ? <EmptyNote>판정할 대화가 없습니다.</EmptyNote> : b.sample.map((s) => (
            <div key={s.message_id} data-message-id={s.message_id} className="rounded-xl border border-navy-100 p-4">
              <p className="text-[13px] text-navy-600">{`답변 ${s.message_id} · ${s.scope} · ${s.tier} · ${when(s.created_at)}`}</p>
              <p className="mt-1 whitespace-pre-wrap text-[15px]">{s.question_masked ?? "-"}</p>
              <p className="mt-1 whitespace-pre-wrap text-[14px] text-navy-700">{s.answer_masked ?? "-"}</p>
              <OpForm id={`q-judge-${s.message_id}`} op="judge" label={`답변 ${s.message_id} 판정`} submit="판정 저장" endpoint={ENDPOINT} ctx={{ message_id: s.message_id }} fields={[
                { name: "verdict", label: "판정", type: "select", options: [{ value: "", label: "고르세요" }, ...VERDICTS.map((v) => ({ value: v, label: VERDICT_LABEL[v] }))], required: true },
                { name: "note", label: "메모 (500자 이하, 번호·이메일 금지)" },
                { name: "eval_candidate", label: "평가셋 후보로 표시", type: "check" },
              ]} />
            </div>
          ))}
        </Panel>

        <Panel id="q-blocked" title="검증기 차단 로그 (최근 50건)">
          {b.blocked.length === 0 ? <EmptyNote>차단 기록이 없습니다.</EmptyNote> : (
            <DataTable caption="검증기 차단" head={["답변", "시각", "범위", "등급", "종류", "사유", "재생성", "실패 코드"]}>
              {b.blocked.map((r) => (
                <tr key={String(r.message_id)}>
                  <td className={`${TD} ${MONO}`}>{String(r.message_id)}</td><td className={`${TD} ${MONO}`}>{when(String(r.created_at))}</td><td className={TD}>{String(r.scope)}</td><td className={TD}>{String(r.tier)}</td>
                  <td className={TD}>{String(r.kind)}</td><td className={TD}>{String(r.fallback_reason ?? "-")}</td><td className={TD}>{r.regenerated ? "예" : "아니오"}</td><td className={`${TD} ${MONO}`}>{((r.failure_codes as string[]) ?? []).join(", ") || "-"}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>

        <Panel id="q-live" title="실시간 조회 기록 (최근 50건)">
          {b.live.length === 0 ? <EmptyNote>실시간 조회 기록이 없습니다.</EmptyNote> : (
            <DataTable caption="실시간 조회" head={["답변", "시각", "도구", "성공", "지연(ms)", "대상", "스냅샷"]}>
              {b.live.map((r) => (
                <tr key={String(r.tool_call_id)}>
                  <td className={`${TD} ${MONO}`}>{String(r.message_id)}</td><td className={`${TD} ${MONO}`}>{when(String(r.created_at))}</td><td className={TD}>{String(r.tool)}</td><td className={TD}>{r.ok ? "예" : "아니오"}</td>
                  <td className={`${TD} ${MONO}`}>{String(r.latency_ms)}</td><td className={TD}>{String(r.target_type ?? "-")}</td><td className={`${TD} ${MONO}`}>{String(r.snapshot_id ?? "-")}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>

        <Panel id="q-cost" title="질문당 비용 (최근 30건)">
          {b.cost.length === 0 ? <EmptyNote>사용 기록이 없습니다.</EmptyNote> : (
            <DataTable caption="일별 비용" head={["날짜", "등급", "질문 수", "비용(원)", "질문당(원)"]}>
              {b.cost.map((r) => (
                <tr key={`${r.day}-${r.tier}`}><td className={`${TD} ${MONO}`}>{r.day}</td><td className={TD}>{r.tier}</td><td className={`${TD} ${MONO}`}>{r.turns}</td><td className={`${TD} ${MONO}`}>{r.cost}</td><td className={`${TD} ${MONO}`}>{r.cost_per_turn}</td></tr>
              ))}
            </DataTable>
          )}
        </Panel>

        <Panel id="q-run" title="평가셋 실행" description="가짜 모델 또는 이전 실제 API 답변 재사용으로 회귀를 돌립니다. 실제 API 실행은 비용이 들기 때문에 관리자만 누를 수 있습니다.">
          {b.frozenSets.length === 0 ? <EmptyNote>동결한 평가셋이 없습니다.</EmptyNote> : (
            <OpForm id="q-run-form" op="run_set" label="평가셋 실행" submit="실행" endpoint={ENDPOINT} fields={[
              { name: "set_id", label: `동결 평가셋 번호 (${b.frozenSets.map((s) => `${s.id}=${s.scope}/${s.version}`).join(", ")})`, required: true },
              { name: "source", label: "응답 출처", type: "select", options: [{ value: "fake", label: "가짜 모델" }, { value: "fixture", label: "실응답 견본 재사용" }, ...(canRunLive ? [{ value: "live_api", label: "실제 API (비용 발생)" }] : [])], required: true },
              { name: "list", label: "목록", type: "select", options: [{ value: "base", label: "판 전체 (기본·확장은 판 범위로 구분)" }, { value: "index_exclusion", label: "색인 제외 문항만" }] },
            ]} />
          )}
        </Panel>
      </div>
    </>
  );
}
