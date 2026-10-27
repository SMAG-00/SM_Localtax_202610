import type { Metadata } from "next";
import { OpForm, type LnField } from "@/components/admin/LocalNewsControls";
import { DataTable, EmptyNote, MONO, PageTitle, Panel, TD, ToneChip } from "@/components/admin/ui";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { DIGITIZE_STAGES, loadLibraryBoard } from "@/lib/server/library/board";

// 지식창고 이관·권리 (/admin/library - W13-a a2, AIOPS-16·LIB-06, docs/dev/W13-a_설계.md). 편집 책임자·관리자(권리·승인은 관리자만).
//  · 이관 작업은 권리 확인 → 추출 → 구조화 → 교정 → 승인 순서로만 갑니다. 건너뛰기는 거부되고, 승인은 표본 오류율이 설정 상한 이하일 때만 열립니다.
//  · 이 화면은 AI·OCR을 부르지 않습니다. 추출·교정 결과는 사람이 넣은 텍스트입니다.
export const metadata: Metadata = { title: "지식창고 이관" };
export const dynamic = "force-dynamic";

const ENDPOINT = "/api/admin/library";
const TONE = { rights_confirmed: "amber", extracted: "amber", structured: "amber", proofread: "navy", approved: "emerald" } as const;
const KIND_LABEL = { node: "노드", issue: "권호", issue_article: "권호 기사" } as const;
const CREATE_FIELDS: LnField[] = [
  { name: "target_kind", label: "대상 종류 (node·issue·issue_article)", required: true },
  { name: "target_id", label: "대상 번호 (공개 권리 확인된 초안)", required: true },
  { name: "source_file", label: "원본 파일 이름", required: true },
];
const ADVANCE_FIELDS: LnField[] = [
  { name: "job_id", label: "작업 번호", required: true },
  { name: "to", label: "다음 단계 (extracted·structured·proofread)", required: true },
];
const APPROVE_FIELDS: LnField[] = [
  { name: "job_id", label: "작업 번호 (교정 단계)", required: true },
  { name: "sample_size", label: "표본 크기", required: true },
  { name: "sample_errors", label: "표본 오류 수", required: true },
];
const RIGHTS_FIELDS: LnField[] = [
  { name: "item_kind", label: "대상 종류", required: true },
  { name: "item_id", label: "대상 번호", required: true },
  { name: "field", label: "권리 칸 (rights_public·rights_index·rights_summary·rights_sale·rights_pdf)", required: true },
  { name: "value", label: "값 (unchecked·confirmed·restricted)", required: true },
  { name: "rights_ref", label: "근거 (확인 때 필수)" },
  { name: "rights_confirmed_on", label: "확인일 YYYY-MM-DD (확인 때 필수)" },
];

export default async function LibraryAdminPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "library.edit");
  const board = await loadLibraryBoard(serviceDb());
  return (
    <>
      <PageTitle title="지식창고 이관" description={`단계: ${DIGITIZE_STAGES.join(" → ")}. 승인은 표본 오류율이 설정 상한 이하일 때만 열립니다.`} />
      <div className="space-y-8">
        <Panel id="lib-jobs" title="이관 작업">
          {board.jobs.length === 0 ? (
            <EmptyNote>이관 작업이 없습니다. 권리가 확인된 초안 노드·권호에서 작업을 만듭니다.</EmptyNote>
          ) : (
            <DataTable caption="이관 작업" head={["번호", "대상", "원본", "단계", "표본 오류율(%)", "승인자"]}>
              {board.jobs.map((j) => (
                <tr key={j.id} data-id={j.id} data-stage={j.stage}>
                  <td className={`${TD} ${MONO}`}>{j.id}</td>
                  <td className={TD}>{KIND_LABEL[j.target_kind]} {j.target_id}</td>
                  <td className={`${TD} ${MONO}`}>{j.source_file}</td>
                  <td className={TD}><ToneChip tone={TONE[j.stage]}>{j.stage}</ToneChip></td>
                  <td className={`${TD} ${MONO}`}>{j.sample_error_rate ?? ""}</td>
                  <td className={`${TD} ${MONO}`}>{j.approved_by ?? ""}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
        <Panel id="lib-create" title="작업 만들기" description="공개 권리가 확인되지 않은 원고는 만들 수 없습니다.">
          <OpForm id="lib-create-form" op="create" label="이관 작업 만들기" submit="만들기" endpoint={ENDPOINT} fields={CREATE_FIELDS} />
        </Panel>
        <Panel id="lib-advance" title="다음 단계로" description="한 단계씩만 갑니다. 승인 단계는 아래 승인에서만 열립니다.">
          <OpForm id="lib-advance-form" op="advance" label="단계 이동" submit="이동" endpoint={ENDPOINT} fields={ADVANCE_FIELDS} />
        </Panel>
        <Panel id="lib-approve" title="승인 (관리자)" description="표본 오류율이 설정 상한을 넘으면 거부됩니다.">
          <OpForm id="lib-approve-form" op="approve" label="이관 승인" submit="승인" endpoint={ENDPOINT} fields={APPROVE_FIELDS} />
        </Panel>
        <Panel id="lib-rights" title="용도별 권리 기록 (관리자)" description="확인(confirmed)에는 근거와 확인일이 필요합니다. 확인에서 다른 값으로 바꾸면 다음 요청부터 공개에서 빠집니다.">
          <OpForm id="lib-rights-form" op="rights" label="권리 기록" submit="기록" endpoint={ENDPOINT} fields={RIGHTS_FIELDS} />
        </Panel>
        <Panel id="lib-audit" title="이관 기록 (최근 40건)">
          {board.audit.length === 0 ? (
            <EmptyNote>아직 기록이 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="이관 감사" head={["시각", "작업", "행위", "결과", "행위자"]}>
              {board.audit.map((a) => (
                <tr key={a.id} data-outcome={a.outcome} data-code={a.code}>
                  <td className={`${TD} ${MONO}`}>{a.at.slice(0, 16).replace("T", " ")}</td>
                  <td className={`${TD} ${MONO}`}>{a.job_id ?? ""}</td>
                  <td className={TD}>{a.action}</td>
                  <td className={TD}>{a.outcome === "ok" ? "성공" : `거부 (${a.code})`}</td>
                  <td className={`${TD} ${MONO}`}>{a.actor}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
        <Panel id="lib-rights-log" title="권리·공개 상태 변경 기록 (최근 40건)">
          {board.rightsLog.length === 0 ? (
            <EmptyNote>아직 기록이 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="권리 변경 기록" head={["시각", "대상", "칸", "이전", "이후", "행위자"]}>
              {board.rightsLog.map((r) => (
                <tr key={r.id}>
                  <td className={`${TD} ${MONO}`}>{r.at.slice(0, 16).replace("T", " ")}</td>
                  <td className={TD}>{r.item_kind} {r.item_id}</td>
                  <td className={`${TD} ${MONO}`}>{r.field}</td>
                  <td className={`${TD} ${MONO}`}>{r.old_value ?? ""}</td>
                  <td className={`${TD} ${MONO}`}>{r.new_value}</td>
                  <td className={`${TD} ${MONO}`}>{r.actor}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
      </div>
    </>
  );
}
