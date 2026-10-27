import type { Metadata } from "next";
import { OpButton, OpForm, type LnField } from "@/components/admin/LocalNewsControls";
import { DataTable, EmptyNote, MONO, PageTitle, Panel, TD, ToneChip } from "@/components/admin/ui";
import { certKindLabel } from "@/lib/security/cert-plan";
import { SECURITY_ITEM_KEYS, SECURITY_ITEM_TITLES } from "@/lib/security/items";
import { loadCertPlanBoard } from "@/lib/server/security/cert-plan";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { loadSecurityBoard } from "@/lib/server/security/board";

// 보안 정책 (/admin/security - W12-g g3, PRD-04 SEC-01, docs/dev/W12-g_설계.md). 관리자(PO)만.
//  · 7개 항목 본문·마지막 확인일은 PO가 입력합니다. 7개가 모두 게시되고 자가 점검이 1회 완료되고 기능 키 security_page가 켜져야 /security가 열립니다.
//  · AI 제공사 데이터 정책 항목은 계약을 확인했다는 체크가 있어야 게시됩니다. 인증을 받은 것으로 읽히는 표현은 초안도 게시도 거부됩니다.
export const metadata: Metadata = { title: "보안 정책" };
export const dynamic = "force-dynamic";

const ENDPOINT = "/api/admin/security";
const TONE = { draft: "amber", published: "emerald", retired: "navy" } as const;
const STATUS = { draft: "초안", published: "게시", retired: "내림" } as const;
const RESULT = { met: "충족", gap: "미흡", na: "해당 없음" } as const;
const DRAFT_FIELDS: LnField[] = [
  { name: "item_key", label: "항목", type: "select", options: [{ value: "", label: "고르세요" }, ...SECURITY_ITEM_KEYS.map((k) => ({ value: k, label: SECURITY_ITEM_TITLES[k] }))], required: true },
  { name: "body", label: "본문 (4000자 이하, 직접 작성)", type: "area", required: true },
  { name: "confirmed_on", label: "마지막 확인일 (YYYY-MM-DD)", required: true },
  { name: "contract_verified", label: "계약 확인함 (AI 제공사 데이터 정책 항목만 필요)", type: "check" },
];
const CHECK_FIELDS: LnField[] = [
  { name: "round_no", label: "점검 회차 (1부터)", required: true },
  { name: "control_key", label: "통제 키 (영문 소문자·숫자·_)", required: true },
  { name: "control_title", label: "통제 이름 (120자 이하)", required: true },
  { name: "result", label: "결과", type: "select", options: [{ value: "", label: "고르세요" }, { value: "met", label: "충족" }, { value: "gap", label: "미흡" }, { value: "na", label: "해당 없음" }], required: true },
  { name: "checked_on", label: "점검일 (YYYY-MM-DD)", required: true },
  { name: "gap_plan", label: "조치 계획 (미흡이면 필수)", type: "area" },
  { name: "due_on", label: "조치 기한 (미흡이면 필수, YYYY-MM-DD)" },
];

const CERT_ENDPOINT = "/api/admin/security-cert";
const CERT_TONE = { draft: "amber", approved: "emerald", superseded: "navy", withdrawn: "navy" } as const;
const CERT_STATUS = { draft: "초안", approved: "승인", superseded: "교체됨", withdrawn: "철회" } as const;
const CERT_FIELDS: LnField[] = [
  { name: "cert_kind", label: "인증 종류", type: "select", options: [{ value: "", label: "고르세요" }, { value: "iso27001", label: "ISO/IEC 27001" }, { value: "ismsp", label: "ISMS-P" }, { value: "other", label: "기타" }], required: true },
  { name: "other_kind_name", label: "기타 종류 이름 (기타일 때만)" },
  { name: "scope", label: "인증 범위 (2000자 이하, 직접 작성)", type: "area", required: true },
  { name: "target_start_on", label: "목표 시작일 (YYYY-MM-DD)", required: true },
  { name: "target_end_on", label: "목표 종료일 (YYYY-MM-DD)", required: true },
  { name: "cost_estimate_krw", label: "비용 추정 (원)", required: true },
  { name: "owner_name", label: "담당", required: true },
  { name: "entity_name", label: "운영 주체 명의 (승인에 필요)" },
  { name: "risk_assessed_on", label: "위험 평가 실시일 (승인에 필요, YYYY-MM-DD)" },
  { name: "note", label: "메모 (1000자 이하)", type: "area" },
];

export default async function SecurityAdminPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "security_page.edit");
  requirePage(viewer, "security_cert.edit");
  const board = await loadSecurityBoard(serviceDb());
  const cert = await loadCertPlanBoard(serviceDb());
  return (
    <>
      <PageTitle title="보안 정책" description="보안 정책 페이지(/security) 7개 항목과 통제 목록 자가 점검입니다. 본문은 직접 작성해 넣습니다. 7개 항목 게시와 자가 점검 1회 완료가 모두 되어야 페이지가 열립니다." />
      <div className="space-y-8">
        <Panel id="sec-items" title="항목">
          {board.items.length === 0 ? (
            <EmptyNote>등록된 항목이 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="보안 정책 항목" head={["번호", "항목", "버전", "확인일", "상태", "처리"]}>
              {board.items.map((i) => (
                <tr key={i.id} data-id={i.id} data-status={i.status} data-key={i.item_key}>
                  <td className={`${TD} ${MONO}`}>{i.id}</td>
                  <td className={TD}>{SECURITY_ITEM_TITLES[i.item_key as keyof typeof SECURITY_ITEM_TITLES] ?? i.item_key}</td>
                  <td className={`${TD} ${MONO}`}>{i.version}</td>
                  <td className={`${TD} ${MONO}`}>{i.confirmed_on}</td>
                  <td className={TD}><ToneChip tone={TONE[i.status]}>{STATUS[i.status]}</ToneChip></td>
                  <td className={TD}>
                    {i.status === "draft" && <OpButton id={`sec-publish-${i.id}`} op="publish" label="게시" ctx={{ id: i.id }} endpoint={ENDPOINT} />}
                    {i.status === "published" && <OpButton id={`sec-retire-${i.id}`} op="retire" label="내리기" ctx={{ id: i.id }} endpoint={ENDPOINT} />}
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
        <Panel id="sec-new" title="항목 초안" description="같은 항목으로 다시 적으면 새 버전이 됩니다. 게시하면 이전 게시본은 내림 표시가 됩니다.">
          <OpForm id="sec-draft" op="draft" label="항목 초안" submit="초안 저장" endpoint={ENDPOINT} fields={DRAFT_FIELDS} />
        </Panel>
        <Panel id="sec-checks" title="통제 자가 점검">
          <p className="mb-2 text-[14px]">완료한 회차: {board.rounds.length === 0 ? "없음" : board.rounds.map((r) => `${r.round_no}회차(${r.completed_on}, 통제 ${r.controls}개, 미흡 ${r.gaps}개)`).join(" · ")}</p>
          {board.checks.length === 0 ? (
            <EmptyNote>점검 기록이 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="통제 점검 기록" head={["회차", "통제", "결과", "점검일", "조치 계획", "기한"]}>
              {board.checks.map((c) => (
                <tr key={c.id} data-result={c.result}>
                  <td className={`${TD} ${MONO}`}>{c.round_no}</td>
                  <td className={TD}>{c.control_title}<br /><span className={`text-[13px] ${MONO}`}>{c.control_key}</span></td>
                  <td className={TD}>{RESULT[c.result]}</td>
                  <td className={`${TD} ${MONO}`}>{c.checked_on}</td>
                  <td className={TD}>{c.gap_plan ?? ""}</td>
                  <td className={`${TD} ${MONO}`}>{c.due_on ?? ""}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
        <Panel id="sec-check-new" title="통제 점검 입력" description="같은 회차·통제에 다시 적으면 나중에 적은 값이 현재 값입니다. 완료한 회차에는 더 적을 수 없습니다.">
          <OpForm id="sec-check" op="check" label="통제 점검" submit="기록" endpoint={ENDPOINT} fields={CHECK_FIELDS} />
          <OpForm id="sec-complete" op="complete_round" label="회차 완료" submit="회차 완료" endpoint={ENDPOINT} fields={[{ name: "round_no", label: "완료할 회차", required: true }]} />
        </Panel>
        <Panel id="sec-cert" title="정보보호 인증 추진 계획" description={`기관 판매 게이트: ${cert.gateOpen ? "승인된 계획 있음" : "승인된 계획 없음 (기관 결제 화면 닫힘)"}. 승인과 기능 키 security_cert_plan 켜짐이 모두 되어야 /security에 '추진 중'이 보입니다. 인증을 취득했다는 표현은 쓸 수 없습니다.`}>
          {cert.plans.length === 0 ? (
            <EmptyNote>등록된 계획이 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="인증 추진 계획" head={["번호", "종류", "범위", "일정", "비용 추정(원)", "담당", "명의", "위험 평가일", "상태", "처리"]}>
              {cert.plans.map((p) => (
                <tr key={p.id} data-id={p.id} data-status={p.status}>
                  <td className={`${TD} ${MONO}`}>{p.id}</td>
                  <td className={TD}>{certKindLabel(p.cert_kind, p.other_kind_name)}</td>
                  <td className={TD}>{p.scope}</td>
                  <td className={`${TD} ${MONO}`}>{p.target_start_on} ~ {p.target_end_on}</td>
                  <td className={`${TD} ${MONO}`}>{p.cost_estimate_krw.toLocaleString("ko-KR")}</td>
                  <td className={TD}>{p.owner_name}</td>
                  <td className={TD}>{p.entity_name ?? ""}</td>
                  <td className={`${TD} ${MONO}`}>{p.risk_assessed_on ?? ""}</td>
                  <td className={TD}><ToneChip tone={CERT_TONE[p.status]}>{CERT_STATUS[p.status]}</ToneChip></td>
                  <td className={TD}>
                    {p.status === "draft" && <OpButton id={`cert-approve-${p.id}`} op="approve" label="승인" ctx={{ id: p.id }} endpoint={CERT_ENDPOINT} />}
                    {(p.status === "draft" || p.status === "approved") && <OpButton id={`cert-withdraw-${p.id}`} op="withdraw" label="철회" ctx={{ id: p.id }} endpoint={CERT_ENDPOINT} />}
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
          <OpForm id="cert-draft" op="draft" label="추진 계획 초안" submit="초안 저장" endpoint={CERT_ENDPOINT} fields={CERT_FIELDS} />
          {cert.audit.length > 0 && (
            <DataTable caption="인증 추진 계획 승인·철회 기록" head={["시각", "계획", "행위", "결과", "행위자"]}>
              {cert.audit.map((a) => (
                <tr key={a.id} data-outcome={a.outcome} data-code={a.code}>
                  <td className={`${TD} ${MONO}`}>{a.at.slice(0, 16).replace("T", " ")}</td>
                  <td className={TD}>{a.plan_id}</td>
                  <td className={TD}>{a.action === "approve" ? "승인" : "철회"}</td>
                  <td className={TD}>{a.outcome === "ok" ? "성공" : `거부 (${a.code})`}</td>
                  <td className={`${TD} ${MONO}`}>{a.actor}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
        <Panel id="sec-audit" title="게시·점검 기록 (최근 40건)">
          {board.audit.length === 0 ? (
            <EmptyNote>아직 기록이 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="보안 정책 감사" head={["시각", "대상", "행위", "결과", "행위자"]}>
              {board.audit.map((a) => (
                <tr key={a.id} data-outcome={a.outcome} data-code={a.code}>
                  <td className={`${TD} ${MONO}`}>{a.at.slice(0, 16).replace("T", " ")}</td>
                  <td className={TD}>{a.subject === "item" ? "항목" : "회차"} {a.target_id}</td>
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
