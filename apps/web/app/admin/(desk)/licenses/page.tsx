import type { Metadata } from "next";
import { OpButton, OpForm, type LnField } from "@/components/admin/LocalNewsControls";
import { DataTable, EmptyNote, MONO, PageTitle, Panel, TD } from "@/components/admin/ui";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { loadLicenseBoard } from "@/lib/server/partner-feeds/board";

// 라이선스·네이버 연재 (/admin/licenses - W13-i, PRD-05 BIZ-11 · CH-02). 관리자(PO)만.
//  · 계약 범위·정산 조건·권리 근거는 PO 입력 칸입니다. 이 화면에 기본값·법률 문구는 없습니다.
//  · 네이버 연재는 원고를 준비해 내려받고, 사람이 올린 뒤 링크만 기록합니다. 외부로 보내는 것은 없습니다.
//  · 연재 화면·원고에 '네이버 제휴 언론사' 표현은 쓰지 않습니다(뉴스 제휴와 다른 상태).
export const metadata: Metadata = { title: "라이선스·연재" };
export const dynamic = "force-dynamic";

const ENDPOINT = "/api/admin/licenses";
const CONTRACT_FIELDS: LnField[] = [
  { name: "counterparty", label: "상대방", required: true },
  { name: "kind", label: "종류", type: "select", required: true, options: [{ value: "data_license", label: "데이터 라이선스" }, { value: "naver_series", label: "네이버 프리미엄 연재" }] },
  { name: "partner_id", label: "제휴사 번호 (선택)" },
  { name: "scope", label: "범위 (PO 입력)", type: "area", required: true },
  { name: "period_start", label: "시작일 (YYYY-MM-DD)", required: true },
  { name: "period_end", label: "종료일 (YYYY-MM-DD)", required: true },
  { name: "settlement_terms", label: "정산 조건 (PO 입력, 비우면 [확인 필요])", type: "area" },
  { name: "rights_ref", label: "권리 근거 (전문 허용에 필요)" },
  { name: "allows_full", label: "전문 제공 허용 (데이터 라이선스만, 권리 근거 필요)", type: "check" },
];
const PREPARE_FIELDS: LnField[] = [
  { name: "article_id", label: "프리미엄 칼럼 기사 번호", required: true },
  { name: "contract_id", label: "네이버 연재 계약 번호", required: true },
];
const POST_FIELDS: LnField[] = [
  { name: "manuscript_id", label: "원고 번호", required: true },
  { name: "posted_url", label: "게시한 링크 (https)", required: true },
  { name: "double_pay_notice_ok", label: "사이트 구독자에게 이중 결제 안내를 했습니다", type: "check" },
];

export default async function LicensesAdminPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "licenses.edit");
  const board = await loadLicenseBoard(serviceDb());
  return (
    <>
      <PageTitle title="라이선스·연재" description="데이터 라이선스와 네이버 프리미엄 연재 계약을 기록하고, 연재 원고를 준비합니다. 계약 조건은 PO가 입력합니다." />
      <div className="space-y-8">
        <Panel id="lic-contracts" title="계약">
          {board.contracts.length === 0 ? (
            <EmptyNote>계약 기록이 없습니다. 계약이 없으면 피드 키 발급과 연재 원고 준비는 닫혀 있습니다.</EmptyNote>
          ) : (
            <DataTable caption="계약" head={["번호", "상대방", "종류", "기간", "정산 조건", "상태", "종료"]}>
              {board.contracts.map((c) => (
                <tr key={c.id} data-id={c.id} data-status={c.status}>
                  <td className={`${TD} ${MONO}`}>{c.id}</td>
                  <td className={TD}>{c.counterparty}</td>
                  <td className={TD}>{c.kind === "naver_series" ? "네이버 연재" : "데이터 라이선스"}</td>
                  <td className={`${TD} ${MONO}`}>{c.period_start} ~ {c.period_end}</td>
                  <td className={TD}>{c.settlement_terms ?? "[확인 필요]"}</td>
                  <td className={TD}>{c.status === "active" ? "유효" : "종료"}</td>
                  <td className={TD}>{c.status === "active" ? <OpButton id={`lic-end-${c.id}`} op="terminate" label="계약 종료" ctx={{ contract_id: c.id }} endpoint={ENDPOINT} /> : ""}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
        <Panel id="lic-record" title="계약 기록">
          <OpForm id="lic-contract-form" op="contract" label="계약 기록" submit="기록" endpoint={ENDPOINT} fields={CONTRACT_FIELDS} />
        </Panel>
        <Panel id="lic-manuscripts" title="네이버 프리미엄 연재 원고" description="승인되어 발행된 프리미엄 칼럼 중 유료 판매 권리가 확인된 것만 준비할 수 있습니다. 자동 게시는 없습니다.">
          {board.manuscripts.length === 0 ? (
            <EmptyNote>준비된 원고가 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="연재 원고" head={["번호", "기사", "계약", "상태", "내려받기"]}>
              {board.manuscripts.map((m) => (
                <tr key={m.id} data-id={m.id} data-status={m.status}>
                  <td className={`${TD} ${MONO}`}>{m.id}</td>
                  <td className={`${TD} ${MONO}`}>{m.article_id}</td>
                  <td className={`${TD} ${MONO}`}>{m.contract_id}</td>
                  <td className={TD}>{m.status === "posted" && m.posted_url ? <a href={m.posted_url} rel="noopener noreferrer" target="_blank" className="underline">게시 완료</a> : "준비됨"}</td>
                  <td className={TD}><a data-manuscript-link={m.id} href={`${ENDPOINT}?manuscript=${m.id}`} className="font-bold underline underline-offset-2">원고 {m.id} 내려받기</a></td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
        <Panel id="lic-prepare" title="원고 준비">
          <OpForm id="lic-prepare-form" op="prepare" label="원고 준비" submit="준비" endpoint={ENDPOINT} fields={PREPARE_FIELDS} />
        </Panel>
        <Panel id="lic-post" title="게시 기록" description="사람이 네이버에 올린 뒤 링크를 적습니다. 이중 결제 안내를 확인해야 기록됩니다.">
          <OpForm id="lic-post-form" op="post" label="게시 기록" submit="기록" endpoint={ENDPOINT} fields={POST_FIELDS} />
        </Panel>
      </div>
    </>
  );
}
