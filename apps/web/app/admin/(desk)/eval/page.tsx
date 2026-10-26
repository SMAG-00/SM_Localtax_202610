import type { Metadata } from "next";
import { OpButton, OpForm, type LnField } from "@/components/admin/LocalNewsControls";
import { DataTable, EmptyNote, MONO, PageTitle, Panel, TD, ToneChip } from "@/components/admin/ui";
import { can } from "@/lib/access";
import { SHORTFALL_LABEL, SCOPES, SCOPE_LABEL } from "@/lib/eval/gate";
import { FATAL_ERRORS, FATAL_LABEL, STATUS_LABEL, type FinalStatus } from "@/lib/eval/grading";
import { BEHAVIORS, BEHAVIOR_LABEL, CATEGORIES, CATEGORY_LABEL, CROSS_LABEL, EVAL_SCOPES, EVAL_SCOPE_LABEL, ORIGINS, ORIGIN_LABEL } from "@/lib/eval/rules";
import { actorOf } from "@/lib/server/audit";
import { loadEvalBoard } from "@/lib/server/eval/board";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";

// 평가·게이트 (/admin/eval - W12-e, PRD-04 EVAL-01·02·04, docs/dev/W12-e_설계.md).
//  · 문항·정답·필수 근거·금지 주장은 PO·감수위원이 이 화면에서 입력합니다. 개발 중에는 '[시험용]' 문항만 넣습니다.
//  · 채점은 2인 블라인드입니다 - 다른 채점자의 판정과 모델 이름은 보이지 않습니다. 갈리면 '미확정'으로 남고, 원문 재확인 기록 뒤에 3인째(외부 세무사 자문)를 받습니다.
//  · 공개 단계와 범위 플래그는 확정한 게이트 리포트로만 바뀝니다. 이 화면의 승인 버튼은 DB 승인 함수를 부를 뿐이며, 함수가 거부하면 사유와 감사 1행이 남습니다.
export const metadata: Metadata = { title: "평가·게이트" };
export const dynamic = "force-dynamic";

const ENDPOINT = "/api/admin/eval";
const opt = (items: [string, string][], blank = "고르세요") => [{ value: "", label: blank }, ...items.map(([value, label]) => ({ value, label }))];
const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") : "-");
const GRADE_FIELDS: LnField[] = [
  { name: "verdict", label: "판정", type: "select", options: opt([["correct", "정답"], ["incorrect", "오답"]]), required: true },
  { name: "fatal_error", label: "치명 오류 (오답일 때)", type: "select", options: opt(FATAL_ERRORS.map((f) => [f, FATAL_LABEL[f]] as [string, string]), "없음") },
  { name: "citations_supported", label: "근거가 뒷받침되는 인용 수" },
  { name: "clarify_missed", label: "필수 요건 역질문 누락", type: "check" },
  { name: "invented_answer", label: "답 없음 문항에서 지어낸 답", type: "check" },
  { name: "benefit_asserted", label: "감면 해당 여부 단정", type: "check" },
  { name: "note", label: "메모 (500자 이하, 번호·이메일 금지)" },
];
const ITEM_FIELDS: LnField[] = [
  { name: "set_id", label: "평가셋 번호 (초안 판만)", required: true },
  { name: "item_key", label: "관리 번호 (영문·숫자·_.-)", required: true },
  { name: "category", label: "분류", type: "select", options: opt(CATEGORIES.map((c) => [c, CATEGORY_LABEL[c]!] as [string, string]), "없음") },
  { name: "question", label: "질문 (시험용은 '[시험용]'으로 시작)", type: "area", required: true },
  { name: "cross_types", label: "교차 유형 (줄마다 하나: clarify · benefits · live)", type: "area" },
  { name: "expected_behavior", label: "기대 응답 모양", type: "select", options: BEHAVIORS.map((b) => ({ value: b, label: BEHAVIOR_LABEL[b]! })) },
  { name: "required_requirements", label: "필수 요건 (줄마다 하나)", type: "area" },
  { name: "expected_clarify", label: "기대 역질문" },
  { name: "expected_conclusion", label: "정답 결론 (감수위원 작성)", type: "area" },
  { name: "required_citation_ids", label: "필수 근거 ID (줄마다 하나)", type: "area" },
  { name: "forbidden_claims", label: "금지 주장 (줄마다 하나)", type: "area" },
  { name: "index_exclude_ids", label: "색인에서 가릴 근거 ID (실시간 조회 문항)", type: "area" },
  { name: "is_test", label: "시험용 문항 (운영 승인 리포트에 쓸 수 없음)", type: "check" },
  { name: "origin", label: "출처", type: "select", options: ORIGINS.map((o) => ({ value: o, label: ORIGIN_LABEL[o]! })) },
  { name: "anonymized", label: "익명화 검토를 마쳤음 (대화 출처)", type: "check" },
  { name: "rights_confirmed", label: "평가 사용 권리 확인함 (월간지·총람, T1)", type: "check" },
];

export default async function EvalPage() {
  const viewer = await pageViewer();
  requirePage(viewer, ["eval.author", "eval.grade", "eval.gate_approve"]);
  const canAuthor = can(viewer, "eval.author");
  const canGrade = can(viewer, "eval.grade");
  const canGate = can(viewer, "eval.gate_approve");
  const canRollout = can(viewer, "ask_rollout.approve");
  const canScope = can(viewer, "ask_scope.approve");
  const b = await loadEvalBoard(serviceDb(), actorOf(viewer));
  return (
    <>
      <PageTitle
        title="평가·게이트"
        description="평가셋과 2인 블라인드 채점, 게이트 리포트로 지방세봇의 공개 단계와 답변 범위를 관리합니다. 리포트 없이는 공개 단계도 범위 플래그도 바꿀 수 없습니다."
      />
      <div className="space-y-8">
        <Panel id="ev-state" title="지금 상태">
          <p className="text-[15px]" data-rollout={b.rollout}>
            공개 단계 <span className={MONO}>{b.rollout}</span> · 범위 플래그{" "}
            {SCOPES.map((s) => (
              <ToneChip key={s} tone={b.scopeFlags[s] ? "emerald" : "plain"} className="mr-1">{`${SCOPE_LABEL[s]} ${b.scopeFlags[s] ? "켜짐" : "꺼짐"}`}</ToneChip>
            ))}
          </p>
          <p className="text-[14px] text-navy-600">{`채점 상태 - ${Object.entries(b.statusCount).map(([k, n]) => `${STATUS_LABEL[k as FinalStatus] ?? k} ${n}건`).join(" · ") || "답변 없음"}`}</p>
        </Panel>

        {canAuthor && (
          <Panel id="ev-sets" title="평가셋 (범위별 따로 버전)" description="동결한 판은 문항을 고칠 수 없습니다. 고치려면 새 판으로 복사합니다. 게이트 리포트는 동결한 판의 실행만 씁니다.">
            <OpForm id="ev-set-add" op="set_add" label="평가셋 추가" submit="평가셋 저장" endpoint={ENDPOINT} fields={[
              { name: "scope", label: "범위", type: "select", options: opt(EVAL_SCOPES.map((s) => [s, EVAL_SCOPE_LABEL[s]!] as [string, string])), required: true },
              { name: "version", label: "버전 (예: v1)", required: true },
              { name: "note", label: "메모" },
            ]} />
            {b.sets.length === 0 ? <EmptyNote>등록된 평가셋이 없습니다.</EmptyNote> : (
              <DataTable caption="평가셋" head={["번호", "범위", "버전", "상태", "문항", "시험용", "처리"]}>
                {b.sets.map((s) => {
                  const its = b.items.filter((i) => i.set_id === s.id);
                  return (
                    <tr key={s.id} data-set-id={s.id} data-frozen={s.status === "frozen" ? "true" : "false"}>
                      <td className={`${TD} ${MONO}`}>{s.id}</td>
                      <td className={TD}>{EVAL_SCOPE_LABEL[s.scope] ?? s.scope}</td>
                      <td className={TD}>{s.version}</td>
                      <td className={TD}>{s.status === "frozen" ? `동결 ${when(s.frozen_at)}` : "초안"}</td>
                      <td className={`${TD} ${MONO}`}>{its.length}</td>
                      <td className={`${TD} ${MONO}`}>{its.filter((i) => i.is_test).length}</td>
                      <td className={TD}>
                        {s.status === "draft" && <OpButton id={`ev-freeze-${s.id}`} op="set_freeze" label="동결" ctx={{ id: s.id }} endpoint={ENDPOINT} />}
                        <OpForm id={`ev-copy-${s.id}`} op="set_copy" label={`${s.id}번 복사`} submit="새 판으로 복사" endpoint={ENDPOINT} ctx={{ id: s.id }} fields={[{ name: "version", label: "새 버전", required: true }]} />
                      </td>
                    </tr>
                  );
                })}
              </DataTable>
            )}
          </Panel>
        )}

        {canAuthor && (
          <Panel id="ev-items" title="문항 입력" description="문항·정답·필수 근거·금지 주장은 PO·감수위원이 입력합니다. 대화에서 옮긴 문항은 익명화 검토, 월간지·총람 문항은 권리 확인 표시가 있어야 저장됩니다.">
            <OpForm id="ev-item-add" op="item_add" label="문항 추가" submit="문항 저장" endpoint={ENDPOINT} fields={ITEM_FIELDS} />
            {b.items.length === 0 ? <EmptyNote>등록된 문항이 없습니다.</EmptyNote> : (
              <DataTable caption="문항 (최근 400건 - 정답은 표시하지 않습니다)" head={["번호", "판", "관리 번호", "분류", "교차 유형", "기대 응답", "표시", "한 문항 시험"]}>
                {b.items.slice(0, 100).map((i) => (
                  <tr key={i.id} data-item-id={i.id} data-test={i.is_test ? "true" : "false"}>
                    <td className={`${TD} ${MONO}`}>{i.id}</td>
                    <td className={`${TD} ${MONO}`}>{i.set_id}</td>
                    <td className={`${TD} ${MONO}`}>{i.item_key}</td>
                    <td className={TD}>{i.category ? CATEGORY_LABEL[i.category] ?? i.category : "-"}</td>
                    <td className={TD}>{i.cross_types.map((c) => CROSS_LABEL[c] ?? c).join("·") || "-"}</td>
                    <td className={TD}>{BEHAVIOR_LABEL[i.expected_behavior] ?? i.expected_behavior}</td>
                    <td className={TD}>{i.is_test ? "시험용" : "-"}</td>
                    <td className={TD}><OpButton id={`ev-run-${i.id}`} op="run_single" label="가짜 모델로 시험" ctx={{ item_id: i.id }} endpoint={ENDPOINT} /></td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Panel>
        )}

        {canGrade && (
          <Panel id="ev-grade" title="채점 (2인 블라인드)" description="다른 채점자의 판정과 모델 이름은 보이지 않습니다. 같은 답변을 두 번 채점할 수 없습니다.">
            {b.queue.length === 0 ? <EmptyNote>채점할 답변이 없습니다.</EmptyNote> : b.queue.slice(0, 20).map((a) => (
              <div key={a.answer_id} data-answer-id={a.answer_id} className="rounded-xl border border-navy-100 p-4">
                <p className="text-[15px] font-bold">{`답변 ${a.answer_id} · ${BEHAVIOR_LABEL[a.behavior] ?? a.behavior}`}</p>
                <p className="mt-1 whitespace-pre-wrap text-[15px]">{a.question}</p>
                <p className="mt-1 whitespace-pre-wrap text-[14px] text-navy-700">{a.answer_text}</p>
                <p className="mt-1 text-[13px] text-navy-600">{`인용 ${a.cited_ids.join(", ") || "없음"} · 필수 근거 ${a.required_citation_ids.join(", ") || "없음"} · 기대 응답 ${BEHAVIOR_LABEL[a.expected_behavior] ?? a.expected_behavior}`}</p>
                {a.expected_conclusion && <p className="mt-1 text-[13px] text-navy-600">{`정답 결론: ${a.expected_conclusion}`}</p>}
                {a.forbidden_claims.length > 0 && <p className="text-[13px] text-navy-600">{`금지 주장: ${a.forbidden_claims.join(" / ")}`}</p>}
                <OpForm id={`ev-grade-${a.answer_id}`} op="grade" label={`답변 ${a.answer_id} 채점`} submit="채점 저장" endpoint={ENDPOINT} ctx={{ answer_id: a.answer_id }} fields={GRADE_FIELDS} />
              </div>
            ))}
          </Panel>
        )}

        {canGrade && (
          <Panel id="ev-disputes" title="미확정 (판정 불일치)" description="두 채점자가 원문을 함께 다시 확인한 기록을 남긴 뒤에만 3인째(외부 세무사 자문) 판정을 받습니다. 자문자 이름과 일자가 이력에 남습니다.">
            {b.disputes.length === 0 ? <EmptyNote>미확정 답변이 없습니다.</EmptyNote> : b.disputes.map((d) => (
              <div key={d.answer_id} data-dispute-id={d.answer_id} className="rounded-xl border border-navy-100 p-4">
                <p className="text-[15px] font-bold">{`답변 ${d.answer_id} - 첫째 ${d.first?.verdict ?? "-"} / 둘째 ${d.second?.verdict ?? "-"}`}</p>
                <p className="mt-1 whitespace-pre-wrap text-[14px]">{d.question}</p>
                {!d.has_recheck ? (
                  d.recorded_by_viewer && <OpForm id={`ev-recheck-${d.answer_id}`} op="recheck" label={`답변 ${d.answer_id} 원문 재확인`} submit="재확인 기록" endpoint={ENDPOINT} ctx={{ answer_id: d.answer_id }} fields={[{ name: "note", label: "두 채점자가 원문을 다시 확인한 내용", type: "area", required: true }]} />
                ) : (
                  <OpForm id={`ev-third-${d.answer_id}`} op="third_grade" label={`답변 ${d.answer_id} 3인째 판정`} submit="3인째 판정 저장" endpoint={ENDPOINT} ctx={{ answer_id: d.answer_id }}
                    fields={[{ name: "advisor_name", label: "자문자 (외부 세무사)", required: true }, { name: "advised_on", label: "자문 일자 (YYYY-MM-DD)", required: true }, ...GRADE_FIELDS]} />
                )}
              </div>
            ))}
          </Panel>
        )}

        <Panel id="ev-runs" title="최근 실행 (30건)">
          {b.runs.length === 0 ? <EmptyNote>아직 실행이 없습니다.</EmptyNote> : (
            <DataTable caption="평가 실행" head={["번호", "판", "종류", "응답 출처", "모델", "지시문·색인", "지문", "상태", "시각"]}>
              {b.runs.map((r) => (
                <tr key={r.id}>
                  <td className={`${TD} ${MONO}`}>{r.id}</td><td className={`${TD} ${MONO}`}>{r.set_id}</td><td className={TD}>{r.kind}</td><td className={TD}>{r.answer_source}</td>
                  <td className={TD}>{r.model}</td><td className={TD}>{`${r.prompt_version} · ${r.index_version}`}</td><td className={`${TD} ${MONO}`}>{r.fingerprint.slice(0, 12)}</td>
                  <td className={TD}>{r.status}</td><td className={`${TD} ${MONO}`}>{when(r.created_at)}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>

        {canGate && (
          <Panel id="ev-reports" title="게이트 리포트" description="리포트는 동결한 평가셋의 끝난 실행으로 만듭니다. 통과 여부는 DB가 계산하며, 시험용 문항이 든 리포트·미달 리포트·실제 API 재실행이 없는 리포트는 확정되지 않습니다.">
            <OpForm id="ev-compile" op="report_compile" label="리포트 만들기" submit="리포트 만들기" endpoint={ENDPOINT} fields={[
              { name: "kind", label: "종류", type: "select", options: opt([["stage", "단계 (4a·4b·4c)"], ["scope", "범위 (신탁·정비 / 상속 / 증여)"]]), required: true },
              { name: "stage", label: "단계", type: "select", options: opt([["4a", "4a"], ["4b", "4b"], ["4c", "4c"]], "단계 종류일 때") },
              { name: "scope", label: "범위", type: "select", options: opt(SCOPES.map((s) => [s, SCOPE_LABEL[s]] as [string, string]), "범위 종류일 때") },
              { name: "run_id", label: "실행 번호", required: true },
              { name: "live_run_id", label: "실제 API 재실행 번호 (같은 조건의 live_api 실행)" },
            ]} />
            {b.reports.length === 0 ? <EmptyNote>리포트가 없습니다.</EmptyNote> : (
              <DataTable caption="게이트 리포트" head={["번호", "대상", "실행", "통과", "실제 API", "시험용 문항", "미달 사유", "확정", "처리"]}>
                {b.reports.map((r) => (
                  <tr key={r.id} data-report-id={r.id} data-passed={r.passed ? "true" : "false"} data-confirmed={r.confirmed_at ? "true" : "false"}>
                    <td className={`${TD} ${MONO}`}>{r.id}</td>
                    <td className={TD}>{r.kind === "stage" ? `단계 ${r.stage}` : `범위 ${SCOPE_LABEL[r.scope as keyof typeof SCOPE_LABEL] ?? r.scope}`}</td>
                    <td className={`${TD} ${MONO}`}>{`${r.run_id}${r.live_run_id ? ` / ${r.live_run_id}` : ""}`}</td>
                    <td className={TD}><ToneChip tone={r.passed ? "emerald" : "amber"}>{r.passed ? "통과" : "미달"}</ToneChip></td>
                    <td className={TD}>{r.live_ok ? "통과" : "없음·미달"}</td>
                    <td className={TD}>{r.includes_test_items ? "있음 (승인 불가)" : "없음"}</td>
                    <td className={TD}>{r.evaluation.shortfalls.map((c) => SHORTFALL_LABEL[c] ?? c).join(" · ") || "-"}</td>
                    <td className={TD}>{r.confirmed_at ? `확정 ${when(r.confirmed_at)}` : "미확정"}</td>
                    <td className={TD}>{!r.confirmed_at && <OpButton id={`ev-confirm-${r.id}`} op="report_confirm" label="확정" ctx={{ report_id: r.id }} endpoint={ENDPOINT} />}</td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Panel>
        )}

        {canRollout && (
          <Panel id="ev-rollout" title="공개 단계 승인" description="none, 4a, 4b, 4c 순서로 한 칸씩 올립니다. 올릴 때는 해당 단계의 확정한 리포트가 필요하고, 내리는 것은 리포트 없이 가능합니다. 거부 사유와 감사 1행이 남습니다.">
            <OpForm id="ev-rollout-form" op="rollout_approve" label="공개 단계 변경" submit="공개 단계 변경" endpoint={ENDPOINT} fields={[
              { name: "stage", label: "바꿀 단계", type: "select", options: opt([["none", "none (닫음)"], ["4a", "4a"], ["4b", "4b"], ["4c", "4c"]]), required: true },
              { name: "report_id", label: "확정한 리포트 번호 (올릴 때)" },
              { name: "fingerprint", label: "현재 조건 지문 (올릴 때 필수 - 다르면 리포트가 낡은 것으로 거부)" },
            ]} />
          </Panel>
        )}
        {canScope && (
          <Panel id="ev-scope" title="답변 범위 플래그 승인" description="신탁·정비, 상속 취득세, 증여 취득세를 범위마다 따로 켭니다. 켤 때는 그 범위의 확정한 리포트가 필요합니다.">
            <OpForm id="ev-scope-form" op="scope_approve" label="범위 플래그 변경" submit="범위 플래그 변경" endpoint={ENDPOINT} fields={[
              { name: "scope", label: "범위", type: "select", options: opt(SCOPES.map((s) => [s, SCOPE_LABEL[s]] as [string, string])), required: true },
              { name: "enabled", label: "상태", type: "select", options: opt([["true", "켬"], ["false", "끔"]]), required: true },
              { name: "report_id", label: "확정한 범위 리포트 번호 (켤 때)" },
              { name: "fingerprint", label: "현재 조건 지문 (켤 때 필수)" },
            ]} />
          </Panel>
        )}
        {canGate && (
          <Panel id="ev-thresholds" title="게이트 값" description="4c 기준(정답률 90%, 인용 정밀도 98%, 필수 근거 재현율 85%, 역질문 누락 5%, 치명 오류 0)과 문항 수 하한보다 낮은 값은 저장되지 않습니다.">
            <pre className="overflow-x-auto rounded-xl bg-navy-50 p-3 text-[12px]">{JSON.stringify(b.thresholds, null, 1)}</pre>
            <OpForm id="ev-thresholds-form" op="thresholds_save" label="게이트 값 저장" submit="게이트 값 저장" endpoint={ENDPOINT} fields={[{ name: "value", label: "게이트 값 JSON (stages · scopes)", type: "area", required: true }]} />
          </Panel>
        )}

        <Panel id="ev-audit" title="승인 감사 (최근 40건)">
          {b.audit.length === 0 ? <EmptyNote>기록이 없습니다.</EmptyNote> : (
            <DataTable caption="승인 감사" head={["시각", "작업", "결과", "사유", "대상", "리포트", "실행자"]}>
              {b.audit.map((a) => (
                <tr key={a.id}>
                  <td className={`${TD} ${MONO}`}>{when(a.at)}</td><td className={TD}>{a.action}</td><td className={TD}>{a.outcome === "ok" ? "성공" : "거부"}</td>
                  <td className={`${TD} ${MONO}`}>{a.code}</td><td className={TD}>{a.target ?? "-"}</td><td className={`${TD} ${MONO}`}>{a.report_id ?? "-"}</td><td className={`${TD} ${MONO}`}>{a.actor}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
      </div>
    </>
  );
}
