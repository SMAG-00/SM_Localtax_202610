import { OpForm } from "@/components/admin/LocalNewsControls";
import { DataTable, EmptyNote, MONO, Panel, TD, ToneChip } from "@/components/admin/ui";
import type { LinkRow } from "@/lib/server/qna/admin";

// SM 전문가 계정 연결 (W13-g EXP-01·02) - /admin/experts의 '계정 연결' 구역. 관리자(PO)만 본다.
// 라운지 '전문가 답변' 배지는 여기서 공개 SM 소속 프로필에 연결한 회원 계정에만 붙습니다. 회원이 스스로 신청하는 화면·외부 증빙 칸은 없습니다.
const ENDPOINT = "/api/admin/expert-links";
const STATUS: Record<string, string> = { active: "연결 중", revoked: "해제", expired: "기한 만료" };

export function ExpertLinksPanel({ links, profiles }: { links: LinkRow[]; profiles: { id: number; name: string; slug: string }[] }) {
  return (
    <Panel id="ex-links" title="계정 연결 (라운지 전문가 답변 배지)" description="공개 중인 SM 소속 프로필에 회원 계정(번호)을 연결합니다. 재검증 기한 전까지만 배지가 붙고, 프로필이 비공개·철회되면 자동으로 해제됩니다. 계정당 1개·프로필당 1개입니다.">
      {links.length === 0 ? (
        <EmptyNote>연결된 계정이 없습니다.</EmptyNote>
      ) : (
        <DataTable caption="계정 연결" head={["번호", "프로필", "계정 번호", "상태", "재검증 기한", "처리"]}>
          {links.map((l) => (
            <tr key={l.id} data-link-id={l.id} data-link-status={l.status}>
              <td className={`${TD} ${MONO}`}>{l.id}</td>
              <td className={TD}>{l.profile_name}</td>
              <td className={`${TD} ${MONO}`}>{l.user_id}</td>
              <td className={TD}>
                <ToneChip tone={l.status === "active" ? "emerald" : "plain"}>{STATUS[l.status] ?? l.status}</ToneChip>
                {l.ended_reason ? <span className="ml-2 text-[13px] text-navy-600">{l.ended_reason}</span> : null}
              </td>
              <td className={TD}>{l.expires_at.slice(0, 10)}</td>
              <td className={TD}>
                {l.status === "active" ? (
                  <div className="space-y-2">
                    <OpForm id={`ex-link-renew-${l.id}`} op="renew" label="기한 갱신" submit="기한 갱신" endpoint={ENDPOINT} ctx={{ id: l.id }} fields={[{ name: "expires_on", label: "새 재검증 기한 (YYYY-MM-DD)", required: true }]} />
                    <OpForm id={`ex-link-end-${l.id}`} op="end" label="연결 해제" submit="연결 해제" endpoint={ENDPOINT} ctx={{ id: l.id }} fields={[{ name: "reason", label: "해제 사유", required: true }]} />
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
      <details>
        <summary className="cursor-pointer font-bold text-navy-900">계정 연결하기</summary>
        <div className="mt-3 space-y-3">
          <p className="text-[14px] text-navy-700">연결할 수 있는 공개 프로필: {profiles.length === 0 ? "없음" : profiles.map((p) => `${p.name}(#${p.id})`).join(", ")}</p>
          <OpForm
            id="ex-link"
            op="link"
            label="계정 연결"
            submit="계정 연결"
            endpoint={ENDPOINT}
            fields={[
              { name: "user_id", label: "회원 계정 번호 (UUID)", required: true },
              { name: "profile_id", label: "프로필 번호", required: true },
              { name: "expires_on", label: "재검증 기한 (YYYY-MM-DD, 연 1회)", required: true },
            ]}
          />
        </div>
      </details>
    </Panel>
  );
}
