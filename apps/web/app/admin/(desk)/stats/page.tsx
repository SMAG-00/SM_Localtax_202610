import type { Metadata } from "next";
import { OpButton, OpForm, type LnField } from "@/components/admin/LocalNewsControls";
import { DataTable, EmptyNote, MONO, PageTitle, Panel, TD, ToneChip } from "@/components/admin/ui";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { loadStatsBoard } from "@/lib/server/stats/board";

// 지방세 통계 (/admin/stats - W12-h h4, PRD-04 DATA-01, docs/dev/W12-h_설계.md). 편집 책임자·관리자.
//  · 수집 배치가 올린 시계열 초안을 확인하고 승인합니다. 값은 고칠 수 없고(새 판은 수집으로만), 승인해야 /data와 기사에 나옵니다.
//  · 기사에 차트를 붙이면 시계열 번호와 기준연도로 고정됩니다. 새 기준연도가 승인되면 연결 목록에 표시되니 기사를 다시 확인하세요.
export const metadata: Metadata = { title: "지방세 통계" };
export const dynamic = "force-dynamic";

const ENDPOINT = "/api/admin/stats";
const TONE = { draft: "amber", approved: "emerald", superseded: "navy", withdrawn: "rose" } as const;
const STATUS = { draft: "초안", approved: "승인", superseded: "이전 기준연도", withdrawn: "철회" } as const;
const ATTACH_FIELDS: LnField[] = [
  { name: "article_id", label: "기사 번호", required: true },
  { name: "series_id", label: "시계열 번호 (승인된 것만)", required: true },
  { name: "caption", label: "차트 제목 (120자 이하, 비우면 시계열 제목)" },
];

export default async function StatsAdminPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "stats.approve");
  const board = await loadStatsBoard(serviceDb());
  const newer = board.links.filter((l) => l.newer_base_year !== null);
  return (
    <>
      <PageTitle title="지방세 통계" description="수집한 통계 시계열 초안을 확인하고 승인합니다. 출처·기준연도·확인일이 모두 있어야 공개 화면에 그려집니다." />
      <div className="space-y-8">
        <Panel id="stats-series" title="시계열">
          {board.series.length === 0 ? (
            <EmptyNote>수집된 시계열이 없습니다. 수집 원천이 이용 조건 확인 전이면 수집은 돌지 않습니다.</EmptyNote>
          ) : (
            <DataTable caption="통계 시계열" head={["번호", "키", "제목", "기준연도", "판", "확인일", "출처", "상태", "처리"]}>
              {board.series.map((s) => (
                <tr key={s.id} data-id={s.id} data-status={s.status}>
                  <td className={`${TD} ${MONO}`}>{s.id}</td>
                  <td className={`${TD} ${MONO}`}>{s.series_key}</td>
                  <td className={TD}>{s.title}</td>
                  <td className={`${TD} ${MONO}`}>{s.base_year}</td>
                  <td className={`${TD} ${MONO}`}>{s.version}</td>
                  <td className={`${TD} ${MONO}`}>{s.checked_at}</td>
                  <td className={TD}>{s.source_name}</td>
                  <td className={TD}><ToneChip tone={TONE[s.status]}>{STATUS[s.status]}</ToneChip></td>
                  <td className={TD}>
                    {s.status === "draft" && <OpButton id={`stats-approve-${s.id}`} op="approve" label="승인" ctx={{ id: s.id }} endpoint={ENDPOINT} />}
                    {(s.status === "approved" || s.status === "superseded") && (
                      <OpForm id={`stats-withdraw-${s.id}`} op="withdraw" label="철회" submit="철회" endpoint={ENDPOINT} ctx={{ id: s.id }} fields={[{ name: "reason", label: "철회 이유", required: true }]} />
                    )}
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
        <Panel id="stats-newer" title="새 기준연도가 나온 기사 차트" description="연결된 차트는 기준연도가 고정되어 그대로 보입니다. 새 기준연도 자료로 바꿀지 기사를 확인하세요.">
          {newer.length === 0 ? (
            <EmptyNote>해당하는 기사가 없습니다.</EmptyNote>
          ) : (
            <ul className="list-disc pl-5 text-[14px]">
              {newer.map((l) => (
                <li key={l.id} data-newer-link={l.id}>
                  기사 {l.article_id} - {l.series_key} 기준연도 {l.base_year} -&gt; 새 기준연도 {l.newer_base_year}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel id="stats-links" title="기사 차트 연결">
          {board.links.length === 0 ? (
            <EmptyNote>연결된 차트가 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="기사 차트 연결" head={["번호", "기사", "시계열", "기준연도", "처리"]}>
              {board.links.map((l) => (
                <tr key={l.id} data-link={l.id}>
                  <td className={`${TD} ${MONO}`}>{l.id}</td>
                  <td className={`${TD} ${MONO}`}>{l.article_id}</td>
                  <td className={`${TD} ${MONO}`}>{l.series_id} ({l.series_key})</td>
                  <td className={`${TD} ${MONO}`}>{l.base_year}</td>
                  <td className={TD}><OpButton id={`stats-detach-${l.id}`} op="detach" label="해제" ctx={{ id: l.id }} endpoint={ENDPOINT} /></td>
                </tr>
              ))}
            </DataTable>
          )}
          <OpForm id="stats-attach" op="attach" label="기사에 차트 연결" submit="연결" endpoint={ENDPOINT} fields={ATTACH_FIELDS} />
        </Panel>
        <Panel id="stats-audit" title="수집·승인 기록 (최근 40건)">
          {board.audit.length === 0 ? (
            <EmptyNote>아직 기록이 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="통계 감사" head={["시각", "대상", "행위", "결과", "행위자"]}>
              {board.audit.map((a) => (
                <tr key={a.id} data-outcome={a.outcome} data-code={a.code}>
                  <td className={`${TD} ${MONO}`}>{a.at.slice(0, 16).replace("T", " ")}</td>
                  <td className={`${TD} ${MONO}`}>{a.target_id ?? ""}</td>
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
