import type { Metadata } from "next";
import { OpForm } from "@/components/admin/LocalNewsControls";
import { DataTable, EmptyNote, MONO, PageTitle, Panel, TD, ToneChip } from "@/components/admin/ui";
import { reportOverdue } from "@/lib/admin/qna-rules";
import { REPORT_REASON_LABEL, type ReportReason } from "@/lib/qna/logic";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { loadModerationBoard } from "@/lib/server/qna/admin";

// 라운지 관리 (/admin/qna - W13-g QNA-03·05). 게시 보류 글 확인·신고 처리(목표 1영업일)·제재. 편집 책임자·관리자.
// 보이는 글은 가림이 끝난 본문뿐이다. 신고 목표 시각이 지난 건은 '목표 시간 경과'로 표시된다.
export const metadata: Metadata = { title: "라운지 관리" };
export const dynamic = "force-dynamic";

const ENDPOINT = "/api/admin/qna";
const TYPE_LABEL = { question: "질문", answer: "답변" } as const;
const HOLD_LABEL: Record<string, string> = { pii: "개인정보 가림", contact_terms: "연락처 유도 표현", consult_terms: "상담 유도 표현" };

export default async function QnaAdminPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "qna.moderate");
  const board = await loadModerationBoard(serviceDb());
  const now = new Date();
  return (
    <>
      <PageTitle title="라운지 관리" description="게시 보류 글은 가림·표현을 확인한 뒤 풀고, 신고는 접수 후 1영업일 안에 처리합니다. 답변자는 SM 소속 전문가·인증 공무원·일반 회원으로 구분됩니다." />
      <div className="space-y-8">
        <Panel id="qna-held" title={`게시 보류 ${board.held.length}건`} description="개인정보가 가려졌거나 검출 사전에 걸린 글입니다. 확인 전에는 공개되지 않습니다.">
          {board.held.length === 0 ? (
            <EmptyNote>보류 중인 글이 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="게시 보류" head={["종류", "번호", "사유", "본문(가림 후)", "처리"]}>
              {board.held.map((h) => (
                <tr key={`${h.type}-${h.id}`} data-held={`${h.type}-${h.id}`}>
                  <td className={TD}>{TYPE_LABEL[h.type]}</td>
                  <td className={`${TD} ${MONO}`}>{h.id}</td>
                  <td className={TD}>{HOLD_LABEL[h.hold_reason] ?? h.hold_reason}</td>
                  <td className={`${TD} whitespace-pre-wrap [overflow-wrap:anywhere]`}>{h.text}</td>
                  <td className={TD}>
                    <div className="space-y-2">
                      <OpForm id={`qna-release-${h.type}-${h.id}`} op="release" label="보류 풀기" submit="공개로 풀기" endpoint={ENDPOINT} ctx={{ type: h.type, id: h.id }} fields={[]} />
                      <OpForm id={`qna-hide-${h.type}-${h.id}`} op="hide" label="숨기기" submit="숨기기" endpoint={ENDPOINT} ctx={{ type: h.type, id: h.id }} fields={[{ name: "reason", label: "숨김 사유", required: true }]} />
                    </div>
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>

        <Panel id="qna-reports" title={`처리 대기 신고 ${board.reports.length}건`} description="목표 시각(접수 후 1영업일)이 가까운 순서입니다.">
          {board.reports.length === 0 ? (
            <EmptyNote>대기 중인 신고가 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="신고" head={["번호", "대상", "사유", "목표 시각", "처리"]}>
              {board.reports.map((r) => (
                <tr key={r.id} data-report-id={r.id}>
                  <td className={`${TD} ${MONO}`}>{r.id}</td>
                  <td className={TD}>{`${TYPE_LABEL[r.target_type]} #${r.target_id}`}</td>
                  <td className={TD}>
                    {REPORT_REASON_LABEL[r.reason as ReportReason] ?? r.reason}
                    {r.note ? <span className="ml-2 text-[13px] text-navy-600">{r.note}</span> : null}
                  </td>
                  <td className={TD}>
                    {r.due_at.slice(0, 16).replace("T", " ")}
                    {reportOverdue(r.due_at, now) ? <ToneChip tone="amber">목표 시간 경과</ToneChip> : null}
                  </td>
                  <td className={TD}>
                    <OpForm
                      id={`qna-report-${r.id}`}
                      op="report_handle"
                      label="신고 처리"
                      submit="처리"
                      endpoint={ENDPOINT}
                      ctx={{ id: r.id }}
                      fields={[
                        {
                          name: "decision",
                          label: "결정",
                          type: "select",
                          required: true,
                          options: [
                            { value: "", label: "고르세요" },
                            { value: "upheld", label: "받아들임" },
                            { value: "dismissed", label: "기각" },
                          ],
                        },
                        { name: "hide", label: "받아들이면 글 숨김", type: "check" },
                        { name: "sanction_days", label: "작성자 제재 일수 (비우면 제재 없음)" },
                        { name: "note", label: "처리 메모", required: true },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>

        <Panel id="qna-sanctions" title={`제재 중 ${board.sanctions.length}명`} description="제재 중인 계정은 질문·답변을 쓸 수 없고 활동 전문가 띠에서 빠집니다.">
          {board.sanctions.length === 0 ? (
            <EmptyNote>제재 중인 계정이 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="제재" head={["번호", "계정 번호", "사유", "시작", "끝", "처리"]}>
              {board.sanctions.map((s) => (
                <tr key={s.id} data-sanction-id={s.id}>
                  <td className={`${TD} ${MONO}`}>{s.id}</td>
                  <td className={`${TD} ${MONO}`}>{s.user_id}</td>
                  <td className={TD}>{s.reason}</td>
                  <td className={TD}>{s.started_at.slice(0, 10)}</td>
                  <td className={TD}>{s.ends_at ? s.ends_at.slice(0, 10) : "해제할 때까지"}</td>
                  <td className={TD}>
                    <OpForm id={`qna-lift-${s.id}`} op="sanction_lift" label="제재 해제" submit="제재 해제" endpoint={ENDPOINT} ctx={{ id: s.id }} fields={[]} />
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
          <details>
            <summary className="cursor-pointer font-bold text-navy-900">제재 직접 부과</summary>
            <div className="mt-3">
              <OpForm
                id="qna-sanction-add"
                op="sanction_add"
                label="제재 부과"
                submit="제재 부과"
                endpoint={ENDPOINT}
                fields={[
                  { name: "user_id", label: "회원 계정 번호 (UUID)", required: true },
                  { name: "reason", label: "사유", required: true },
                  { name: "days", label: "일수 (비우면 해제할 때까지)" },
                ]}
              />
            </div>
          </details>
        </Panel>
      </div>
    </>
  );
}
