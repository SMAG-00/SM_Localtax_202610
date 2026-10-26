import type { Metadata } from "next";
import { OpButton, OpForm, type LnField } from "@/components/admin/LocalNewsControls";
import { DataTable, EmptyNote, MONO, PageTitle, Panel, TD, ToneChip } from "@/components/admin/ui";
import { can } from "@/lib/access";
import { TAG_HUB_LABEL, TAG_HUBS, TAG_STATUS_LABEL } from "@/lib/issues/input";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { loadTagsBoard } from "@/lib/server/issues/board";

// 쟁점 태그 (/admin/issue-tags - W11-d d2·d5, PRD-03 AIOPS-12, docs/dev/W11-d_설계.md 3장).
//  · 태그 사전은 편집자가 제안하고 승인해야 쓰입니다. 새 이름은 새 버전으로 쌓이고 폐기하면 연결은 이력으로 남고 목록에서 빠집니다.
//  · 결정례·해석에는 승인된 태그만 붙일 수 있고, 연결도 승인해야 쟁점 목록(신탁·정비 판례·해석 모음)에 오릅니다. 이 화면에 AI 제안은 없습니다.
export const metadata: Metadata = { title: "쟁점 태그" };
export const dynamic = "force-dynamic";

const ENDPOINT = "/api/admin/issue-tags";
const TONE = { proposed: "amber", approved: "emerald", retired: "navy" } as const;
const PROPOSE_FIELDS: LnField[] = [
  { name: "tag_key", label: "태그 키 (영문 소문자·숫자·_, 이미 있는 키면 새 버전)", required: true },
  { name: "label", label: "태그 이름 (60자 이하)", required: true },
  { name: "hub", label: "허브", type: "select", options: [{ value: "", label: "고르세요" }, ...TAG_HUBS.map((h) => ({ value: h, label: TAG_HUB_LABEL[h] }))], required: true },
  { name: "synonyms", label: "동의어 (쉼표로 구분, 20개까지)", type: "area" },
];
const APPLY_FIELDS: LnField[] = [
  { name: "case_id", label: "결정례·해석 번호", required: true },
  { name: "issue_tag_id", label: "승인된 쟁점 태그 번호", required: true },
];

export default async function IssueTagsPage() {
  const viewer = await pageViewer();
  requirePage(viewer, can(viewer, "issue_graph.edit") ? "issue_graph.edit" : "issue_tag.approve");
  const canEdit = can(viewer, "issue_graph.edit");
  const canApprove = can(viewer, "issue_tag.approve");
  const board = await loadTagsBoard(serviceDb());
  return (
    <>
      <PageTitle title="쟁점 태그" description="쟁점 태그 사전과 결정례·해석에 붙이는 태그입니다. 제안과 붙이기는 편집자가, 승인은 승인 권한자가 합니다. 승인 전 태그는 어떤 목록에도 나오지 않습니다." />
      <div className="space-y-8">
        <Panel id="it-tags" title="태그 사전">
          {board.tags.length === 0 ? (
            <EmptyNote>등록된 쟁점 태그가 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="쟁점 태그" head={["번호", "태그", "허브", "버전", "상태", "처리"]}>
              {board.tags.map((t) => (
                <tr key={t.id} data-id={t.id} data-status={t.status} data-key={t.tag_key}>
                  <td className={`${TD} ${MONO}`}>{t.id}</td>
                  <td className={TD}>
                    {t.label}
                    <br />
                    <span className={`text-[13px] ${MONO}`}>{t.tag_key}</span>
                  </td>
                  <td className={TD}>{TAG_HUB_LABEL[t.hub] ?? t.hub}</td>
                  <td className={`${TD} ${MONO}`}>{t.version}</td>
                  <td className={TD}>
                    <ToneChip tone={TONE[t.status]}>{TAG_STATUS_LABEL[t.status]}</ToneChip>
                  </td>
                  <td className={TD}>
                    {t.status === "proposed" && canApprove && <OpButton id={`it-approve-${t.id}`} op="approve" label="승인" ctx={{ id: t.id }} endpoint={ENDPOINT} />}
                    {t.status === "approved" && canApprove && <OpButton id={`it-retire-${t.id}`} op="retire" label="폐기" ctx={{ id: t.id }} endpoint={ENDPOINT} />}
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
        {canEdit && (
          <Panel id="it-new" title="태그 제안" description="이미 있는 키로 제안하면 새 버전이 됩니다. 승인되면 이전 승인본은 폐기 표시가 됩니다.">
            <OpForm id="it-propose" op="propose" label="태그 제안" submit="제안" endpoint={ENDPOINT} fields={PROPOSE_FIELDS} />
          </Panel>
        )}
        <Panel id="it-cases" title="결정례·해석 태그">
          {board.caseTags.length === 0 ? (
            <EmptyNote>태그가 붙은 결정례·해석이 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="결정례 태그" head={["번호", "결정례·해석", "태그 키", "상태", "처리"]}>
              {board.caseTags.map((c) => (
                <tr key={c.id} data-id={c.id} data-status={c.status}>
                  <td className={`${TD} ${MONO}`}>{c.id}</td>
                  <td className={`${TD} ${MONO}`}>{c.case_id}</td>
                  <td className={`${TD} ${MONO}`}>{c.tag_key}</td>
                  <td className={TD}>
                    <ToneChip tone={c.status === "approved" ? "emerald" : "amber"}>{TAG_STATUS_LABEL[c.status]}</ToneChip>
                  </td>
                  <td className={TD}>{c.status === "proposed" && canApprove && <OpButton id={`it-approve-case-${c.id}`} op="approve_case" label="승인" ctx={{ id: c.id }} endpoint={ENDPOINT} />}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
        {canEdit && (
          <Panel id="it-apply" title="결정례·해석에 태그 붙이기" description="승인된 태그만 붙일 수 있고, 붙인 뒤 연결을 승인해야 목록에 오릅니다. 같은 결정례에는 같은 태그를 한 번만 붙입니다.">
            <OpForm id="it-apply-form" op="apply" label="태그 붙이기" submit="붙이기" endpoint={ENDPOINT} fields={APPLY_FIELDS} />
          </Panel>
        )}
        <Panel id="it-audit" title="승인 기록 (최근 40건)">
          {board.audit.length === 0 ? (
            <EmptyNote>아직 기록이 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="쟁점 태그 감사" head={["시각", "대상", "행위", "결과", "행위자"]}>
              {board.audit.map((a) => (
                <tr key={a.id} data-outcome={a.outcome} data-code={a.code}>
                  <td className={`${TD} ${MONO}`}>{a.at.slice(0, 16).replace("T", " ")}</td>
                  <td className={TD}>{a.subject === "issue_tag" ? "태그" : "결정례 태그"} {a.target_id}</td>
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
