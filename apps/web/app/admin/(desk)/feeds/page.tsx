import type { Metadata } from "next";
import { OpButton } from "@/components/admin/LocalNewsControls";
import { FeedIssueForm } from "@/components/admin/FeedIssueForm";
import { DataTable, EmptyNote, MONO, PageTitle, Panel, TD, ToneChip } from "@/components/admin/ui";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { loadFeedBoard } from "@/lib/server/partner-feeds/board";

// 제휴 피드 키 (/admin/feeds - W13-i, PRD-05 PART-01). 관리자(PO)만.
//  · 키는 데이터 라이선스 계약이 있어야 발급됩니다. 키 원문은 발급 직후 한 번만 보이고, 서버에는 해시만 있습니다.
//  · 폐기하면 다음 요청부터 401입니다. 이 화면은 외부로 아무것도 보내지 않습니다.
export const metadata: Metadata = { title: "제휴 피드" };
export const dynamic = "force-dynamic";

const ENDPOINT = "/api/admin/feeds";

export default async function FeedsAdminPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "feeds.issue");
  const board = await loadFeedBoard(serviceDb());
  return (
    <>
      <PageTitle title="제휴 피드" description="제휴 미디어·세무법인에 발급하는 RSS·JSON 피드 키를 관리합니다. 피드에는 무료 공개 기사만 나가며 프리미엄 본문은 어떤 경우에도 나가지 않습니다." />
      <div className="space-y-8">
        <Panel id="feed-issue" title="키 발급" description="계약 번호는 아래 '데이터 라이선스 계약' 표에서 확인합니다. 계약이 없거나 기간이 지났으면 발급되지 않습니다.">
          <FeedIssueForm />
        </Panel>
        <Panel id="feed-keys" title="발급된 키">
          {board.feeds.length === 0 ? (
            <EmptyNote>발급된 키가 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="제휴 피드 키" head={["번호", "제휴사", "계약", "범위", "발급", "상태", "폐기"]}>
              {board.feeds.map((f) => (
                <tr key={f.id} data-id={f.id} data-revoked={f.revoked_at ? "true" : "false"}>
                  <td className={`${TD} ${MONO}`}>{f.id}</td>
                  <td className={`${TD} ${MONO}`}>{f.partner_id}</td>
                  <td className={`${TD} ${MONO}`}>{f.contract_id}</td>
                  <td className={TD}>{f.scope === "full" ? "전문" : "요약"}</td>
                  <td className={`${TD} ${MONO}`}>{f.issued_at.slice(0, 16).replace("T", " ")}</td>
                  <td className={TD}><ToneChip tone={f.revoked_at ? "rose" : "emerald"}>{f.revoked_at ? "폐기" : "사용 중"}</ToneChip></td>
                  <td className={TD}>{f.revoked_at ? "" : <OpButton id={`feed-revoke-${f.id}`} op="revoke" label="키 폐기" ctx={{ feed_id: f.id }} endpoint={ENDPOINT} />}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
        <Panel id="feed-contracts" title="데이터 라이선스 계약 (읽기)" description="계약 기록과 종료는 '라이선스' 화면에서 합니다. 범위·정산 조건 칸은 PO가 입력하며 비어 있으면 [확인 필요]입니다.">
          {board.contracts.length === 0 ? (
            <EmptyNote>데이터 라이선스 계약이 없습니다. 계약 기록이 없으면 키를 발급할 수 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="데이터 라이선스 계약" head={["번호", "상대방", "기간", "전문 허용", "상태"]}>
              {board.contracts.map((c) => (
                <tr key={c.id} data-id={c.id}>
                  <td className={`${TD} ${MONO}`}>{c.id}</td>
                  <td className={TD}>{c.counterparty}</td>
                  <td className={`${TD} ${MONO}`}>{c.period_start} ~ {c.period_end}</td>
                  <td className={TD}>{c.allows_full ? "허용" : "요약만"}</td>
                  <td className={TD}>{c.status === "active" ? "유효" : "종료"}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
        <Panel id="feed-usage" title="최근 요청 (40건)">
          {board.usage.length === 0 ? (
            <EmptyNote>아직 요청 기록이 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="제휴 피드 사용 기록" head={["시각", "키", "응답", "항목 수"]}>
              {board.usage.map((u) => (
                <tr key={u.id} data-code={u.response_code}>
                  <td className={`${TD} ${MONO}`}>{u.at.slice(0, 19).replace("T", " ")}</td>
                  <td className={`${TD} ${MONO}`}>{u.feed_id}</td>
                  <td className={`${TD} ${MONO}`}>{u.response_code}</td>
                  <td className={`${TD} ${MONO}`}>{u.item_count}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
      </div>
    </>
  );
}
