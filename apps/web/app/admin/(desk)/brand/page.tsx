import type { Metadata } from "next";
import { ApprovalForm, BrandActionButton, ConsentForm, EVIDENCE_KIND_LABEL, EvidenceForm, SCOPE_LABEL } from "@/components/admin/BrandControls";
import { EmptyNote, MONO, PageTitle, Panel, ToneChip } from "@/components/admin/ui";
import { can } from "@/lib/access";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { dbError } from "@/lib/server/http";

// 브랜드 관리 (/admin/brand — W3 7단계, PRD-01C BR-01·03·07·10) — 브랜드 관리 담당·관리자만(brand.manage).
//  · 증빙 위치 등록은 브랜드 관리 담당도, 증빙 승인·동의서 기록/철회·경력 표시 승인·광고 규정 감수·브랜드 문구 스위치는 관리자(PO)만(brand.approve)
//  · 증빙·동의서 문서와 약력·경력 문구는 저장소 밖(PO가 넣는다). 이 화면은 위치·승인 기록만 남기고 모두 감사 로그에 남는다
//  · 재감수 큐: 세무 감수 서명 뒤 실질 수정이 생겨 '감수 ○○' 표시가 내려간 공개 기사
export const metadata: Metadata = { title: "브랜드 관리" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = { active: "활성", withdrawn: "철회", expired: "만료" };

interface PersonRow {
  id: number;
  slug: string;
  name: string;
  roles: string[];
  visibility: string;
  bio_items: { item?: string; evidence_id?: string }[];
}
interface EvidenceRow {
  id: number;
  person_id: number;
  kind: keyof typeof EVIDENCE_KIND_LABEL;
  doc_ref: string;
  approved: boolean;
  verified_by: string | null;
  verified_at: string | null;
}
interface ConsentRow {
  id: number;
  person_id: number;
  version: string;
  scope: (keyof typeof SCOPE_LABEL)[];
  doc_ref: string;
  valid_from: string;
  valid_to: string | null;
  status: string;
  is_current: boolean;
}
interface QueueRow {
  article_id: number;
  title: string;
  reviewed_version: number;
  current_version: number;
}

export default async function BrandPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "brand.manage");
  const approver = can(viewer, "brand.approve");
  const db = serviceDb();
  const [people, evidence, consents, settings, queue] = await Promise.all([
    db.from("people").select("id, slug, name, roles, visibility, bio_items").order("id"),
    db.from("people_evidence").select("id, person_id, kind, doc_ref, approved, verified_by, verified_at").order("id"),
    db.from("name_consent_docs").select("id, person_id, version, scope, doc_ref, valid_from, valid_to, status, is_current").order("id"),
    db.from("settings").select("key, value").in("key", ["career_claim_approved", "brand_copy_review", "feature_flags"]),
    db.from("tax_rereview_queue").select("article_id, title, reviewed_version, current_version").order("article_id"),
  ]);
  for (const [r, what] of [[people, "people"], [evidence, "people_evidence"], [consents, "name_consent_docs"], [settings, "settings"], [queue, "tax_rereview_queue"]] as const) {
    if (r.error) throw dbError(r.error, `${what} 목록`);
  }
  const persons = (people.data ?? []) as PersonRow[];
  const ev = (evidence.data ?? []) as EvidenceRow[];
  const cs = (consents.data ?? []) as ConsentRow[];
  const by = (k: string) => ((settings.data ?? []) as { key: string; value: Record<string, unknown> }[]).find((s) => s.key === k)?.value ?? {};
  const claim = by("career_claim_approved");
  const review = by("brand_copy_review");
  const brandCopyOn = by("feature_flags").brand_copy === true;
  const rereview = (queue.data ?? []) as QueueRow[];

  return (
    <>
      <PageTitle
        title="브랜드 관리"
        description="경력 증빙·이름/초상 동의서·브랜드 공개 승인입니다. 문서는 저장소 밖에 두고 위치만 적습니다. 증빙이 승인된 약력 줄만, 동의서가 활성인 사람의 인물 페이지만 공개됩니다."
      />
      <div className="space-y-8">
        <Panel id="brand-switches" title="브랜드 공개 조건">
          <ul className="space-y-3 text-[15px] text-navy-800" data-part="brand-status">
            <li data-state={claim.approved === true ? "on" : "off"}>
              경력 표시 증빙 승인: <ToneChip>{claim.approved === true ? `승인 (근거 증빙 ${String(claim.basis_evidence_id)}번)` : "승인 전"}</ToneChip>
            </li>
            <li data-state={review.reviewed === true ? "on" : "off"}>
              광고 규정 감수 기록: <ToneChip>{review.reviewed === true ? "기록 있음" : "기록 없음"}</ToneChip>
            </li>
            <li data-state={brandCopyOn ? "on" : "off"}>
              브랜드 문구 공개(brand_copy): <ToneChip>{brandCopyOn ? "켜짐" : "꺼짐"}</ToneChip>
            </li>
          </ul>
          {approver ? (
            <div className="mt-4 grid gap-6 sm:grid-cols-2">
              {claim.approved === true ? (
                <BrandActionButton action="career-claim-off" body={{ op: "career_claim", value: false }} label="경력 표시 승인 철회" okText="철회했습니다." confirmText="경력 표시 승인을 거두면 브랜드 문구도 함께 내려갑니다." />
              ) : (
                <ApprovalForm op="career_claim" label="경력 표시 승인" field="basisEvidenceId" fieldLabel="근거 증빙 번호 (승인된 증빙)" />
              )}
              {review.reviewed === true ? (
                <BrandActionButton action="brand-review-off" body={{ op: "brand_review", value: false }} label="감수 기록 철회" okText="철회했습니다." />
              ) : (
                <ApprovalForm op="brand_review" label="광고 규정 감수 기록" field="recordRef" fieldLabel="감수 기록 위치 (PRD-01C 13장 #22)" />
              )}
              <BrandActionButton action="brand-copy-toggle" body={{ op: "brand_copy", value: !brandCopyOn }} label={brandCopyOn ? "브랜드 문구 끄기" : "브랜드 문구 켜기"} okText="바꿨습니다." />
            </div>
          ) : (
            <p className="mt-4 text-[15px] text-navy-600">승인·스위치는 관리자(PO)만 바꿉니다.</p>
          )}
        </Panel>

        <Panel id="brand-rereview" title="재감수 큐" description="세무 감수 서명 뒤 실질 수정이 생겨 감수 표시가 내려간 공개 기사입니다. 감수위원이 현재 버전에 다시 서명하면 빠집니다.">
          {rereview.length === 0 ? (
            <EmptyNote>재감수할 기사가 없습니다.</EmptyNote>
          ) : (
            <ul className="space-y-2 text-[15px]" data-testid="rereview-queue">
              {rereview.map((q) => (
                <li key={q.article_id} data-article-id={q.article_id}>
                  <a className="font-bold text-navy-900 underline" href={`/admin/articles/${q.article_id}`}>
                    {q.title}
                  </a>{" "}
                  <span className={MONO}>
                    서명 v{q.reviewed_version} → 현재 v{q.current_version}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel id="brand-people" title="인물별 증빙·동의서">
          {persons.length === 0 ? (
            <EmptyNote>인물이 없습니다.</EmptyNote>
          ) : (
            <ul className="space-y-6" data-testid="brand-people">
              {persons.map((p) => {
                const mine = ev.filter((e) => e.person_id === p.id);
                const docs = cs.filter((c) => c.person_id === p.id);
                const current = docs.find((c) => c.is_current);
                return (
                  <li key={p.id} data-person-id={p.id} className="rounded-xl border border-navy-100 p-4">
                    <p className="text-[16px] font-bold text-navy-900">
                      {p.name} <span className={MONO}>#{p.id} · {p.slug}</span> <ToneChip>{p.visibility === "public" ? "공개" : "비공개"}</ToneChip>{" "}
                      <ToneChip>{current ? `동의서 ${current.version} · ${STATUS_LABEL[current.status] ?? current.status}` : "동의서 없음"}</ToneChip>
                    </p>
                    <p className="mt-1 text-[14px] text-navy-600">약력 항목 {p.bio_items?.length ?? 0}줄 (공개는 승인된 증빙을 가리키는 줄만)</p>
                    <div className="mt-3 grid gap-6 lg:grid-cols-2">
                      <section aria-label={`${p.name} 증빙`}>
                        <h3 className="text-[15px] font-bold text-navy-900">증빙</h3>
                        {mine.length === 0 ? (
                          <EmptyNote>증빙이 없습니다.</EmptyNote>
                        ) : (
                          <ul className="mt-2 space-y-2 text-[14px]">
                            {mine.map((e) => (
                              <li key={e.id} data-evidence-id={e.id} className="flex flex-wrap items-center gap-2">
                                <span className={MONO}>#{e.id}</span> {EVIDENCE_KIND_LABEL[e.kind] ?? e.kind} · {e.doc_ref} <ToneChip>{e.approved ? "승인" : "승인 전"}</ToneChip>
                                {approver &&
                                  (e.approved ? (
                                    <BrandActionButton action={`evidence-revoke-${e.id}`} body={{ op: "evidence_revoke", id: e.id }} label="승인 거둠" okText="거뒀습니다." />
                                  ) : (
                                    <BrandActionButton action={`evidence-approve-${e.id}`} body={{ op: "evidence_approve", id: e.id }} label="확인·승인" okText="승인했습니다." />
                                  ))}
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="mt-3">
                          <EvidenceForm personId={p.id} />
                        </div>
                      </section>
                      <section aria-label={`${p.name} 동의서`}>
                        <h3 className="text-[15px] font-bold text-navy-900">동의서</h3>
                        {docs.length === 0 ? (
                          <EmptyNote>동의서가 없습니다 — 이 사람의 인물 페이지·칼럼은 공개되지 않습니다.</EmptyNote>
                        ) : (
                          <ul className="mt-2 space-y-2 text-[14px]">
                            {docs.map((c) => (
                              <li key={c.id} data-consent-id={c.id} className="flex flex-wrap items-center gap-2">
                                <span className={MONO}>{c.version}</span> {c.scope.map((s) => SCOPE_LABEL[s] ?? s).join(" · ")}{" "}
                                <ToneChip>{`${STATUS_LABEL[c.status] ?? c.status}${c.is_current ? " · 현재" : ""}`}</ToneChip>
                                {approver && c.status !== "withdrawn" && (
                                  <BrandActionButton action={`consent-withdraw-${c.id}`} body={{ op: "consent_withdraw", id: c.id }} label="철회 기록" okText="철회했습니다." confirmText="철회하면 다음 요청부터 인물 페이지가 내려갑니다." />
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                        {approver && (
                          <div className="mt-3">
                            <ConsentForm personId={p.id} />
                          </div>
                        )}
                      </section>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
