import type { Metadata } from "next";
import { LawForm, MarkButton, RowConfirm } from "@/components/admin/SpecialLawControls";
import { CompareForm, FactForm, MethodForm, SignButton } from "@/components/admin/DevMethodControls";
import { EmptyNote, MONO, PageTitle, Panel, ToneChip } from "@/components/admin/ui";
import { can } from "@/lib/access";
import { DEV_METHOD_ITEM_LABELS } from "@/lib/admin/dev-method-rules";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { loadDevMethodBoard } from "@/lib/server/dev-methods/board";
import { loadSpecialLawBoard } from "@/lib/server/special-law";

// 개발방법 비교 관리 (/admin/dev-methods — W4 19단계, PRD-01B PR-09 · PR-10 · PR-11, docs/dev/W4_설계.md 1장 19단계 · 5장 · 6장 · 7장 4).
// 편집 책임자·관리자(dev_method.manage)는 7개 방법의 내용·비교 항목 6칸·숫자 요건 사실 행(첫 판·새 판 + 사유)을 적고, 세무 감수위원(review.tax_review)은 서명한다.
// 7개 방법이 모두 '공개 준비'(방법 서명 + 비교 항목 6칸 서명)여야 운영 설정에서 기능 키 dev_methods를 켤 수 있다. 방법 7행·이름·순서는 고정이다.
// 점수·순위·추천 입력 요소는 어디에도 없다(PR-11). 내용·숫자 요건 값은 편집국이 공식 원문을 보고 적는다 — 이 화면은 채워 넣는 값이 없다.
export const metadata: Metadata = { title: "개발방법 비교" };
export const dynamic = "force-dynamic";

export default async function DevMethodsPage() {
  const viewer = await pageViewer();
  requirePage(viewer, ["dev_method.manage", "review.tax_review"]);
  const board = await loadDevMethodBoard(serviceDb());
  const law = await loadSpecialLawBoard(serviceDb());
  const canConfirm = can(viewer, "special_law.confirm");
  const canEdit = can(viewer, "dev_method.manage");
  const canSign = can(viewer, "review.tax_review");
  const readyCount = board.methods.filter((m) => m.readiness.ready).length;

  return (
    <>
      <PageTitle
        title="개발방법 비교"
        description="재개발 등 일곱 개발방법을 같은 비교 항목으로 기록합니다. 편집국이 공식 원문을 보고 내용과 숫자 요건(기준일·근거 조문·원문 포함)을 적고, 세무 감수위원이 서명합니다. 일곱 방법이 모두 준비되면 운영 설정에서 공개 키를 켤 수 있습니다. 추천·점수·순위는 기록하지 않습니다."
      />
      <div className="space-y-8">
        <Panel id="dev-readiness" title={`공개 준비 ${readyCount}/${board.methods.length}`} description={`공개 키 dev_methods: ${board.published ? "켜짐" : "꺼짐"}. 방법 서명과 비교 항목 6칸 서명이 모두 있어야 준비입니다.`}>
          <ul className="space-y-2 text-[15px]" data-testid="dev-readiness">
            {board.methods.map((m) => (
              <li key={m.slug} data-method={m.slug} data-ready={String(m.readiness.ready)} className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-navy-900">{m.name}</span>
                <span className={`${MONO} text-navy-600`}>{m.slug}</span>
                <ToneChip tone={m.readiness.ready ? "emerald" : "amber"}>{m.readiness.ready ? "공개 준비" : "준비 전"}</ToneChip>
                {m.readiness.ready && !m.facts.some((g) => g.latest.reviewed_by && g.latest.reference_date) && (
                  <span className="text-navy-700">서명된 숫자 요건이 없으면 공개 비교표에서 이 방법 열이 빠집니다</span>
                )}
                {!m.readiness.ready && (
                  <span className="text-navy-700">
                    {!m.readiness.method_signed && "방법 서명 없음 · "}
                    {m.readiness.compare_unsigned.length > 0 && `서명 없는 비교 항목 ${m.readiness.compare_unsigned.map((i) => DEV_METHOD_ITEM_LABELS[i as keyof typeof DEV_METHOD_ITEM_LABELS] ?? i).join(", ")}`}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel id="special-law" title={`특례법 확인 ${law.current ? "확인됨" : "확인 전"}`} description="특례법 공포 확인(공포 원문 주소·공포일)은 관리자(PO)가 실사 뒤 직접 남깁니다. 확인 기록이 없으면 공개 화면에 특례법 요소가 나오지 않고, 표시된 행을 고치면 그 행의 확인을 다시 해야 합니다.">
          <div className="space-y-4 text-[15px]" data-testid="special-law" data-confirmed={String(Boolean(law.current))}>
            {law.current ? (
              <p data-part="law-current" className="text-navy-800 [overflow-wrap:anywhere]">
                공포일 {law.current.promulgated_on} · <a className="underline" href={law.current.promulgation_url ?? "#"} rel="noopener noreferrer" target="_blank">공포 원문</a> · 확인 {law.current.confirmed_at.slice(0, 10)}
              </p>
            ) : (
              <EmptyNote>특례법 공포 확인 기록이 없습니다.</EmptyNote>
            )}
            {law.targets.length > 0 && (
              <ul className="space-y-3" data-part="special-law-targets">
                {law.targets.map((t) => (
                  <li key={t.ref + t.kind} data-kind={t.kind} data-ref={t.ref} data-confirmed={String(t.confirmed)} className="rounded-xl border border-navy-100 p-3">
                    <p className="font-bold text-navy-900 [overflow-wrap:anywhere]">
                      {t.method_name} · {t.kind === "compare" ? (DEV_METHOD_ITEM_LABELS[t.key as keyof typeof DEV_METHOD_ITEM_LABELS] ?? t.key) : t.label}{" "}
                      <ToneChip tone={t.confirmed ? "emerald" : "amber"}>{t.confirmed ? "확인됨" : "확인 전"}</ToneChip>
                    </p>
                    {canConfirm && law.current && (
                      <div className="mt-2">
                        <RowConfirm body={t.kind === "compare" ? { target: "compare", slug: t.slug, item: t.key } : { target: "fact", slug: t.slug, fact_id: t.fact_id }} label="이 행" confirmed={t.confirmed} />
                      </div>
                    )}
                    {canEdit && t.kind === "compare" && (
                      <div className="mt-2">
                        <MarkButton body={{ op: "mark_compare", slug: t.slug, item: t.key, on: false }} label="특례법 근거 표시 끄기" />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && (
              <details>
                <summary className="cursor-pointer font-bold text-navy-900">특례법 근거 표시 켜기 (비교 항목)</summary>
                <ul className="mt-3 space-y-2" data-part="special-law-mark-list">
                  {board.methods.flatMap((m) =>
                    m.compare.flatMap(({ item, row }) =>
                      row ? (
                        <li key={m.slug + item} data-mark={`${m.slug}:${item}`}>
                          <MarkButton body={{ op: "mark_compare", slug: m.slug, item, on: true }} label={`${m.name} · ${DEV_METHOD_ITEM_LABELS[item]} 표시 켜기`} />
                        </li>
                      ) : [],
                    ),
                  )}
                </ul>
              </details>
            )}
            {canEdit && board.methods.some((m) => m.facts.length > 0) && (
              <details>
                <summary className="cursor-pointer font-bold text-navy-900">숫자 요건의 특례법 근거 표시 (새 판으로 바뀜)</summary>
                <ul className="mt-3 space-y-2">
                  {board.methods.flatMap((m) =>
                    m.facts.map((g) => (
                      <li key={m.slug + g.fact_key} data-mark-fact={`${m.slug}:${g.fact_key}`}>
                        <MarkButton body={{ op: "mark_fact", slug: m.slug, fact_key: g.fact_key, on: !law.targets.some((t) => t.kind === "fact" && t.slug === m.slug && t.key === g.fact_key) }} label={`${m.name} · ${g.latest.label} 표시 바꾸기`} />
                      </li>
                    )),
                  )}
                </ul>
              </details>
            )}
            {canConfirm && <LawForm current={Boolean(law.current)} />}
          </div>
        </Panel>

        {board.methods.map((m) => (
          <Panel key={m.slug} id={`dev-method-${m.slug}`} title={`${m.name} (${m.kind_label})`} description={`고정 순서 ${m.sort} · ${m.slug}`}>
            <div data-method={m.slug} className="space-y-8">
              <section aria-label={`${m.name} 방법 내용`} data-part="method-content">
                <h3 className="text-[17px] font-black text-navy-900">
                  방법 내용 <ToneChip tone={m.review_status === "reviewed" ? "emerald" : m.review_status === "rereview_needed" ? "rose" : "amber"}>{m.review_status === "reviewed" ? "서명됨" : m.review_status === "rereview_needed" ? "재감수 필요" : "초안"}</ToneChip>
                </h3>
                {m.summary && <p className="mt-2 text-[15px] text-navy-800 [overflow-wrap:anywhere]">{m.summary}</p>}
                {canEdit && (
                  <details className="mt-3">
                    <summary className="cursor-pointer font-bold text-navy-900">내용 적기·고치기</summary>
                    <div className="mt-4">
                      <MethodForm slug={m.slug} initial={{ legal_basis_name: m.legal_basis_name ?? "", summary: m.summary ?? "", steps: m.steps ?? [], lens: m.lens }} />
                    </div>
                  </details>
                )}
                {canSign && m.drafted_at && m.review_status !== "reviewed" && (
                  <div className="mt-3">
                    <SignButton body={{ target: "method", slug: m.slug, drafted_at: m.drafted_at }} label={`${m.name} 방법 내용 서명`} />
                  </div>
                )}
              </section>

              <section aria-label={`${m.name} 비교 항목`} data-part="compare">
                <h3 className="text-[17px] font-black text-navy-900">비교 항목 6칸</h3>
                <ul className="mt-3 space-y-5">
                  {m.compare.map(({ item, row }) => (
                    <li key={item} data-item={item} data-status={row?.review_status ?? "none"} className="rounded-xl border border-navy-100 p-4 text-[15px]">
                      <p className="font-bold text-navy-900">
                        {DEV_METHOD_ITEM_LABELS[item]}{" "}
                        <ToneChip tone={row?.review_status === "reviewed" ? "emerald" : row ? "amber" : "navy"}>{row ? (row.review_status === "reviewed" ? "서명됨" : row.review_status === "rereview_needed" ? "재감수 필요" : "초안") : "비어 있음"}</ToneChip>
                      </p>
                      {row && <p className="mt-1 text-navy-800 [overflow-wrap:anywhere]">{row.body}</p>}
                      {canEdit && (
                        <details className="mt-3">
                          <summary className="cursor-pointer font-bold text-navy-900">적기·고치기</summary>
                          <div className="mt-3">
                            <CompareForm slug={m.slug} item={item} label={DEV_METHOD_ITEM_LABELS[item]} initial={row?.body ?? ""} />
                          </div>
                        </details>
                      )}
                      {canSign && row && row.review_status !== "reviewed" && (
                        <div className="mt-3">
                          <SignButton body={{ target: "compare", slug: m.slug, item, drafted_at: row.drafted_at }} label={`${DEV_METHOD_ITEM_LABELS[item]} 서명`} />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>

              <section aria-label={`${m.name} 숫자 요건`} data-part="facts">
                <h3 className="text-[17px] font-black text-navy-900">숫자 요건 (기준일·근거 조문·원문 필수)</h3>
                {m.facts.length === 0 ? (
                  <EmptyNote>숫자 요건이 없습니다.</EmptyNote>
                ) : (
                  <ul className="mt-3 space-y-5">
                    {m.facts.map((g) => (
                      <li key={g.fact_key} data-fact-key={g.fact_key} className="rounded-xl border border-navy-100 p-4 text-[15px]">
                        <p className="font-bold text-navy-900 [overflow-wrap:anywhere]">
                          {g.latest.label} {g.latest.value}
                          {g.latest.unit ?? ""} <ToneChip tone={g.latest.reviewed_by ? "emerald" : "amber"}>{g.latest.reviewed_by ? "서명됨" : "서명 전"}</ToneChip>
                          {g.under_review && <ToneChip tone="rose">원문 검토 중</ToneChip>}
                        </p>
                        <p className={`${MONO} mt-1 text-navy-600 [overflow-wrap:anywhere]`}>
                          {g.latest.law_ref} · 기준일 {g.latest.reference_date ?? "없음"} · 판 {g.latest.version} (모두 {g.versions.length}판)
                          {g.latest.reason && ` · 사유 ${g.latest.reason}`}
                        </p>
                        {canEdit && (
                          <details className="mt-3">
                            <summary className="cursor-pointer font-bold text-navy-900">새 판으로 고치기</summary>
                            <div className="mt-3">
                              <FactForm
                                slug={m.slug}
                                supersedesId={g.latest.id}
                                initial={{
                                  fact_key: g.fact_key,
                                  label: g.latest.label,
                                  value: g.latest.value,
                                  unit: g.latest.unit ?? "",
                                  law_ref: g.latest.law_ref,
                                  reference_date: g.latest.reference_date ?? "",
                                  source_url: g.latest.source_url,
                                }}
                              />
                            </div>
                          </details>
                        )}
                        {canSign && !g.latest.reviewed_by && g.latest.reference_date && (
                          <div className="mt-3">
                            <SignButton body={{ target: "fact", slug: m.slug, fact_id: g.latest.id }} label={`${g.latest.label} 서명`} />
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {canEdit && (
                  <details className="mt-4">
                    <summary className="cursor-pointer font-bold text-navy-900">숫자 요건 첫 판 적기</summary>
                    <div className="mt-3">
                      <FactForm slug={m.slug} />
                    </div>
                  </details>
                )}
              </section>
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}
