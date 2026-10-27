import type { Metadata } from "next";
import Link from "next/link";
import { OpButton, OpForm, type LnField } from "@/components/admin/LocalNewsControls";
import { DataTable, EmptyNote, MONO, PageTitle, Panel, TD, TEXT_LINK, ToneChip } from "@/components/admin/ui";
import { serviceDb } from "@/lib/server/articles/service";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { loadExpertBoard, type BoardProfile } from "@/lib/server/experts/board";
import { ExpertLinksPanel } from "@/components/admin/ExpertLinksPanel";
import { loadLinkBoard } from "@/lib/server/qna/admin";

// SM 전문가 등재 (/admin/experts - W7c, PRD-01C EXPL-01·02·05·07·08·13·17~21, docs/dev/W7c_설계.md 1장 3단계).
//  · 프로필 등록·공개·내림·철회와 분류·고지문·연락 정책·요청 처리는 관리자(PO)만 한다. 전문가 담당(expert_ops)은 화면 읽기까지.
//  · 프로필 내용은 SM 소속 전문가 본인이 준 자료로 PO가 직접 적는다(AI 작성 0). 채워 넣는 기본값 0.
//  · 요청 목록에는 이름·연락처·요약이 없다 - 상세(/admin/experts/requests/[id])를 열 때만 보이고 열람이 감사 로그에 남는다.
export const metadata: Metadata = { title: "전문가 등재" };
export const dynamic = "force-dynamic";

const ENDPOINT = "/api/admin/experts";
const STATUS_LABEL: Record<string, string> = { draft: "초안(비공개)", published: "공개 중", withdrawn: "철회" };
const REQUEST_STATUS_LABEL: Record<string, string> = { received: "접수", contacted: "첫 연락", closed: "종결" };
const CLOSE_LABEL: Record<string, string> = { contract: "계약 진행", guidance_end: "안내 종료", unreachable: "연락 불가", withdrawn: "이용자 철회" };
const REL_OPTIONS = [
  { value: "", label: "고르세요" },
  { value: "employed", label: "SM에 고용됨" },
  { value: "sm_corporation", label: "SM 법인 소속" },
];

const PROFILE_FIELDS: LnField[] = [
  { name: "slug", label: "주소 이름 (영문 소문자·숫자·-)", required: true },
  { name: "name", label: "실명", required: true },
  { name: "category_codes", label: "분류 코드 (쉼표로 여러 개 - 예: 분류 표의 코드)", required: true },
  { name: "specialties", label: "전문 분야 (쉼표로 구분, 각 30자 이하)" },
  { name: "office_name", label: "소속 (SM 법인·사무소)", required: true },
  { name: "house_relation", label: "SM 소속 형태", type: "select", options: REL_OPTIONS, required: true },
  { name: "regions", label: "활동 지역 (표시만 - 쉼표로 구분)" },
  { name: "contact_links", label: "연락 링크 (줄마다 이름|https 주소, 3개 이하)", type: "area" },
  { name: "interests", label: "이해관계 (이 플랫폼과의 관계, 300자 이하)", type: "area" },
  { name: "intro", label: "소개 (400자 이하, 본인이 준 자료)", type: "area" },
  { name: "photo_media_id", label: "사진 이미지 번호 (권리 확인된 사진만, 없으면 비움)" },
];

function profileInitial(p: BoardProfile): Record<string, string> {
  return {
    id: String(p.id),
    slug: p.slug,
    name: p.name,
    category_codes: p.category_codes.join(", "),
    specialties: p.specialties.join(", "),
    office_name: p.office_name,
    house_relation: p.house_relation,
    regions: p.regions.join(", "),
    contact_links: p.contact_links.map((l) => `${l.label}|${l.url}`).join("\n"),
    interests: p.interests,
    intro: p.intro,
    photo_media_id: p.photo_media_id ? String(p.photo_media_id) : "",
  };
}

export default async function ExpertsPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "expert.manage");
  const isAdmin = viewer.isAdmin;
  const board = await loadExpertBoard(serviceDb(), { withRequests: isAdmin });
  const linkBoard = isAdmin ? await loadLinkBoard(serviceDb()) : null;
  const catName = (code: string) => board.categories.find((c) => c.code === code)?.name ?? code;
  const noticeApproved = board.notice.approved === true;
  const policyApproved = board.policy.approved === true;
  const n = (k: string) => String(board.notice[k] ?? "");
  const p = (k: string) => String(board.policy[k] ?? "");
  const lines = (k: string) => (Array.isArray(board.policy[k]) ? (board.policy[k] as string[]).join("\n") : "");

  return (
    <>
      <PageTitle title="전문가 등재" description="이 사이트는 SM(선명) 소속 전문가만 소개합니다. 프로필은 소속 전문가 본인이 준 자료로 관리자(PO)가 등록하고, 본인 동의서 기록을 남긴 뒤 공개합니다. 외부 등재 신청·유료 등재·후기·순위는 없습니다." />
      <div className="space-y-8">
        <Panel id="ex-gate" title="공개 조건" description="기능 키 experts·expert_requests는 설정 화면에서 켭니다. 고지문(법률 검토본)이 승인되어야 전문가 소개를, 연락 요청 정책(실사·감수 기록)이 승인되어야 연락 요청을 켤 수 있습니다.">
          <p data-testid="ex-gate-state" className="text-[15px] text-navy-800">
            전문가 소개 <ToneChip tone={board.flags.experts ? "emerald" : "amber"}>{board.flags.experts ? "켜짐" : "꺼짐"}</ToneChip> · 연락 요청{" "}
            <ToneChip tone={board.flags.expert_requests ? "emerald" : "amber"}>{board.flags.expert_requests ? "켜짐" : "꺼짐"}</ToneChip> · 고지문 {noticeApproved ? `승인(${n("version")})` : "미승인"} · 연락 요청 정책{" "}
            {policyApproved ? `승인(${p("consent_version")})` : "미승인"}
          </p>
          {!isAdmin && <p className="text-[14px] text-navy-600">이 화면의 쓰기와 요청 열람은 관리자만 합니다.</p>}
        </Panel>

        {linkBoard && <ExpertLinksPanel links={linkBoard.links} profiles={linkBoard.publishedProfiles} />}

        {isAdmin && (
          <>
            <Panel id="ex-categories" title="분류" description="공개 화면에는 공개 중인 SM 전문가가 1명 이상인 분류만 나옵니다. 기본 5개(세무사·공인회계사·변호사·공인중개사·법무사)는 PO 결정입니다.">
              <DataTable caption="전문가 분류" head={["코드", "이름", "순서", "상태"]}>
                {board.categories.map((c) => (
                  <tr key={c.code} data-category={c.code}>
                    <td className={`${TD} ${MONO}`}>{c.code}</td>
                    <td className={TD}>{c.name}</td>
                    <td className={TD}>{c.sort_order}</td>
                    <td className={TD}>{c.active ? "열림" : "닫힘"}</td>
                  </tr>
                ))}
              </DataTable>
              <details>
                <summary className="cursor-pointer font-bold text-navy-900">분류 만들기·고치기</summary>
                <div className="mt-3">
                  <OpForm
                    id="ex-cat"
                    op="category"
                    label="분류 저장"
                    submit="분류 저장"
                    endpoint={ENDPOINT}
                    fields={[
                      { name: "code", label: "코드 (영문 소문자·숫자·-)", required: true },
                      { name: "name", label: "이름", required: true },
                      { name: "sort_order", label: "순서 (작을수록 앞)" },
                      { name: "active", label: "열림 (체크 해제하면 새 프로필에 쓸 수 없고 공개 화면에서 빠집니다)", type: "check" },
                    ]}
                    initial={{ active: true }}
                  />
                </div>
              </details>
            </Panel>

            <Panel id="ex-notice" title="전문가 소개 고지문 (법률 검토본)" description="법률 검토를 마친 문구만 넣습니다 (13장 #20). 승인에는 버전·문구·검토자·검토일이 모두 필요합니다.">
              <OpForm
                id="ex-notice-form"
                op="notice"
                label="고지문 저장"
                submit="고지문 저장"
                endpoint={ENDPOINT}
                initial={{ version: n("version"), text: n("text"), reviewed_by: n("reviewed_by"), reviewed_on: n("reviewed_on"), approved: board.notice.approved === true }}
                fields={[
                  { name: "version", label: "검토본 버전" },
                  { name: "text", label: "고지 문구 (600자 이하)", type: "area" },
                  { name: "reviewed_by", label: "검토자" },
                  { name: "reviewed_on", label: "검토일 (YYYY-MM-DD)" },
                  { name: "approved", label: "승인 - 이 문구가 법률 검토본입니다", type: "check" },
                ]}
              />
            </Panel>

            <Panel id="ex-policy" title="SM 전문가 연락 요청 정책" description="안내 문단·동의 항목은 법률 검토본만 넣습니다. 승인에는 실사(#12)·감수(#20) 기록 번호가 필요합니다. 요청의 담당·알림은 관리자 계정(ADMIN_EMAILS)입니다.">
              <OpForm
                id="ex-policy-form"
                op="policy"
                label="연락 요청 정책 저장"
                submit="정책 저장"
                endpoint={ENDPOINT}
                initial={{
                  retention_days: p("retention_days"),
                  target_business_days: p("target_business_days"),
                  summary_max_chars: p("summary_max_chars"),
                  consent_version: p("consent_version"),
                  intro: lines("intro"),
                  consent_items: lines("consent_items"),
                  reviewed_by: p("reviewed_by") === "null" ? "" : p("reviewed_by"),
                  reviewed_on: p("reviewed_on") === "null" ? "" : p("reviewed_on"),
                  due_diligence_ref: p("due_diligence_ref"),
                  legal_review_ref: p("legal_review_ref"),
                  approved: board.policy.approved === true,
                }}
                fields={[
                  { name: "retention_days", label: "보관 기간 (일, 30~1825)", required: true },
                  { name: "target_business_days", label: "첫 연락 목표 (영업일, 1~10)", required: true },
                  { name: "summary_max_chars", label: "요약 글자 수 상한 (100~2000)", required: true },
                  { name: "consent_version", label: "동의 문구 버전" },
                  { name: "intro", label: "양식 위 안내 문단 (줄마다 하나, 6개 이하)", type: "area" },
                  { name: "consent_items", label: "필수 동의 항목 (줄마다 하나, 6개 이하)", type: "area" },
                  { name: "reviewed_by", label: "검토자" },
                  { name: "reviewed_on", label: "검토일 (YYYY-MM-DD)" },
                  { name: "due_diligence_ref", label: "실사(#12) 기록 번호" },
                  { name: "legal_review_ref", label: "감수(#20) 기록 번호" },
                  { name: "approved", label: "승인 - 모든 검토 기록이 갖춰졌습니다", type: "check" },
                ]}
              />
            </Panel>
          </>
        )}

        <Panel id="ex-profiles" title={`프로필 ${board.profiles.length}명`} description="공개하려면 본인 동의서 기록(버전·받은 날·보관 위치)이 필요합니다. 내리면 다음 요청부터 공개 화면·검색에서 사라집니다.">
          {board.profiles.length === 0 ? (
            <EmptyNote>등록된 프로필이 없습니다.</EmptyNote>
          ) : (
            <ul className="space-y-4" data-testid="ex-profile-list">
              {board.profiles.map((pr) => (
                <li key={pr.id} data-profile-id={pr.id} data-profile-slug={pr.slug} data-status={pr.status} className="rounded-xl border border-navy-100 p-4 text-[15px]">
                  <p className="font-bold text-navy-900">
                    {pr.name} <ToneChip tone={pr.status === "published" ? "emerald" : pr.status === "withdrawn" ? "rose" : "amber"}>{STATUS_LABEL[pr.status]}</ToneChip>
                  </p>
                  <p className="mt-1 text-navy-700">
                    {pr.category_codes.map(catName).join(" · ")} · {pr.office_name} · <span className={MONO}>{pr.slug}</span>
                  </p>
                  {pr.consent_version && (
                    <p className={`${MONO} mt-1 text-navy-600`}>
                      본인 동의서 {pr.consent_version} · {pr.consent_on} · {pr.consent_doc_ref}
                    </p>
                  )}
                  {pr.withdrawn_reason && <p className="mt-1 text-navy-700">철회 사유: {pr.withdrawn_reason}</p>}
                  {isAdmin && pr.status !== "withdrawn" && (
                    <div className="mt-3 space-y-3">
                      <details>
                        <summary className="cursor-pointer font-bold text-navy-900">내용 고치기</summary>
                        <div className="mt-3">
                          <OpForm id={`ex-edit-${pr.id}`} op="profile" label="프로필 고치기" submit="저장" endpoint={ENDPOINT} fields={PROFILE_FIELDS} initial={profileInitial(pr)} ctx={{ id: pr.id }} />
                        </div>
                      </details>
                      {pr.status === "published" ? (
                        <OpButton id={`ex-unpub-${pr.id}`} op="unpublish" label="내리기" ctx={{ id: pr.id }} endpoint={ENDPOINT} />
                      ) : (
                        <details>
                          <summary className="cursor-pointer font-bold text-navy-900">본인 동의서 기록을 남기고 공개</summary>
                          <div className="mt-3">
                            <OpForm
                              id={`ex-pub-${pr.id}`}
                              op="publish"
                              label="프로필 공개"
                              submit="공개"
                              endpoint={ENDPOINT}
                              ctx={{ id: pr.id }}
                              fields={[
                                { name: "consent_version", label: "본인 동의서 버전", required: true },
                                { name: "consent_on", label: "동의서 받은 날 (YYYY-MM-DD)", required: true },
                                { name: "consent_doc_ref", label: "동의서 보관 위치", required: true },
                              ]}
                            />
                          </div>
                        </details>
                      )}
                      <details>
                        <summary className="cursor-pointer font-bold text-navy-900">철회 (본인 요청)</summary>
                        <div className="mt-3">
                          <OpForm id={`ex-wd-${pr.id}`} op="withdraw" label="프로필 철회" submit="철회" endpoint={ENDPOINT} ctx={{ id: pr.id }} fields={[{ name: "reason", label: "철회 사유", required: true }]} />
                        </div>
                      </details>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {isAdmin && (
            <details>
              <summary className="cursor-pointer font-bold text-navy-900">프로필 등록 (초안으로 저장)</summary>
              <div className="mt-3">
                <OpForm id="ex-new" op="profile" label="프로필 등록" submit="초안으로 저장" endpoint={ENDPOINT} fields={PROFILE_FIELDS} />
              </div>
            </details>
          )}
        </Panel>

        {isAdmin && (
          <Panel id="ex-requests" title={`연락 요청 ${board.requests.length}건`} description="목표 시간 안 연락률 = 마감 전 첫 연락 ÷ 접수. 이름·연락처·요약은 상세를 열 때만 보이고 열람이 기록됩니다.">
            <p data-testid="ex-contact-rate" className="text-[15px] text-navy-800">
              목표 시간 안 연락률 {board.contactRate.onTime}/{board.contactRate.total}
            </p>
            {board.requests.length === 0 ? (
              <EmptyNote>접수된 연락 요청이 없습니다.</EmptyNote>
            ) : (
              <DataTable caption="연락 요청" head={["접수 번호", "분야", "상태", "목표 시간", "열기"]}>
                {board.requests.map((r) => (
                  <tr key={r.id} data-request-id={r.id} data-receipt={r.receipt_no} data-status={r.status} data-overdue={r.overdue ? "true" : "false"}>
                    <td className={`${TD} ${MONO}`}>{r.receipt_no}</td>
                    <td className={TD}>{catName(r.category_code)}</td>
                    <td className={TD}>
                      {REQUEST_STATUS_LABEL[r.status]}
                      {r.close_reason ? ` (${CLOSE_LABEL[r.close_reason]})` : ""}
                      {r.overdue ? " - 목표 시간 경과" : ""}
                    </td>
                    <td className={`${TD} ${MONO}`}>{r.due_at.slice(0, 16).replace("T", " ")} UTC</td>
                    <td className={TD}>
                      <Link href={`/admin/experts/requests/${r.id}`} className={TEXT_LINK}>
                        열기
                      </Link>
                    </td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Panel>
        )}
      </div>
    </>
  );
}
