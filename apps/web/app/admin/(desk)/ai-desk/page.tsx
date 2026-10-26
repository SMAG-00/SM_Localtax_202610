import type { Metadata } from "next";
import { OpButton, OpForm, type LnField } from "@/components/admin/LocalNewsControls";
import { DataTable, EmptyNote, MONO, PageTitle, Panel, TD, ToneChip } from "@/components/admin/ui";
import { can } from "@/lib/access";
import { CHECK_KEYS, CHECK_LABELS } from "@/lib/ai-desk/input";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { loadDeskBoard } from "@/lib/server/ops-ai/desk-board";

// 편집국 AI (/admin/ai-desk - W12-f, PRD-04 AIOPS-07~10 · CASE-05 · ART-13·14, docs/dev/W12-f_설계.md 5장).
//  · AI가 만든 결정례 요지·AI 태그 후보·기사 요약 상자·개정 영향 배너 제안·채널 원고 초안을 한곳에서 확인합니다.
//  · 승인 전에는 어떤 공개 화면에도 나오지 않습니다. 승인하려면 체크리스트를 모두 확인해야 하고, 원문·기사가 바뀌었으면 DB가 거부합니다.
export const metadata: Metadata = { title: "편집국 AI" };
export const dynamic = "force-dynamic";

const ENDPOINT = "/api/admin/ai-desk";
const STATUS_LABEL: Record<string, string> = { draft: "초안", proposed: "제안", approved: "승인", rejected: "반려", dismissed: "반려", retired: "내려감" };
const TONE = { draft: "amber", proposed: "amber", approved: "emerald", rejected: "navy", dismissed: "navy", retired: "navy" } as const;
const checkFields = (kind: keyof typeof CHECK_KEYS): LnField[] => CHECK_KEYS[kind].map((k) => ({ name: k, label: CHECK_LABELS[k] ?? k, type: "check" as const }));
const REASON: LnField[] = [{ name: "reason", label: "반려 사유", required: true }];
const CHANNEL_FIELDS: LnField[] = [
  { name: "article_id", label: "승인된 기사 번호", required: true },
  { name: "channels", label: "채널 (brief·cardnews·shorts·naver_blog·naver_post, 쉼표로 구분)", required: true },
];
const BOX_FIELDS: LnField[] = [{ name: "article_id", label: "승인된 기사 번호", required: true }];
const RESULT_LABEL: Record<string, string> = { accepted: "받아들임", dismissed: "기각", partial: "일부 받아들임", inadmissible: "각하", other: "그 밖" };

export default async function AiDeskPage() {
  const viewer = await pageViewer();
  requirePage(viewer, can(viewer, "case_summary.approve") ? "case_summary.approve" : "ai_box.approve");
  const canSummary = can(viewer, "case_summary.approve");
  const canBox = can(viewer, "ai_box.approve");
  const board = await loadDeskBoard(serviceDb());
  return (
    <>
      <PageTitle title="편집국 AI" description="AI가 만든 초안을 확인하고 승인합니다. 승인 전 초안은 어떤 공개 화면에도 나오지 않으며, AI 초안에는 세액이 없습니다." />
      <div className="space-y-8">
        {canSummary && (
          <Panel id="ad-summaries" title="결정례 요지 초안" description="사건번호·결정일은 원문 정보에서 가져온 값입니다. 요지 줄에 숫자·고유명사 경고가 있으면 원문과 다시 대조하세요.">
            {board.summaries.length === 0 ? (
              <EmptyNote>요지 초안이 없습니다.</EmptyNote>
            ) : (
              <DataTable caption="결정례 요지" head={["번호", "결정례", "요지 3줄", "결론 · 대중성", "경고", "상태", "처리"]}>
                {board.summaries.map((s) => (
                  <tr key={s.id} data-id={s.id} data-status={s.status}>
                    <td className={`${TD} ${MONO}`}>{s.id}</td>
                    <td className={TD}>
                      <span className={MONO}>{s.case_id}</span>
                      <br />
                      <span className={`text-[13px] ${MONO}`}>{s.docNo ?? "-"} {s.decidedOn ?? ""}</span>
                    </td>
                    <td className={TD}>
                      <ol className="list-decimal pl-4">
                        {s.summary_lines.map((l, i) => (
                          <li key={i}>{l}</li>
                        ))}
                      </ol>
                      {s.newTagCandidates.length > 0 && <p className="text-[13px]">새 태그 후보: {s.newTagCandidates.map((c) => c.label).join(", ")}</p>}
                    </td>
                    <td className={TD}>{RESULT_LABEL[s.result_type] ?? s.result_type} · {s.popularity}</td>
                    <td className={TD}>{s.warnings.length === 0 ? "-" : s.warnings.join(" / ")}</td>
                    <td className={TD}>
                      <ToneChip tone={TONE[s.status as keyof typeof TONE] ?? "navy"}>{STATUS_LABEL[s.status] ?? s.status}</ToneChip>
                    </td>
                    <td className={TD}>
                      {s.status === "draft" && (
                        <div className="space-y-3">
                          <OpForm id={`ad-sum-approve-${s.id}`} op="approve_summary" label="요지 승인" submit="승인" endpoint={ENDPOINT} ctx={{ id: s.id }} fields={checkFields("case_summary")} />
                          <OpForm id={`ad-sum-reject-${s.id}`} op="reject_summary" label="요지 반려" submit="반려" endpoint={ENDPOINT} ctx={{ id: s.id }} fields={REASON} />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Panel>
        )}
        {canSummary && (
          <Panel id="ad-tags" title="AI 태그 후보" description="AI가 쟁점 태그 사전에서 고른 후보입니다. 편집자가 붙인 태그(editor)는 AI가 바꾸지 못합니다. 승인해야 목록에 오릅니다.">
            {board.aiTags.length === 0 ? (
              <EmptyNote>AI 태그 후보가 없습니다.</EmptyNote>
            ) : (
              <DataTable caption="AI 태그 후보" head={["번호", "결정례", "태그 키", "상태", "처리"]}>
                {board.aiTags.map((t) => (
                  <tr key={t.id} data-id={t.id} data-status={t.status}>
                    <td className={`${TD} ${MONO}`}>{t.id}</td>
                    <td className={`${TD} ${MONO}`}>{t.case_id}</td>
                    <td className={`${TD} ${MONO}`}>{t.tag_key}</td>
                    <td className={TD}>
                      <ToneChip tone={t.status === "approved" ? "emerald" : "amber"}>{t.status === "approved" ? "승인" : "제안"}</ToneChip>
                    </td>
                    <td className={TD}>{t.status === "proposed" && <OpButton id={`ad-tag-approve-${t.id}`} op="approve_tag" label="승인" ctx={{ id: t.id }} endpoint={ENDPOINT} />}</td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Panel>
        )}
        {canBox && (
          <Panel id="ad-boxes" title="기사 요약 상자 초안" description='기사 상단 "3줄 요약 · 내게 무슨 의미?" 상자입니다. 기사가 바뀌면 승인한 상자도 공개에서 빠지고 새 초안이 필요합니다.'>
            {board.boxes.length === 0 ? (
              <EmptyNote>요약 상자 초안이 없습니다.</EmptyNote>
            ) : (
              <DataTable caption="요약 상자" head={["번호", "기사", "3줄 요약 · 의미", "경고", "상태", "처리"]}>
                {board.boxes.map((b) => (
                  <tr key={b.id} data-id={b.id} data-status={b.status}>
                    <td className={`${TD} ${MONO}`}>{b.id}</td>
                    <td className={`${TD} ${MONO}`}>{b.article_id} (버전 {b.article_version})</td>
                    <td className={TD}>
                      <ol className="list-decimal pl-4">
                        {b.three_lines.map((l, i) => (
                          <li key={i}>{l}</li>
                        ))}
                      </ol>
                      <p className="text-[13px]">{b.meaning}</p>
                    </td>
                    <td className={TD}>{b.warnings.length === 0 ? "-" : b.warnings.join(" / ")}</td>
                    <td className={TD}>
                      <ToneChip tone={TONE[b.status as keyof typeof TONE] ?? "navy"}>{STATUS_LABEL[b.status] ?? b.status}</ToneChip>
                    </td>
                    <td className={TD}>
                      {b.status === "draft" && (
                        <div className="space-y-3">
                          <OpForm id={`ad-box-approve-${b.id}`} op="approve_box" label="상자 승인" submit="승인" endpoint={ENDPOINT} ctx={{ id: b.id }} fields={checkFields("article_ai_box")} />
                          <OpForm id={`ad-box-reject-${b.id}`} op="reject_box" label="상자 반려" submit="반려" endpoint={ENDPOINT} ctx={{ id: b.id }} fields={REASON} />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </DataTable>
            )}
            <div className="mt-4">
              <OpForm id="ad-make-box" op="make_box" label="상자 초안 만들기" submit="초안 만들기" endpoint={ENDPOINT} fields={BOX_FIELDS} />
            </div>
          </Panel>
        )}
        {canBox && (
          <Panel id="ad-banners" title="개정 영향 배너 제안" description='개정 조문을 인용한 공개 기사에 "개정 전 기준" 배너를 달지 확인합니다. 확인 전에는 노출되지 않습니다.'>
            {board.banners.length === 0 ? (
              <EmptyNote>배너 제안이 없습니다.</EmptyNote>
            ) : (
              <DataTable caption="개정 영향 배너" head={["번호", "기사", "개정 사건", "변화", "참고 문장", "상태", "처리"]}>
                {board.banners.map((n) => (
                  <tr key={n.id} data-id={n.id} data-status={n.status}>
                    <td className={`${TD} ${MONO}`}>{n.id}</td>
                    <td className={`${TD} ${MONO}`}>{n.article_id}</td>
                    <td className={`${TD} ${MONO}`}>{n.law_event_id}</td>
                    <td className={TD}>{n.change === "removed" ? "조문 삭제" : "글 변경"}</td>
                    <td className={TD}>{n.note ?? "-"}</td>
                    <td className={TD}>
                      <ToneChip tone={TONE[n.status as keyof typeof TONE] ?? "navy"}>{STATUS_LABEL[n.status] ?? n.status}</ToneChip>
                    </td>
                    <td className={TD}>
                      {n.status === "proposed" && (
                        <div className="space-y-3">
                          <OpButton id={`ad-banner-approve-${n.id}`} op="approve_banner" label="배너 확인" ctx={{ id: n.id }} endpoint={ENDPOINT} />
                          <OpForm id={`ad-banner-reject-${n.id}`} op="reject_banner" label="배너 반려" submit="반려" endpoint={ENDPOINT} ctx={{ id: n.id }} fields={REASON} />
                        </div>
                      )}
                      {n.status === "approved" && <OpButton id={`ad-banner-retire-${n.id}`} op="retire_banner" label="내리기" ctx={{ id: n.id }} endpoint={ENDPOINT} />}
                    </td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Panel>
        )}
        {canBox && (
          <Panel id="ad-channels" title="채널 원고 초안" description="승인된 기사에서 채널별 초안을 만듭니다. 글자 수 상한(설정)이 있는 채널만 만들어지고, 원고마다 원문 기사 링크와 AI 활용 표기가 붙습니다. 게시는 사람이 합니다.">
            {board.channels.length === 0 ? (
              <EmptyNote>채널 원고 초안이 없습니다.</EmptyNote>
            ) : (
              <DataTable caption="채널 원고" head={["검수 번호", "채널", "글자 수 / 상한", "경고", "원고"]}>
                {board.channels.map((c) => (
                  <tr key={c.id} data-id={c.id} data-channel={c.payload.channel ?? ""}>
                    <td className={`${TD} ${MONO}`}>{c.id}</td>
                    <td className={TD}>{c.payload.channel ?? "-"}</td>
                    <td className={`${TD} ${MONO}`}>{c.payload.length ?? "-"} / {c.payload.limit ?? "-"}</td>
                    <td className={TD}>{(c.payload.warnings ?? []).length === 0 ? "-" : (c.payload.warnings ?? []).join(" / ")}</td>
                    <td className={`${TD} whitespace-pre-wrap`}>{c.payload.text ?? ""}</td>
                  </tr>
                ))}
              </DataTable>
            )}
            <div className="mt-4">
              <OpForm id="ad-make-channels" op="make_channels" label="채널 원고 만들기" submit="원고 만들기" endpoint={ENDPOINT} fields={CHANNEL_FIELDS} />
            </div>
          </Panel>
        )}
        <Panel id="ad-audit" title="승인 기록 (최근 40건)">
          {board.audit.length === 0 ? (
            <EmptyNote>아직 기록이 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="편집국 AI 감사" head={["시각", "대상", "행위", "결과", "행위자"]}>
              {board.audit.map((a) => (
                <tr key={a.id} data-outcome={a.outcome} data-code={a.code}>
                  <td className={`${TD} ${MONO}`}>{a.at.slice(0, 16).replace("T", " ")}</td>
                  <td className={TD}>{a.subject} {a.target_id}</td>
                  <td className={TD}>{a.action}</td>
                  <td className={TD}>{a.outcome === "ok" ? "성공" : `거부 (${a.code})`}</td>
                  <td className={`${TD} ${MONO}`}>{a.actor}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
      </div>
    </>
  );
}
