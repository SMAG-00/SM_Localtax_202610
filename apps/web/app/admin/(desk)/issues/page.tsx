import type { Metadata } from "next";
import { OpButton, OpForm, type LnField } from "@/components/admin/LocalNewsControls";
import { DataTable, EmptyNote, MONO, PageTitle, Panel, TD, ToneChip } from "@/components/admin/ui";
import { can } from "@/lib/access";
import { GRAPH_HUB_LABEL, GRAPH_HUBS, GRAPH_STATUS_LABEL } from "@/lib/issues/input";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { loadGraphsBoard } from "@/lib/server/issues/board";

// 쟁점 연결 지도 (/admin/issues - W11-d d5, PRD-03 LINK-01, docs/dev/W11-d_설계.md 5장).
//  · 경로는 하나: 초안 -> 검토 요청 -> 세무 감수위원 서명 -> 공개. 서명 없는 버전에는 [공개] 버튼이 없고, DB 함수도 거부한다.
//  · 노드는 번호만 받는다(조문 law_articles 번호·결정례 legal_docs 번호). 이름·조문 번호·시행일은 원문 DB에서 읽고, 없는 번호는 저장이 거부된다.
//  · 이 화면은 쟁점 내용도 조문도 만들지 않는다. 붙여 넣은 값을 형식 검사해 초안으로만 저장한다.
export const metadata: Metadata = { title: "쟁점 연결 지도" };
export const dynamic = "force-dynamic";

const ENDPOINT = "/api/admin/issues";
const TONE = { draft: "navy", in_review: "amber", signed: "amber", published: "emerald", retired: "navy" } as const;
const CREATE_FIELDS: LnField[] = [
  { name: "slug", label: "주소 slug (영문 소문자·숫자·-)", required: true },
  { name: "hub", label: "허브", type: "select", options: [{ value: "", label: "고르세요" }, ...GRAPH_HUBS.map((h) => ({ value: h, label: GRAPH_HUB_LABEL[h] }))], required: true },
  { name: "title", label: "쟁점 이름 (가운데 상자)", required: true },
  { name: "summary", label: "요약 (500자 이하)", type: "area" },
  { name: "as_of", label: "기준일 (YYYY-MM-DD)" },
  { name: "nodes", label: "노드 JSON ([{node_id:\"n1\", kind:\"law_article\"|\"case\", ref_id:번호}])", type: "area", required: true },
  { name: "edges", label: "연결선 JSON ([{from, to, relation: delegation|mutatis|requirement|precedent, note?}])", type: "area", required: true },
  { name: "guide_refs", label: "가이드 참조 JSON ([{slug, anchor?}])", type: "area" },
];
const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") : "-");

export default async function IssuesAdminPage() {
  const viewer = await pageViewer();
  requirePage(viewer, can(viewer, "issue_graph.edit") ? "issue_graph.edit" : "issue_graph.sign");
  const canEdit = can(viewer, "issue_graph.edit");
  const canSign = can(viewer, "issue_graph.sign");
  const board = await loadGraphsBoard(serviceDb());
  return (
    <>
      <PageTitle
        title="쟁점 연결 지도"
        description="신탁·정비 쟁점별로 조문과 결정례를 관계 라벨로 잇는 지도의 버전입니다. 초안은 검토를 요청하고, 세무 감수위원이 서명해야 공개할 수 있습니다. 이미 있는 버전은 고치지 않고 새 버전 초안을 만듭니다. 연결 조문이 개정되면 '개정 반영 검토 중' 표시가 붙고 공통 검수 큐에 항목이 생깁니다."
      />
      <div className="space-y-8">
        <Panel id="ig-versions" title="지도 버전">
          {board.graphs.length === 0 ? (
            <EmptyNote>등록된 쟁점 지도가 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="쟁점 지도 버전" head={["쟁점", "버전", "상태", "규모", "서명", "처리"]}>
              {board.graphs.map((g) => (
                <tr key={g.id} data-id={g.id} data-status={g.status} data-slug={g.slug} data-stale={g.stale_reason ? "true" : "false"}>
                  <td className={TD}>
                    {g.title}
                    <br />
                    <span className={`text-[13px] ${MONO}`}>{GRAPH_HUB_LABEL[g.hub] ?? g.hub} · {g.slug}</span>
                  </td>
                  <td className={`${TD} ${MONO}`}>{g.version}</td>
                  <td className={TD}>
                    <ToneChip tone={TONE[g.status]}>{GRAPH_STATUS_LABEL[g.status]}</ToneChip>
                    {g.stale_reason && <ToneChip tone="amber">개정 반영 검토 중</ToneChip>}
                  </td>
                  <td className={TD}>
                    상자 {g.nodeCount} · 연결선 {g.edgeCount}
                    <br />
                    <span className="text-[13px]">{g.as_of ?? "기준일 없음"}</span>
                  </td>
                  <td className={TD}>{g.signed_at ? `${when(g.signed_at)} · ${g.sheet_ref ?? ""}` : "서명 없음"}</td>
                  <td className={TD}>
                    {g.status === "draft" && canEdit && <OpButton id={`ig-submit-${g.id}`} op="submit" label="검토 요청" ctx={{ id: g.id }} endpoint={ENDPOINT} />}
                    {g.status === "in_review" && canSign && (
                      <OpForm id={`ig-sign-${g.id}`} op="sign" label={`${g.title} 감수 서명`} submit="감수 서명" endpoint={ENDPOINT} ctx={{ id: g.id }} fields={[{ name: "sheet_ref", label: "감수 시트 위치 (200자 이하)", required: true }]} />
                    )}
                    {g.status === "in_review" && !canSign && <span className="text-[13px]">감수위원 서명 대기</span>}
                    {g.status === "signed" && canEdit && <OpButton id={`ig-publish-${g.id}`} op="publish" label="공개" ctx={{ id: g.id }} endpoint={ENDPOINT} />}
                    {g.status === "published" && canEdit && <OpButton id={`ig-retire-${g.id}`} op="retire" label="내리기" ctx={{ id: g.id }} endpoint={ENDPOINT} />}
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
        {canEdit && (
          <Panel id="ig-new" title="초안 만들기" description="같은 slug로 저장하면 새 버전 초안이 됩니다. 노드 번호는 법령 뷰어·결정례 화면에서 확인한 번호를 넣습니다. 서명 전이라 사이트에는 나오지 않습니다.">
            <OpForm id="ig-create" op="create" label="초안 만들기" submit="초안 저장" endpoint={ENDPOINT} fields={CREATE_FIELDS} />
          </Panel>
        )}
        <Panel id="ig-audit" title="검토·서명·공개 기록 (최근 40건)">
          {board.audit.length === 0 ? (
            <EmptyNote>아직 기록이 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="쟁점 지도 감사" head={["시각", "버전", "행위", "결과", "행위자", "사유"]}>
              {board.audit.map((a) => (
                <tr key={a.id} data-outcome={a.outcome} data-code={a.code}>
                  <td className={`${TD} ${MONO}`}>{when(a.at)}</td>
                  <td className={TD}>{a.target_id}</td>
                  <td className={TD}>{a.action}</td>
                  <td className={TD}>{a.outcome === "ok" ? "성공" : `거부 (${a.code})`}</td>
                  <td className={`${TD} ${MONO}`}>{a.actor}</td>
                  <td className={TD}>{a.detail ?? "-"}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
      </div>
    </>
  );
}
