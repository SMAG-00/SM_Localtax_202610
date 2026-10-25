import type { Metadata } from "next";
import { OpButton, OpForm, type LnField } from "@/components/admin/LocalNewsControls";
import { DataTable, EmptyNote, MONO, PageTitle, Panel, TD, ToneChip } from "@/components/admin/ui";
import { ENGINE_HASH } from "@/lib/accuracy/engine";
import { GATE_OFFICIAL_MIN, GATE_SAMPLE_MIN, evaluateGate, type CauseGroup, type TaxKind } from "@/lib/accuracy/gate";
import { MISMATCH_CAUSE_LABEL, MISMATCH_CAUSES } from "@/lib/accuracy/input";
import { can } from "@/lib/access";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { loadAccuracyBoard } from "@/lib/server/accuracy/board";
import { serviceDb } from "@/lib/server/articles/service";

// 정확도 대조 (/admin/accuracy - W10-a a6, PRD-02 CALC-14·FAM-07, docs/dev/W10-a_설계.md 11.2).
//  · 세목·원인 묶음마다 공식 결과 사례 30건 이상 전부 일치, 감수 표본 50건 일치, 활성(서명·승인된) 룰셋의 최신 실행이 있어야 자체 계산기가 열립니다.
//  · 열림 여부는 DB 뷰에서만 읽습니다. 이 화면에는 열고 닫는 입력이 없습니다.
//  · 사례는 개인정보를 지운 것만 받습니다 (이름·주소·연락처·번호 칸이나 문장 값은 저장되지 않습니다).
export const metadata: Metadata = { title: "정확도 대조" };
export const dynamic = "force-dynamic";

const ENDPOINT = "/api/admin/accuracy";
const TAX_LABEL: Record<TaxKind, string> = { acquisition: "취득세", property: "재산세", comprehensive: "종합부동산세" };
const GROUP_LABEL: Record<CauseGroup, string> = { INHERITANCE: "상속 원인", GIFT: "증여 원인", OTHER: "유상취득·원시취득", ALL: "전체" };
const opt = (items: [string, string][]) => [{ value: "", label: "고르세요" }, ...items.map(([value, label]) => ({ value, label }))];
const CASE_FIELDS: LnField[] = [
  { name: "case_key", label: "관리 번호 (영문·숫자·_.-, 이름·번호 쓰지 않기)", required: true },
  { name: "tax_kind", label: "세목", type: "select", options: opt([["acquisition", "취득세"], ["property", "재산세"], ["comprehensive", "종합부동산세"]]), required: true },
  { name: "cause", label: "취득 원인 (취득세만)", type: "select", options: opt([["PAID", "유상취득(PAID)"], ["INHERITANCE", "상속(INHERITANCE)"], ["GIFT", "증여(GIFT)"], ["ORIGINAL", "원시취득(ORIGINAL)"]]) },
  { name: "sample_kind", label: "사례 종류", type: "select", options: opt([["official", "공식 결과 (고지서·위택스)"], ["review_sample", "감수 표본"]]), required: true },
  { name: "official_basis", label: "근거 종류", type: "select", options: opt([["tax_notice", "고지서"], ["wetax_result", "위택스 신고 결과"], ["reviewer_calc", "감수위원 계산(표본)"]]), required: true },
  { name: "official_total", label: "공식 결과 합계 (원, 정수)", required: true },
  { name: "case_input", label: "엔진 입력 JSON (개인정보 제거본)", type: "area", required: true },
  { name: "synthetic", label: "화면 시험용 지어낸 사례 (게이트에 세지 않음)", type: "check" },
];

function when(iso: string | null): string {
  return iso ? iso.slice(0, 16).replace("T", " ") : "-";
}

export default async function AccuracyPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "accuracy.manage");
  const canConfirm = can(viewer, "ruleset.sign");
  const board = await loadAccuracyBoard(serviceDb());
  return (
    <>
      <PageTitle
        title="정확도 대조"
        description={`세목·원인 묶음마다 공식 결과 사례 ${GATE_OFFICIAL_MIN}건 이상이 모두 원 단위로 일치하고, 감수 표본 ${GATE_SAMPLE_MIN}건이 일치하며, 활성 룰셋의 최신 대조 실행이 모든 확인된 사례를 덮을 때만 자체 계산기가 열립니다. 이 화면에서 열고 닫을 수는 없습니다.`}
      />
      <div className="space-y-8">
        <Panel id="ac-gate" title="공개 게이트 상태" description={`배포된 엔진 해시 ${ENGINE_HASH.slice(0, 12)}…`}>
          <DataTable caption="세목·원인 묶음별 게이트" head={["세목", "묶음", "공식 결과 (일치/전체)", "감수 표본 (일치/전체)", "룰셋·실행", "상태"]}>
            {board.gate.map((g) => {
              const e = evaluateGate({ officialCases: g.official_cases, officialMatched: g.official_matched, sampleCases: g.sample_cases, sampleMatched: g.sample_matched });
              const engineStale = g.is_open && g.engine_hash !== ENGINE_HASH;
              const open = g.is_open && !engineStale;
              return (
                <tr key={`${g.tax_kind}-${g.cause_group}`} data-group={`${g.tax_kind}:${g.cause_group}`} data-open={open ? "true" : "false"}>
                  <td className={TD}>{TAX_LABEL[g.tax_kind]}</td>
                  <td className={TD}>{GROUP_LABEL[g.cause_group]}</td>
                  <td className={`${TD} ${MONO}`}>{`${g.official_matched}/${g.official_cases}`}</td>
                  <td className={`${TD} ${MONO}`}>{`${g.sample_matched}/${g.sample_cases}`}</td>
                  <td className={TD}>{g.ruleset_version ? `${g.ruleset_version} · 실행 ${g.last_run_id ?? "없음"}` : "활성 룰셋 없음"}</td>
                  <td className={TD}>
                    <ToneChip tone={open ? "emerald" : "amber"}>{open ? "공개 가능" : "닫힘"}</ToneChip>
                    {!open && (
                      <span className="mt-1 block text-[13px]">
                        {engineStale ? "엔진이 바뀌어 다시 대조해야 합니다" : !g.ruleset_version ? "서명·승인된 룰셋이 필요합니다" : g.last_run_id === null ? "대조 실행이 필요합니다" : e.shortfalls.join(" · ") || "확인된 사례를 덮는 최신 실행이 필요합니다"}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </DataTable>
          <div className="mt-4">
            <OpButton id="ac-run" op="run" label="지금 대조 실행" ctx={{}} endpoint={ENDPOINT} />
          </div>
        </Panel>
        <Panel id="ac-new" title="대조 사례 추가" description="추가한 사례는 세무 감수위원이 확인한 뒤에만 게이트에 셉니다. 개인정보(이름·주소·연락처·번호)가 있는 사례는 저장되지 않습니다.">
          <OpForm id="ac-case-add" op="case_add" label="대조 사례 추가" submit="사례 저장" endpoint={ENDPOINT} fields={CASE_FIELDS} />
        </Panel>
        <Panel id="ac-cases" title="대조 사례 (최근 300건 - 입력은 표시하지 않습니다)">
          {board.cases.length === 0 ? (
            <EmptyNote>등록된 대조 사례가 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="대조 사례" head={["관리 번호", "세목·원인", "종류", "공식 결과(원)", "상태", "불일치 원인", "처리"]}>
              {board.cases.map((c) => (
                <tr key={c.id} data-case-id={c.id} data-case-key={c.case_key} data-confirmed={c.confirmed_at ? "true" : "false"} data-retired={c.retired_at ? "true" : "false"}>
                  <td className={`${TD} ${MONO}`}>{c.case_key}</td>
                  <td className={TD}>{`${TAX_LABEL[c.tax_kind as TaxKind] ?? c.tax_kind}${c.cause ? ` · ${c.cause}` : ""}`}</td>
                  <td className={TD}>{`${c.sample_kind === "official" ? "공식 결과" : "감수 표본"}${c.synthetic ? " · 시험용" : ""}`}</td>
                  <td className={`${TD} ${MONO}`}>{c.official_total.toLocaleString("ko-KR")}</td>
                  <td className={TD}>{c.retired_at ? "철회" : c.confirmed_at ? `확인됨 ${when(c.confirmed_at)}` : "확인 전"}</td>
                  <td className={TD}>{c.mismatch_cause ? `${MISMATCH_CAUSE_LABEL[c.mismatch_cause] ?? c.mismatch_cause}${c.mismatch_note ? ` - ${c.mismatch_note}` : ""}` : "-"}</td>
                  <td className={TD}>
                    {!c.retired_at && !c.confirmed_at && canConfirm && <OpButton id={`ac-confirm-${c.id}`} op="case_confirm" label="감수 확인" ctx={{ id: c.id }} endpoint={ENDPOINT} />}
                    {!c.retired_at && (
                      <>
                        <OpButton id={`ac-retire-${c.id}`} op="case_retire" label="철회" ctx={{ id: c.id }} endpoint={ENDPOINT} />
                        <OpForm
                          id={`ac-note-${c.id}`}
                          op="case_note"
                          label={`${c.case_key} 불일치 원인`}
                          submit="원인 기록"
                          endpoint={ENDPOINT}
                          ctx={{ id: c.id }}
                          initial={{ mismatch_cause: c.mismatch_cause ?? "", mismatch_note: c.mismatch_note ?? "" }}
                          fields={[
                            { name: "mismatch_cause", label: "원인", type: "select", options: opt(MISMATCH_CAUSES.map((m) => [m, MISMATCH_CAUSE_LABEL[m]!])) },
                            { name: "mismatch_note", label: "메모 (200자 이하, 개인정보 금지)" },
                          ]}
                        />
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
        <Panel id="ac-runs" title="최근 대조 실행 (10건)">
          {board.runs.length === 0 ? (
            <EmptyNote>아직 대조 실행이 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="대조 실행" head={["번호", "시각", "룰셋", "엔진 해시", "사례", "일치", "실행자"]}>
              {board.runs.map((r) => (
                <tr key={r.id}>
                  <td className={`${TD} ${MONO}`}>{r.id}</td>
                  <td className={`${TD} ${MONO}`}>{when(r.run_at)}</td>
                  <td className={TD}>{r.ruleset_version}</td>
                  <td className={`${TD} ${MONO}`}>{r.engine_hash.slice(0, 12)}{r.engine_hash === ENGINE_HASH ? "" : " (옛 엔진)"}</td>
                  <td className={`${TD} ${MONO}`}>{r.case_count}</td>
                  <td className={`${TD} ${MONO}`}>{r.matched_count}</td>
                  <td className={`${TD} ${MONO}`}>{r.triggered_by}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
      </div>
    </>
  );
}
