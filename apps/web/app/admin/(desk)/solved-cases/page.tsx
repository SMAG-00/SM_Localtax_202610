import type { Metadata } from "next";
import { OpForm } from "@/components/admin/LocalNewsControls";
import { DataTable, EmptyNote, MONO, PageTitle, Panel, TD, ToneChip } from "@/components/admin/ui";
import { CASE_FIELD_LABEL } from "@/lib/qna/solved";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { loadSolvedBoard } from "@/lib/server/qna/solved";

// 홈 해결 사례·질문 분류 큐 (/admin/solved-cases - W13-h HOME-11·AIOPS-15). 편집 책임자·관리자(권한 solved_case.approve).
// 후보는 질문자가 소개에 동의한 채택 질문뿐이다. 카드 네 칸은 편집자가 직접 쓰고, 개인정보 가림을 확인해야 승인된다.
// 분류 제안은 정규식이 만든 참고용이며 운영자가 수락해야 카드 세목에 쓰인다. AI 분류 단계는 4단계 AI 공통 기반 운영 뒤에 켠다.
export const metadata: Metadata = { title: "해결 사례" };
export const dynamic = "force-dynamic";

const ENDPOINT = "/api/admin/solved-cases";
const STATUS_LABEL = { draft: "초안", approved: "승인됨(홈 노출)", unpublished: "내림" } as const;

export default async function SolvedCasesAdminPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "solved_case.approve");
  const board = await loadSolvedBoard(serviceDb());
  return (
    <>
      <PageTitle title="해결 사례" description="질문자가 소개에 동의한 채택 질문만 후보로 나옵니다. 카드를 직접 쓰고 개인정보 가림을 확인한 뒤 승인하면 홈에 나타납니다(기능 키 solved_cases가 켜져 있을 때). 동의가 철회되면 홈에서 바로 빠집니다." />
      <div className="space-y-8">
        <Panel id="solved-candidates" title={`후보 ${board.candidates.length}건`} description="동의한 질문 중 답변이 채택된 공개 글입니다. 본문은 가림이 끝난 값입니다.">
          {board.candidates.length === 0 ? (
            <EmptyNote>후보가 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="해결 사례 후보" head={["질문", "세목", "본문(가림 후)", "카드 상태", "카드 작성·승인"]}>
              {board.candidates.map((c) => (
                <tr key={c.question_id} data-solved-question={c.question_id}>
                  <td className={`${TD} ${MONO}`}>{c.question_id}</td>
                  <td className={TD}>{c.tax_type}</td>
                  <td className={`${TD} whitespace-pre-wrap [overflow-wrap:anywhere]`}>{`${c.title}\n${c.body}`}</td>
                  <td className={TD}>{c.case_status ? <ToneChip tone={c.case_status === "approved" ? "emerald" : "amber"}>{STATUS_LABEL[c.case_status]}</ToneChip> : "카드 없음"}</td>
                  <td className={TD}>
                    <div className="space-y-2">
                      <OpForm
                        id={`solved-save-${c.question_id}`}
                        op="save"
                        label="카드 쓰기"
                        submit="초안 저장"
                        endpoint={ENDPOINT}
                        ctx={{ question_id: c.question_id }}
                        initial={{ situation: c.situation, issue: c.issue, result: c.result, lesson: c.lesson }}
                        fields={[
                          { name: "situation", label: CASE_FIELD_LABEL.situation, type: "area", required: true },
                          { name: "issue", label: CASE_FIELD_LABEL.issue, type: "area", required: true },
                          { name: "result", label: CASE_FIELD_LABEL.result, type: "area", required: true },
                          { name: "lesson", label: CASE_FIELD_LABEL.lesson, type: "area", required: true },
                        ]}
                      />
                      {c.case_id !== null && c.case_status === "draft" && (
                        <OpForm id={`solved-approve-${c.case_id}`} op="approve" label="승인" submit="승인" endpoint={ENDPOINT} ctx={{ id: c.case_id }} fields={[{ name: "mask_confirmed", label: "카드와 원문에 개인정보(실명·연락처·주소·금액 등 식별 정보)가 없음을 확인했습니다", type: "check" }]} />
                      )}
                      {c.case_id !== null && c.case_status === "approved" && (
                        <OpForm id={`solved-unpublish-${c.case_id}`} op="unpublish" label="내리기" submit="홈에서 내리기" endpoint={ENDPOINT} ctx={{ id: c.case_id }} fields={[{ name: "reason", label: "내림 사유", required: true }]} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>

        <Panel id="classify-queue" title={`분류 제안 ${board.queue.length}건`} description="정규식이 질문 본문에서 찾은 세목 후보입니다(참고용). 수락하면 해결 사례 카드의 세목이 바뀝니다.">
          {board.queue.length === 0 ? (
            <EmptyNote>검토할 제안이 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="분류 제안" head={["번호", "질문", "제안 세목", "가림 의심", "처리"]}>
              {board.queue.map((k) => (
                <tr key={k.id} data-classify-id={k.id}>
                  <td className={`${TD} ${MONO}`}>{k.id}</td>
                  <td className={`${TD} [overflow-wrap:anywhere]`}>{`#${k.question_id} ${k.title}`}</td>
                  <td className={TD}>{k.proposed_tax_types.length > 0 ? k.proposed_tax_types.join(", ") : "제안 없음"}</td>
                  <td className={TD}>{k.pii_suspected ? <ToneChip tone="amber">가림 있음</ToneChip> : "-"}</td>
                  <td className={TD}>
                    <div className="space-y-2">
                      <OpForm id={`classify-accept-${k.id}`} op="classify_review" label="수락" submit="수락" endpoint={ENDPOINT} ctx={{ id: k.id, decision: "accepted" }} initial={{ final_tax_type: k.proposed_tax_types[0] ?? "" }} fields={[{ name: "final_tax_type", label: "최종 세목", required: true }]} />
                      <OpForm id={`classify-reject-${k.id}`} op="classify_review" label="거절" submit="거절" endpoint={ENDPOINT} ctx={{ id: k.id, decision: "rejected" }} fields={[]} />
                    </div>
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
      </div>
    </>
  );
}
