import type { Metadata } from "next";
import { OpButton, OpForm, type LnField } from "@/components/admin/LocalNewsControls";
import { DataTable, EmptyNote, MONO, PageTitle, Panel, TD, ToneChip } from "@/components/admin/ui";
import { can } from "@/lib/access";
import { KIND_LABEL, STATUS_LABEL, type OrdinanceStatus } from "@/lib/ordinances/input";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { loadOrdinancesBoard } from "@/lib/server/ordinances/board";

// 조례 연결 (/admin/ordinances - W11-e e6, PRD-03 RDV-06 · TX-13).
//  · 시·도 도시정비 조례와 시·군·구 감면·세율 조례가 같은 목록·등록 화면·확인일 규칙을 쓴다.
//  · 원문은 원문 DB에 한 번만 저장하고, 이 화면은 연결·요약·확인일만 다룬다. 요약의 숫자가 원문에 없으면 저장되지 않는다.
//  · 요약은 세무 감수위원이 서명한 뒤에만 공개 화면에 나온다. 조례 내용은 계산기 룰셋에 반영되지 않는다.
export const metadata: Metadata = { title: "조례 연결" };
export const dynamic = "force-dynamic";

const ENDPOINT = "/api/admin/ordinances";
const STATUS_TONE = { draft: "navy", public: "emerald", hidden: "amber" } as const;
const REGISTER_FIELDS: LnField[] = [
  { name: "name", label: "조례 이름", required: true },
  { name: "region_code", label: "지역 코드 (10자리 - 도시정비는 시·도, 감면·세율은 시·군·구)", required: true },
  { name: "kind", label: "종류", type: "select", options: [{ value: "", label: "고르세요" }, ...Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))], required: true },
  { name: "source_url", label: "출처 주소 (http/https)", required: true },
  { name: "promulgation_no", label: "공포번호", required: true },
  { name: "promulgated_on", label: "공포일 (YYYY-MM-DD)", required: true },
  { name: "effective_from", label: "시행일 (YYYY-MM-DD)", required: true },
  { name: "verified_at", label: "확인일 (YYYY-MM-DD)", required: true },
  { name: "article_no", label: "조문 번호 (기본 1)" },
  { name: "article_title", label: "조문 제목" },
  { name: "body_text", label: "원문 글자 (공식 출처에서 그대로 붙여 넣기)", type: "area", required: true },
  { name: "summary", label: "편집 요약 (선택 - 숫자는 원문에 있는 것만)", type: "area" },
];

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "-");

export default async function OrdinancesPage() {
  const viewer = await pageViewer();
  requirePage(viewer, can(viewer, "ordinance.manage") ? "ordinance.manage" : "ordinance_summary.sign");
  const canManage = can(viewer, "ordinance.manage");
  const canSign = can(viewer, "ordinance_summary.sign");
  const board = await loadOrdinancesBoard(serviceDb());
  const stale = new Set(board.stale.ordinance);
  return (
    <>
      <PageTitle title="조례 연결" description="시·도 도시정비 조례와 시·군·구 감면·세율 조례의 연결입니다. 출처·시행일·확인일이 모두 있고 요약이 서명되어야 공개 화면에 나옵니다. 조례 내용은 계산기에 반영되지 않습니다." />
      <div className="space-y-8">
        <Panel id="ord-links" title="조례 연결">
          {board.links.length === 0 ? (
            <EmptyNote>등록된 조례 연결이 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="조례 연결" head={["조례", "지역·종류", "상태", "시행일·확인일", "요약", "처리"]}>
              {board.links.map((l) => (
                <tr key={l.id} data-id={l.id} data-status={l.status} data-stale={stale.has(l.id) ? "true" : "false"}>
                  <td className={TD}>
                    {l.laws?.name ?? "-"}
                    <br />
                    <span className="text-[13px]">{l.origin === "collector" ? "수집" : "편집자 등록"}</span>
                  </td>
                  <td className={TD}>
                    <span className={MONO}>{l.region_code}</span>
                    <br />
                    <span className="text-[13px]">{KIND_LABEL[l.kind as keyof typeof KIND_LABEL] ?? l.kind}</span>
                  </td>
                  <td className={TD}>
                    <ToneChip tone={STATUS_TONE[l.status as OrdinanceStatus] ?? "navy"}>{STATUS_LABEL[l.status as OrdinanceStatus] ?? l.status}</ToneChip>
                  </td>
                  <td className={`${TD} ${MONO}`}>
                    {l.effective_from ?? "-"}
                    <br />
                    {day(l.verified_at)}
                    {stale.has(l.id) && <ToneChip tone="amber">확인일 경과</ToneChip>}
                  </td>
                  <td className={TD}>{l.summary ? (l.summary_signed_at ? `서명됨 ${day(l.summary_signed_at)}` : "서명 대기") : "요약 없음"}</td>
                  <td className={TD}>
                    {canManage && <OpButton id={`ord-verify-${l.id}`} op="verify" label="확인일 갱신" ctx={{ id: l.id }} endpoint={ENDPOINT} />}
                    {canManage && l.status !== "public" && <OpButton id={`ord-public-${l.id}`} op="status" label="공개" ctx={{ id: l.id, status: "public" }} endpoint={ENDPOINT} />}
                    {canManage && l.status === "public" && <OpButton id={`ord-hide-${l.id}`} op="status" label="숨김" ctx={{ id: l.id, status: "hidden" }} endpoint={ENDPOINT} />}
                    {canManage && (
                      <OpForm id={`ord-summary-${l.id}`} op="summary" label={`${l.laws?.name ?? ""} 요약 저장`} submit="요약 저장" endpoint={ENDPOINT} ctx={{ id: l.id }} fields={[{ name: "summary", label: "편집 요약", type: "area" }]} />
                    )}
                    {l.summary && !l.summary_signed_at && canSign && <OpButton id={`ord-sign-${l.id}`} op="sign" label="요약 감수 서명" ctx={{ id: l.id }} endpoint={ENDPOINT} />}
                    {l.summary && !l.summary_signed_at && !canSign && <span className="text-[13px]">감수위원 서명 대기</span>}
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
        {canManage && (
          <Panel id="ord-new" title="조례 등록" description="공식 출처에서 확인한 조례를 직접 등록합니다. 원문은 원문 DB에 한 번만 저장되고, 이미 있는 조례면 새 개정판으로 더해집니다.">
            <OpForm id="ord-register" op="register" label="조례 등록" submit="등록" endpoint={ENDPOINT} fields={REGISTER_FIELDS} />
          </Panel>
        )}
      </div>
    </>
  );
}
