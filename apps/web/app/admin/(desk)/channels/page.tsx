import type { Metadata } from "next";
import { OpForm, type LnField } from "@/components/admin/LocalNewsControls";
import { DataTable, EmptyNote, MONO, PageTitle, Panel, TD, ToneChip } from "@/components/admin/ui";
import { CHANNEL_KEYS, CHECKLIST_KEYS, CHECKLIST_LABELS } from "@/lib/channels/kit";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { loadChannelBoard } from "@/lib/server/channels/board";

// 채널 배포 키트 (/admin/channels - W12-h h4, PRD-04 CH-01, docs/dev/W12-h_설계.md). 편집 책임자·관리자.
//  · 승인된 채널 원고만 기사별 키트(텍스트)로 내려받을 수 있습니다. 승인 전 원고는 키트에 들어가지 않습니다.
//  · 게시는 사람이 각 채널 계정으로 직접 합니다. 이 화면은 외부 채널로 아무것도 보내지 않고, 게시한 링크와 체크리스트만 기록합니다.
export const metadata: Metadata = { title: "채널 배포 키트" };
export const dynamic = "force-dynamic";

const ENDPOINT = "/api/admin/channels";
const TONE = { drafted: "amber", in_review: "amber", approved: "emerald", published: "emerald", rejected: "rose", failed: "rose" } as const;
const POST_FIELDS: LnField[] = [
  { name: "review_item_id", label: "원고 번호 (승인된 것만)", required: true },
  { name: "posted_url", label: "게시한 링크 (https)", required: true },
  ...CHECKLIST_KEYS.map((k) => ({ name: k, label: CHECKLIST_LABELS[k], type: "check" as const })),
];

export default async function ChannelsAdminPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "channel.record");
  const board = await loadChannelBoard(serviceDb());
  const articles = [...new Set(board.drafts.filter((d) => d.article_id !== null && (d.status === "approved" || d.status === "published")).map((d) => d.article_id as number))];
  return (
    <>
      <PageTitle title="채널 배포 키트" description={`승인된 원고를 기사별로 내려받아 사람이 직접 게시하고, 게시 링크를 기록합니다. 채널: ${CHANNEL_KEYS.join(" · ")}`} />
      <div className="space-y-8">
        <Panel id="ch-kit" title="키트 내려받기">
          {articles.length === 0 ? (
            <EmptyNote>승인된 채널 원고가 없습니다. 편집국 AI 화면에서 원고를 승인하면 여기에 기사가 나옵니다.</EmptyNote>
          ) : (
            <ul className="list-disc pl-5 text-[14px]">
              {articles.map((id) => (
                <li key={id}>
                  <a data-kit-link={id} href={`${ENDPOINT}?kit=${id}`} className="font-bold underline underline-offset-2">기사 {id} 키트 내려받기</a>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel id="ch-drafts" title="채널 원고">
          {board.drafts.length === 0 ? (
            <EmptyNote>채널 원고가 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="채널 원고" head={["번호", "기사", "채널", "상태", "게시 기록"]}>
              {board.drafts.map((d) => (
                <tr key={d.id} data-id={d.id} data-status={d.status}>
                  <td className={`${TD} ${MONO}`}>{d.id}</td>
                  <td className={`${TD} ${MONO}`}>{d.article_id ?? ""}</td>
                  <td className={`${TD} ${MONO}`}>{d.channel ?? ""}</td>
                  <td className={TD}><ToneChip tone={TONE[d.status as keyof typeof TONE] ?? "navy"}>{d.status}</ToneChip></td>
                  <td className={TD}>{d.posted_url ? <a href={d.posted_url} rel="noopener noreferrer" target="_blank" className="underline">{d.posted_at?.slice(0, 16).replace("T", " ")}</a> : ""}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
        <Panel id="ch-post" title="게시 기록" description="게시를 마친 뒤 링크를 적습니다. 체크리스트 4개를 모두 확인해야 기록됩니다. 기록한 원고는 채널 유입 측정에 쓰입니다.">
          <OpForm id="ch-post-form" op="post" label="게시 기록" submit="기록" endpoint={ENDPOINT} fields={POST_FIELDS} />
        </Panel>
        <Panel id="ch-audit" title="키트·게시 기록 (최근 40건)">
          {board.audit.length === 0 ? (
            <EmptyNote>아직 기록이 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="채널 감사" head={["시각", "원고", "행위", "결과", "행위자"]}>
              {board.audit.map((a) => (
                <tr key={a.id} data-outcome={a.outcome} data-code={a.code}>
                  <td className={`${TD} ${MONO}`}>{a.at.slice(0, 16).replace("T", " ")}</td>
                  <td className={`${TD} ${MONO}`}>{a.review_item_id ?? ""}</td>
                  <td className={TD}>{a.action === "kit" ? "키트" : "게시 기록"}</td>
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
