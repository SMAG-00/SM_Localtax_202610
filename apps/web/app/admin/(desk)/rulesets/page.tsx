import type { Metadata } from "next";
import { OpButton, OpForm, type LnField } from "@/components/admin/LocalNewsControls";
import { DataTable, EmptyNote, MONO, PageTitle, Panel, TD, ToneChip } from "@/components/admin/ui";
import { DETERMINATION_KIND_LABEL, DETERMINATION_TABLE_KINDS, RULE_KINDS, RULE_KIND_LABEL, STATUS_LABEL, type RuleKind } from "@/lib/accuracy/input";
import { can } from "@/lib/access";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { loadRulesBoard } from "@/lib/server/accuracy/board";
import { serviceDb } from "@/lib/server/articles/service";

// 룰셋·판정표·지방세 달력 (/admin/rulesets - W10-a a6, PRD-02 RULE-01~04, docs/dev/W10-a_설계.md 11.2).
//  · 경로는 하나: 초안 -> 세무 감수위원 서명 -> 관리자 승인. 서명 없는 버전에는 [활성화] 버튼이 없고, DB 함수도 거부한다.
//  · 값(세율·한도·요건·날짜)은 이 화면이 만들지 않는다. 룰셋 초안은 SM 엔진이 이미 가진 AI 작성·미감수 값이라 감수 서명 전에는 초안으로만 있다.
export const metadata: Metadata = { title: "룰셋·판정표·달력" };
export const dynamic = "force-dynamic";

const ENDPOINT = "/api/admin/rules";
const STATUS_TONE = { draft: "navy", reviewed: "amber", active: "emerald", retired: "navy" } as const;
const KIND_OPTIONS = [{ value: "", label: "고르세요" }, ...RULE_KINDS.map((k) => ({ value: k, label: RULE_KIND_LABEL[k] }))];
const CREATE_FIELDS: LnField[] = [
  { name: "kind", label: "종류", type: "select", options: KIND_OPTIONS, required: true },
  { name: "version", label: "버전 (YYYY.NN - 본문 안 version과 같아야 합니다)", required: true },
  { name: "source_ref", label: "출처 (파일·커밋·시트 위치, 200자 이하)", required: true },
  { name: "basis_event_id", label: "근거 개정 단계 기록 번호 (개정에 따른 변경이면 - 공포·시행 단계여야 승인됩니다)" },
  { name: "basis_note", label: "근거 사유 (근거 개정 번호가 없을 때 - 개정과 무관한 감수 정정 등)", type: "area" },
  { name: "topic", label: "요건 사전 주제 키 (요건 사전일 때만)" },
  { name: "body", label: "본문 JSON (룰셋은 status draft, 요건 사전은 as_of·fields)", type: "area", required: true },
];

// 판정표는 종류(탭)마다 따로 보인다 - 상속과 증여는 다른 종류다 (FAM-05)
interface PanelDef {
  kind: RuleKind;
  tk: string | null;
  title: string;
}
const PANELS: PanelDef[] = RULE_KINDS.flatMap((kind): PanelDef[] =>
  kind === "determination_table"
    ? DETERMINATION_TABLE_KINDS.map((tk) => ({ kind, tk, title: `판정표 · ${DETERMINATION_KIND_LABEL[tk]}` }))
    : [{ kind, tk: null, title: RULE_KIND_LABEL[kind] }],
);

function when(iso: string | null): string {
  return iso ? iso.slice(0, 16).replace("T", " ") : "-";
}

export default async function RulesetsPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "ruleset.read");
  const canSign = can(viewer, "ruleset.sign");
  const canApprove = can(viewer, "ruleset.approve");
  const board = await loadRulesBoard(serviceDb());
  const rowsOf = (k: RuleKind, tk: string | null) => board.versions.filter((v) => v.kind === k && (tk === null || v.table_kind === tk));
  return (
    <>
      <PageTitle
        title="룰셋·판정표·달력"
        description="세액 계산 룰셋, 환급·감면 판정표, 지방세 달력의 버전입니다. 초안은 세무 감수위원이 서명하고 관리자가 승인해야 활성화되며, 서명 전 값은 공개 계산에 쓰이지 않습니다. 이미 있는 버전은 고치지 않고 차수를 올려 새 초안을 만듭니다."
      />
      <div className="space-y-8">
        {PANELS.map(({ kind, tk, title }) => (
          <Panel key={`${kind}-${tk ?? ""}`} id={`rs-${kind}${tk ? `-${tk}` : ""}`} title={title}>
            {rowsOf(kind, tk).length === 0 ? (
              <EmptyNote>등록된 {title} 버전이 없습니다.</EmptyNote>
            ) : (
              <DataTable caption={`${title} 버전`} head={["버전", "상태", "출처·근거", "서명", "승인", "처리"]}>
                {rowsOf(kind, tk).map((v) => (
                  <tr key={`${kind}-${v.id}`} data-kind={kind} data-id={v.id} data-version={v.version} data-status={v.status}>
                    <td className={`${TD} ${MONO}`}>
                      {v.version}
                      {v.table_kind ? ` · ${v.table_kind}` : ""}
                    </td>
                    <td className={TD}>
                      <ToneChip tone={STATUS_TONE[v.status]}>{STATUS_LABEL[v.status]}</ToneChip>
                    </td>
                    <td className={TD}>
                      {v.source_ref}
                      <br />
                      <span className="text-[13px]">{v.basis_event_id ? `근거 개정 기록 ${v.basis_event_id}` : (v.basis_note ?? "-")}</span>
                    </td>
                    <td className={TD}>{v.signed_at ? `${when(v.signed_at)} · ${v.sheet_ref ?? ""}` : "서명 없음"}</td>
                    <td className={TD}>{v.activated_at ? when(v.activated_at) : "-"}</td>
                    <td className={TD}>
                      {v.status === "draft" && canSign && (
                        <OpForm id={`rs-sign-${kind}-${v.id}`} op="sign" label={`${v.version} 감수 서명`} submit="감수 서명" endpoint={ENDPOINT} ctx={{ kind, id: v.id }} fields={[{ name: "sheet_ref", label: "감수 시트 위치 (200자 이하)", required: true }]} />
                      )}
                      {v.status === "draft" && !canSign && <span className="text-[13px]">감수위원 서명 대기</span>}
                      {v.status === "reviewed" && canApprove && <OpButton id={`rs-approve-${kind}-${v.id}`} op="approve" label="활성화 승인" ctx={{ kind, id: v.id }} endpoint={ENDPOINT} />}
                      {v.status === "reviewed" && !canApprove && <span className="text-[13px]">관리자 승인 대기</span>}
                    </td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Panel>
        ))}
        {canApprove && (
          <Panel id="rs-new" title="초안 만들기" description="본문 JSON을 붙여 넣으면 룰셋·판정표는 형식 검사(zod)를 통과해야 저장됩니다. 국세 낱말이 있거나 허용 밖 칸이 있으면 저장되지 않습니다. 저장해도 초안이라 계산에는 쓰이지 않습니다.">
            <OpForm id="rs-create" op="create" label="초안 만들기" submit="초안 저장" endpoint={ENDPOINT} fields={CREATE_FIELDS} />
          </Panel>
        )}
        <Panel id="rs-audit" title="서명·승인 기록 (최근 40건)">
          {board.audit.length === 0 ? (
            <EmptyNote>아직 서명·승인 기록이 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="룰셋 서명·승인 감사" head={["시각", "대상", "행위", "결과", "행위자", "사유"]}>
              {board.audit.map((a) => (
                <tr key={a.id} data-outcome={a.outcome} data-code={a.code}>
                  <td className={`${TD} ${MONO}`}>{when(a.at)}</td>
                  <td className={TD}>{`${a.kind} ${a.version ?? a.target_id}`}</td>
                  <td className={TD}>{a.action === "sign" ? "감수 서명" : "승인"}</td>
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
