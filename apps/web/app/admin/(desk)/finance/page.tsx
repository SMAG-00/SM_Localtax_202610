import type { Metadata } from "next";
import { FinanceForm, SignButton } from "@/components/admin/FinanceControls";
import { EmptyNote, MONO, PageTitle, Panel, ToneChip } from "@/components/admin/ui";
import { can } from "@/lib/access";
import { diagramToText, STRUCTURE_TYPE_LABELS, REBUTTAL_STATUS_LABELS, type StructureType } from "@/lib/admin/finance-rules";
import { loadFinanceBoard } from "@/lib/server/finance/board";
import { pageViewer } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { ForbiddenView } from "@/components/admin/ForbiddenView";

// 개발금융 관리 (/admin/finance - W5, PRD-01B DF-01~05 · DF-09, docs/dev/W5_설계.md 1장 3단계).
//  · 공개 조건 - 법률 검토 기록(설정 권한)과 기능 키 finance 상태. 기능 키는 설정 화면에서 켭니다(검토 기록이 approved여야 켜집니다)
//  · 구조 해설 - 초안(편집 책임자·관리자) → 법률 확인 → 세무 감수 서명(감수위원). 고치면 법률 확인이 지워지고 공개는 마지막 승인본을 유지
//  · 통계·규제 - 추가만 시계열 (원문 주소·제공기관·원본 스냅샷 필수). 사례·칼럼 - 기사마다 반론 기록·소속 항목
// 금융 내용은 사람이 공식 원문을 보고 넣습니다 (채워 넣는 기본값 0). 투자 권유 문구는 저장 단계에서 거부됩니다.
export const metadata: Metadata = { title: "부동산금융" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: "amber" | "emerald" | "navy" }> = {
  draft: { label: "초안 (승인본 없음)", tone: "amber" },
  approved: { label: "승인됨", tone: "emerald" },
  rereview_needed: { label: "재감수 필요 (공개는 마지막 승인본)", tone: "amber" },
};

export default async function FinancePage() {
  const viewer = await pageViewer();
  const canWrite = can(viewer, "finance.manage");
  const canSign = can(viewer, "review.tax_review");
  const canReview = can(viewer, "settings.edit");
  if (!canWrite && !canSign) return <ForbiddenView />;
  const board = await loadFinanceBoard(serviceDb());
  const review = (board.legalReview ?? {}) as { reviewer?: string; reviewed_on?: string; conclusion?: string };
  const reviewed = review.conclusion === "approved";

  return (
    <>
      <PageTitle
        title="부동산금융"
        description="구조 해설·규제·통계 트래커·사례 구조·칼럼 소속 항목을 입력합니다. 내용은 공식 원문을 보고 적고, 구조 해설은 법률 확인과 세무 감수 서명이 모두 있어야 공개됩니다. 투자 권유·수익률 순위·상품 가입 링크는 받지 않습니다."
      />
      <div className="space-y-8">
        <Panel id="finance-gate" title="공개 조건" description="법률 검토 기록이 승인 상태여야 기능 키 finance(설정 > feature_flags)를 켤 수 있습니다. 켜기 전에는 구조 해설·트래커·사례 블록이 공개 화면에 나오지 않습니다.">
          <p data-testid="finance-gate-state" className="text-[15px] text-navy-800">
            기능 키 finance <ToneChip tone={board.featureOn ? "emerald" : "amber"}>{board.featureOn ? "켜짐" : "꺼짐"}</ToneChip> · 법률 검토{" "}
            {reviewed ? `${review.reviewer} ${review.reviewed_on} 승인` : review.conclusion === "rejected" ? "반려" : "기록 없음"}
          </p>
          <p className="mt-1 text-[14px] text-navy-600">
            금융상품 차단 도메인 {board.blockedDomains.length}개 · 반론 무응답 인정 기간 {board.rebuttalWaitDays ?? "-"}일 (설정에서 고칩니다)
          </p>
          {canReview && (
            <div className="mt-4">
              <FinanceForm kind="legal_review" id="fin-review" />
            </div>
          )}
        </Panel>

        <Panel id="finance-structures" title={`구조 해설 ${board.structures.length}건`} description="초안 → 법률 확인 → 세무 감수 서명. 서명은 읽은 초안 그대로일 때만 됩니다.">
          {board.structures.length === 0 ? (
            <EmptyNote>구조 해설이 없습니다.</EmptyNote>
          ) : (
            <ul className="space-y-6" data-testid="finance-structure-list">
              {board.structures.map((s) => {
                const st = STATUS[s.review_status] ?? STATUS.draft!;
                const text = diagramToText(s.diagram);
                return (
                  <li key={s.slug} data-structure-slug={s.slug} data-review-status={s.review_status} className="rounded-xl border border-navy-100 p-4 text-[15px]">
                    <p className="font-bold text-navy-900 [overflow-wrap:anywhere]">
                      {s.title} <ToneChip tone={st.tone}>{st.label}</ToneChip>
                    </p>
                    <p className={`${MONO} mt-1 text-navy-600`}>
                      /{s.slug} · {STRUCTURE_TYPE_LABELS[s.structure_type as StructureType] ?? s.structure_type} · 승인본 {s.approved_version ?? "없음"} · 법률 확인{" "}
                      {s.legal_checked_by ? `${s.legal_checked_by} ${s.legal_checked_at}` : "없음"}
                    </p>
                    {canWrite && (
                      <div className="mt-4">
                        <FinanceForm kind="legal_check" id={`fin-lc-${s.slug}`} ctx={{ slug: s.slug }} />
                      </div>
                    )}
                    {canSign && s.review_status !== "approved" && (
                      <div className="mt-4">
                        <SignButton id={`fin-sign-${s.slug}`} slug={s.slug} updatedAt={s.updated_at} />
                      </div>
                    )}
                    {canWrite && (
                      <details className="mt-4">
                        <summary className="cursor-pointer font-bold text-navy-900">초안 고치기</summary>
                        <div className="mt-4">
                          <FinanceForm
                            kind="structure"
                            id={`fin-st-${s.slug}`}
                            initial={{
                              slug: s.slug,
                              structure_type: s.structure_type,
                              title: s.title,
                              summary: s.summary ?? "",
                              alt: s.diagram?.alt ?? "",
                              nodes: text.nodes,
                              edges: text.edges,
                              notes: s.notes.join("\n"),
                              lens: s.lens ? JSON.stringify(s.lens) : "",
                              lens_omit_reason: s.lens_omit_reason ?? "",
                            }}
                          />
                        </div>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {canWrite && (
            <div className="mt-6">
              <h3 className="mb-3 text-[16px] font-bold text-navy-900">구조 해설 만들기</h3>
              <FinanceForm kind="structure" id="fin-st-new" />
            </div>
          )}
        </Panel>

        {canWrite && (
          <>
            <Panel id="finance-tracker" title="규제·통계 트래커" description="새 값은 새 행으로 쌓이고 이전 값은 그대로 남습니다 (덮어쓰기 없음). 원문 주소·제공기관·원본 스냅샷·기준일이 모두 있어야 저장됩니다.">
              <p className="text-[14px] text-navy-600" data-testid="finance-tracker-counts">
                통계 지표 기록 {board.indicators.length}건 · 규제 항목 기록 {board.regulations.length}건 (최근 50건)
              </p>
              <h3 className="mt-4 mb-3 text-[16px] font-bold text-navy-900">통계 지표 새 값</h3>
              <FinanceForm kind="indicator" id="fin-ind" />
              <h3 className="mt-6 mb-3 text-[16px] font-bold text-navy-900">규제 항목 새 단계</h3>
              <FinanceForm kind="regulation" id="fin-reg" />
            </Panel>

            <Panel id="finance-articles" title="부동산금융 기사 - 사례 구조·칼럼 소속" description="사례 기사(하위 분야 사례)는 구조 기록이 있어야 발행됩니다. 실명 기업을 다루면 반론 요청일·방법·답변 상태가 필요합니다. 칼럼(의견 기사)은 소속 금융사·신탁사 항목이 필요합니다.">
              {board.articles.length === 0 ? (
                <EmptyNote>부동산금융 분야 기사가 없습니다.</EmptyNote>
              ) : (
                <ul className="space-y-6" data-testid="finance-article-list">
                  {board.articles.map((a) => {
                    const opinion = a.content_type === "opinion";
                    const c = a.case;
                    const byItem = (n: string) => a.interest.find((i) => i.item === n);
                    const fin = byItem("financial_company");
                    const trust = byItem("trust_company");
                    return (
                      <li key={a.id} data-article-id={a.id} className="rounded-xl border border-navy-100 p-4 text-[15px]">
                        <p className="font-bold text-navy-900 [overflow-wrap:anywhere]">{a.title}</p>
                        <p className={`${MONO} mt-1 text-navy-600`}>
                          #{a.id} · {a.status} · {a.content_type ?? "-"} · {a.category_slug ?? "-"}
                          {c ? ` · 사례 기록 있음${c.named_company ? ` · 실명 · 반론 ${c.rebuttal_status ? REBUTTAL_STATUS_LABELS[c.rebuttal_status as keyof typeof REBUTTAL_STATUS_LABELS] : "미기록"}` : ""}` : ""}
                        </p>
                        <details className="mt-3">
                          <summary className="cursor-pointer font-bold text-navy-900">{opinion ? "칼럼 소속 항목" : "사례 구조·반론 기록"}</summary>
                          <div className="mt-4">
                            {opinion ? (
                              <FinanceForm
                                kind="interest"
                                id={`fin-int-${a.id}`}
                                ctx={{ article_id: a.id }}
                                initial={{ fin_state: fin?.state ?? "", fin_text: fin?.interest_text ?? "", fin_by: fin?.confirmed_by ?? "", trust_state: trust?.state ?? "", trust_text: trust?.interest_text ?? "", trust_by: trust?.confirmed_by ?? "" }}
                              />
                            ) : (
                              <FinanceForm
                                kind="case"
                                id={`fin-case-${a.id}`}
                                ctx={{ article_id: a.id }}
                                initial={
                                  c
                                    ? {
                                        structure_type: c.structure_type,
                                        issues: c.issues.join("\n"),
                                        outcome: c.outcome ?? "",
                                        named_company: c.named_company,
                                        rebuttal_requested_at: c.rebuttal_requested_at ? c.rebuttal_requested_at.slice(0, 10) : "",
                                        rebuttal_method: c.rebuttal_method ?? "",
                                        rebuttal_status: c.rebuttal_status ?? "",
                                        rebuttal_note: c.rebuttal_note ?? "",
                                        judgment_quoted: c.judgment_quoted,
                                        anonymized_checked: c.anonymized_checked,
                                      }
                                    : undefined
                                }
                              />
                            )}
                          </div>
                        </details>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          </>
        )}
      </div>
    </>
  );
}
