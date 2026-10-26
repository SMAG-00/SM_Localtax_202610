import type { Metadata } from "next";
import { OpButton, OpForm, type LnField } from "@/components/admin/LocalNewsControls";
import { DataTable, EmptyNote, MONO, PageTitle, Panel, TD, ToneChip } from "@/components/admin/ui";
import { GATE_OFFICIAL_MIN, GATE_SAMPLE_MIN, evaluateGate } from "@/lib/accuracy/gate";
import { can } from "@/lib/access";
import { loadIgtBoard } from "@/lib/igt/board";
import { IGT_ENGINE_HASH } from "@/lib/igt/engine-hash";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";

// 상속·증여세 감수 (/admin/igt - FAM-12, docs/dev/W11-g_설계.md).
//  · 경로는 하나: 초안 -> 세무 감수위원 서명 -> 관리자 승인. 서명 없는 버전에는 [활성화] 버튼이 없고 DB 함수도 거부합니다.
//  · 공개 게이트는 DB 뷰에서만 읽습니다. 이 화면에는 열고 닫는 입력이 없습니다. 증여와 상속은 따로 열립니다.
//  · 룰셋 값은 안심 상속증여계산기가 AI로 시행령과 대조한 미감수 값입니다. 서명 전에는 초안으로만 있고 공개 계산에 쓰이지 않습니다.
export const metadata: Metadata = { title: "국세 계산 감수" };
export const dynamic = "force-dynamic";

const ENDPOINT = "/api/admin/igt";
const STATUS_LABEL = { draft: "초안", reviewed: "서명됨", active: "활성", retired: "내려감" } as const;
const STATUS_TONE = { draft: "navy", reviewed: "amber", active: "emerald", retired: "navy" } as const;
const KIND_LABEL = { gift: "증여세", inheritance: "상속세" } as const;
const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") : "-");
const opt = (items: [string, string][]) => [{ value: "", label: "고르세요" }, ...items.map(([value, label]) => ({ value, label }))];

const CREATE_FIELDS: LnField[] = [
  { name: "version", label: "버전 (YYYY.NN - 본문 안 version과 같아야 합니다)", required: true },
  { name: "source_ref", label: "출처 (파일·커밋·시트 위치, 200자 이하)", required: true },
  { name: "basis_note", label: "근거 사유 (300자 이하)", type: "area", required: true },
  { name: "body", label: "룰셋 JSON (최상위 칸은 version·effective_from·source·source_laws와 common·gift·inheritance·payment)", type: "area", required: true },
];
const CASE_FIELDS: LnField[] = [
  { name: "case_key", label: "관리 번호 (영문·숫자·_.-, 이름·번호 쓰지 않기)", required: true },
  { name: "tax_kind", label: "세목", type: "select", options: opt([["gift", "증여세"], ["inheritance", "상속세"]]), required: true },
  { name: "sample_kind", label: "사례 종류", type: "select", options: opt([["official", "공식 결과 (고지서·홈택스)"], ["review_sample", "감수 표본"]]), required: true },
  { name: "official_basis", label: "근거 종류", type: "select", options: opt([["tax_notice", "고지서·홈택스 결과"], ["reviewer_calc", "감수위원 계산(표본)"]]), required: true },
  { name: "official_total", label: "공식 결과 자진납부세액 (원, 정수)", required: true },
  { name: "case_input", label: "엔진 입력 JSON (개인정보 제거본 - 이름·주소·번호 칸 금지)", type: "area", required: true },
];

export default async function NationalCalcAdminPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "ruleset.read");
  const canSign = can(viewer, "ruleset.sign");
  const canApprove = can(viewer, "ruleset.approve");
  const canManage = can(viewer, "accuracy.manage");
  const board = await loadIgtBoard(serviceDb());
  return (
    <>
      <PageTitle title="국세 계산 감수" description="상속세·증여세 자체 계산의 룰셋 버전, 공식 결과 대조 사례, 공개 게이트입니다. 초안은 세무 감수위원이 서명하고 관리자가 승인해야 활성화되며, 게이트는 세목마다 따로 열립니다." />
      <div className="space-y-8">
        <Panel id="igt-gate" title="공개 게이트" description={`공식 결과 ${GATE_OFFICIAL_MIN}건 이상·감수 표본 ${GATE_SAMPLE_MIN}건 이상이 활성 룰셋의 최신 실행에서 원 단위로 모두 일치하고, 실행의 엔진 해시가 지금 배포된 엔진과 같아야 열립니다.`}>
          <DataTable caption="상속·증여세 공개 게이트" head={["세목", "상태", "룰셋", "공식 결과", "감수 표본", "엔진 해시", "부족한 것"]}>
            {(["gift", "inheritance"] as const).map((k) => {
              const g = board.gate.find((x) => x.tax_kind === k);
              const hashOk = !!g && g.engine_hash === IGT_ENGINE_HASH;
              const open = !!g && g.is_open && hashOk;
              const ev = g ? evaluateGate({ officialCases: g.official_cases, officialMatched: g.official_matched, sampleCases: g.sample_cases, sampleMatched: g.sample_matched }) : null;
              return (
                <tr key={k} data-gate={k} data-open={open ? "true" : "false"}>
                  <td className={TD}>{KIND_LABEL[k]}</td>
                  <td className={TD}><ToneChip tone={open ? "emerald" : "navy"}>{open ? "열림" : "닫힘"}</ToneChip></td>
                  <td className={`${TD} ${MONO}`}>{g?.ruleset_version ?? "활성 룰셋 없음"}</td>
                  <td className={TD}>{g ? `${g.official_matched}/${g.official_cases}` : "-"}</td>
                  <td className={TD}>{g ? `${g.sample_matched}/${g.sample_cases}` : "-"}</td>
                  <td className={`${TD} ${MONO}`}>{g?.engine_hash ? (hashOk ? "일치" : "다름 - 다시 실행 필요") : "실행 없음"}</td>
                  <td className={TD}>{[...(ev && !ev.open ? ev.shortfalls : []), ...(g && g.engine_hash && !hashOk ? ["엔진이 바뀌어 대조를 다시 실행해야 합니다"] : []), ...(g?.ruleset_version ? [] : ["활성(서명·승인된) 룰셋이 없습니다"])].join(" · ") || "-"}</td>
                </tr>
              );
            })}
          </DataTable>
          {canManage && (
            <div className="mt-3">
              <OpButton id="igt-run" op="run" label="대조 실행 지금" ctx={{}} endpoint={ENDPOINT} />
            </div>
          )}
        </Panel>
        <Panel id="igt-versions" title="룰셋 버전">
          {board.versions.length === 0 ? (
            <EmptyNote>등록된 상속·증여세 룰셋 버전이 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="상속·증여세 룰셋 버전" head={["버전", "상태", "출처·근거", "서명", "승인", "처리"]}>
              {board.versions.map((v) => (
                <tr key={v.id} data-id={v.id} data-version={v.version} data-status={v.status}>
                  <td className={`${TD} ${MONO}`}>{v.version}</td>
                  <td className={TD}><ToneChip tone={STATUS_TONE[v.status]}>{STATUS_LABEL[v.status]}</ToneChip></td>
                  <td className={TD}>{v.source_ref}<br /><span className="text-[13px]">{v.basis_note ?? "-"}</span></td>
                  <td className={TD}>{v.signed_at ? `${when(v.signed_at)} · ${v.sheet_ref ?? ""}` : "서명 없음"}</td>
                  <td className={TD}>{v.activated_at ? when(v.activated_at) : "-"}</td>
                  <td className={TD}>
                    {v.status === "draft" && canSign && (
                      <OpForm id={`igt-sign-${v.id}`} op="sign" label={`${v.version} 감수 서명`} submit="감수 서명" endpoint={ENDPOINT} ctx={{ id: v.id }} fields={[{ name: "sheet_ref", label: "감수 시트 위치 (200자 이하)", required: true }]} />
                    )}
                    {v.status === "draft" && !canSign && <span className="text-[13px]">감수위원 서명 대기</span>}
                    {v.status === "reviewed" && canApprove && <OpButton id={`igt-approve-${v.id}`} op="approve" label="활성화 승인" ctx={{ id: v.id }} endpoint={ENDPOINT} />}
                    {v.status === "reviewed" && !canApprove && <span className="text-[13px]">관리자 승인 대기</span>}
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
        {canApprove && (
          <Panel id="igt-new" title="초안 만들기" description="본문 JSON을 붙여 넣으면 DB가 허용 칸·네 묶음·버전 일치를 검사합니다. 이 화면은 값을 만들지 않고, 만든 초안은 서명 전에는 공개 계산에 쓰이지 않습니다.">
            <OpForm id="igt-create" op="create" label="초안 만들기" submit="초안 저장" endpoint={ENDPOINT} fields={CREATE_FIELDS} />
          </Panel>
        )}
        <Panel id="igt-cases" title="대조 사례" description="공식 결과를 개인정보를 지운 입력으로 넣습니다. 세무 감수위원이 확인한 사례만 게이트에 셉니다. 입력은 목록에 다시 보이지 않습니다.">
          {board.cases.length === 0 ? (
            <EmptyNote>등록된 증여·상속 대조 사례가 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="상속·증여세 대조 사례" head={["관리 번호", "세목", "종류", "상태", "처리"]}>
              {board.cases.map((c) => (
                <tr key={c.id} data-case={c.case_key} data-kind={c.tax_kind}>
                  <td className={`${TD} ${MONO}`}>{c.case_key}</td>
                  <td className={TD}>{KIND_LABEL[c.tax_kind]}</td>
                  <td className={TD}>{c.sample_kind === "official" ? "공식 결과" : "감수 표본"}{c.synthetic ? " · 시험용" : ""}</td>
                  <td className={TD}>{c.retired_at ? "철회" : c.confirmed_at ? `확인 ${when(c.confirmed_at)}` : "확인 대기"}</td>
                  <td className={TD}>
                    {!c.retired_at && !c.confirmed_at && canSign && <OpButton id={`igt-confirm-${c.id}`} op="case_confirm" label="사례 확인" ctx={{ id: c.id }} endpoint={ENDPOINT} />}
                    {!c.retired_at && canManage && <OpButton id={`igt-retire-${c.id}`} op="case_retire" label="철회" ctx={{ id: c.id }} endpoint={ENDPOINT} />}
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
        {canManage && (
          <Panel id="igt-case-new" title="대조 사례 추가" description="이름·주소·연락처·번호 칸이나 문장 값은 저장되지 않습니다 (앱 검사 + DB 트리거).">
            <OpForm id="igt-case-add" op="case_add" label="사례 추가" submit="사례 저장" endpoint={ENDPOINT} fields={CASE_FIELDS} />
          </Panel>
        )}
        <Panel id="igt-audit" title="서명·승인 기록 (최근 40건)">
          {board.audit.length === 0 ? (
            <EmptyNote>아직 서명·승인 기록이 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="상속·증여세 룰셋 서명·승인 감사" head={["시각", "버전", "행위", "결과", "행위자", "사유"]}>
              {board.audit.map((a) => (
                <tr key={a.id} data-outcome={a.outcome} data-code={a.code}>
                  <td className={`${TD} ${MONO}`}>{when(a.at)}</td>
                  <td className={TD}>{a.version ?? "-"}</td>
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
