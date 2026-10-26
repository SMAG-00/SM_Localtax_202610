import type { Metadata } from "next";
import { OpButton, OpForm, type LnField } from "@/components/admin/LocalNewsControls";
import { DataTable, EmptyNote, MONO, PageTitle, Panel, TD, ToneChip } from "@/components/admin/ui";
import { can } from "@/lib/access";
import { GUIDE_HUBS, GUIDE_STATUS_LABEL, HUB_LABEL, SCOPE_LABEL, TAX_SCOPES } from "@/lib/guides/input";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { loadGuidesBoard } from "@/lib/server/guides/board";
import { PLACEMENT_SURFACES } from "@/lib/tax-guide/placements";

// 감수 가이드 (/admin/guides - W11-a a6, PRD-03 5장·7장 guides, docs/dev/W11-a_설계.md 5장).
//  · 경로는 하나: 초안 -> 세무 감수위원 서명 -> 관리자 공개. 서명 없는 버전에는 [공개] 버튼이 없고, DB 함수도 거부한다.
//  · 가이드 글·기준 금액·기간은 이 화면이 만들지 않는다. 붙여 넣은 값을 검사해 초안으로만 저장한다.
export const metadata: Metadata = { title: "감수 가이드" };
export const dynamic = "force-dynamic";

const ENDPOINT = "/api/admin/guides";
const PLACEMENT_ENDPOINT = "/api/admin/guides/placements";
const SURFACE_LABEL: Record<(typeof PLACEMENT_SURFACES)[number], string> = { trust_type: "신탁 유형 페이지", finance_tax_hub: "금융 구조별 세금 가이드 허브", dev_method: "개발방법 페이지", stage: "정비 단계 페이지", situation: "상황 페이지" };
const PLACEMENT_FIELDS: LnField[] = [
  { name: "guide_id", label: "가이드 번호 (guides.id)", required: true },
  { name: "surface", label: "붙일 화면", type: "select", options: [{ value: "", label: "고르세요" }, ...PLACEMENT_SURFACES.map((s) => ({ value: s, label: SURFACE_LABEL[s] }))], required: true },
  { name: "target_key", label: "대상 키 (구조 해설 slug·방법 slug·단계 키·상황 slug·허브 주제 키)", required: true },
  { name: "sort", label: "순서 (0~1000, 비우면 0)" },
];
const STATUS_TONE = { draft: "navy", reviewed: "amber", published: "emerald", retired: "navy" } as const;
const CREATE_FIELDS: LnField[] = [
  { name: "hub", label: "허브", type: "select", options: [{ value: "", label: "고르세요" }, ...GUIDE_HUBS.map((h) => ({ value: h, label: HUB_LABEL[h] }))], required: true },
  { name: "topic", label: "주제 키 (영문 소문자·숫자·_)", required: true },
  { name: "slug", label: "주소 slug (새 주제일 때만)" },
  { name: "title", label: "제목", required: true },
  { name: "tax_scope", label: "세목 범위", type: "select", options: [{ value: "", label: "고르세요" }, ...TAX_SCOPES.map((s) => ({ value: s, label: SCOPE_LABEL[s] }))], required: true },
  { name: "as_of", label: "기준일 (YYYY-MM-DD)" },
  { name: "region_codes", label: "지역 코드 (10자리, 쉼표로 구분)" },
  { name: "sections", label: "절 JSON ([{heading, body}])", type: "area" },
  { name: "facts", label: "사실값 JSON (감수 입력 기준 금액·기간 등)", type: "area" },
  { name: "sources", label: "출처 JSON ([{label, url}])", type: "area" },
  { name: "import_origin", label: "가져온 출처 표시 (가져온 초안만)" },
];

function when(iso: string | null): string {
  return iso ? iso.slice(0, 16).replace("T", " ") : "-";
}

export default async function GuidesPage() {
  const viewer = await pageViewer();
  requirePage(viewer, can(viewer, "guide.edit") ? "guide.edit" : can(viewer, "guide.sign") ? "guide.sign" : "guide.publish");
  const canEdit = can(viewer, "guide.edit");
  const canSign = can(viewer, "guide.sign");
  const canPublish = can(viewer, "guide.publish");
  const board = await loadGuidesBoard(serviceDb());
  return (
    <>
      <PageTitle
        title="감수 가이드"
        description="부동산 세금·신탁·정비·금융 구조 가이드의 버전입니다. 초안은 세무 감수위원이 서명하고 관리자가 공개해야 사이트에 나옵니다. 이미 있는 버전은 고치지 않고 새 버전 초안을 만듭니다. SM 해설을 가져온 초안은 AI 작성·미감수 값이라 서명 전에는 초안으로만 있습니다."
      />
      <div className="space-y-8">
        <Panel id="gd-versions" title="가이드 버전">
          {board.versions.length === 0 ? (
            <EmptyNote>등록된 가이드 버전이 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="가이드 버전" head={["주제", "버전", "상태", "세목·기준일", "출처", "서명", "처리"]}>
              {board.versions.map((v) => (
                <tr key={v.id} data-id={v.id} data-status={v.status} data-topic={v.guides?.topic ?? ""}>
                  <td className={TD}>
                    {v.title}
                    <br />
                    <span className={`text-[13px] ${MONO}`}>{v.guides ? `${HUB_LABEL[v.guides.hub as keyof typeof HUB_LABEL] ?? v.guides.hub} · ${v.guides.topic}` : "-"}</span>
                  </td>
                  <td className={`${TD} ${MONO}`}>{v.version}</td>
                  <td className={TD}>
                    <ToneChip tone={STATUS_TONE[v.status]}>{GUIDE_STATUS_LABEL[v.status]}</ToneChip>
                  </td>
                  <td className={TD}>
                    {SCOPE_LABEL[v.tax_scope]}
                    <br />
                    <span className="text-[13px]">{v.as_of ?? "기준일 없음"}</span>
                  </td>
                  <td className={TD}>{v.import_origin ?? "직접 작성"}</td>
                  <td className={TD}>{v.signed_at ? `${when(v.signed_at)} · ${v.sheet_ref ?? ""}` : "서명 없음"}</td>
                  <td className={TD}>
                    {v.status === "draft" && canSign && (
                      <OpForm id={`gd-sign-${v.id}`} op="sign" label={`${v.title} 감수 서명`} submit="감수 서명" endpoint={ENDPOINT} ctx={{ id: v.id }} fields={[{ name: "sheet_ref", label: "감수 시트 위치 (200자 이하)", required: true }]} />
                    )}
                    {v.status === "draft" && !canSign && <span className="text-[13px]">감수위원 서명 대기</span>}
                    {v.status === "reviewed" && canPublish && <OpButton id={`gd-publish-${v.id}`} op="publish" label="공개" ctx={{ id: v.id }} endpoint={ENDPOINT} />}
                    {v.status === "reviewed" && !canPublish && <span className="text-[13px]">관리자 공개 대기</span>}
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
        {canEdit && (
          <Panel id="gd-new" title="초안 만들기" description="붙여 넣은 값을 형식 검사해 초안으로만 저장합니다. 이미 있는 주제면 새 버전 초안이 됩니다. 저장해도 서명 전이라 사이트에는 나오지 않습니다.">
            <OpForm id="gd-create" op="create" label="초안 만들기" submit="초안 저장" endpoint={ENDPOINT} fields={CREATE_FIELDS} />
          </Panel>
        )}
        {canEdit && (
          <Panel id="gd-placements" title="가이드 배치" description="어느 화면에 어느 가이드를 붙일지 정합니다. 원고는 가이드 버전 한 곳에만 있고 배치는 위치만 정합니다. 서명·공개 전 가이드는 붙여 둬도 사이트에 나오지 않습니다. 금융 구조별 세금 가이드 허브는 자본시장법 검토 기록으로 기능 키를 켠 뒤에 보입니다.">
            <OpForm id="gd-place-add" op="add" label="가이드 붙이기" submit="붙이기" endpoint={PLACEMENT_ENDPOINT} fields={PLACEMENT_FIELDS} />
            <OpForm id="gd-place-remove" op="remove" label="가이드 빼기" submit="빼기" endpoint={PLACEMENT_ENDPOINT} fields={PLACEMENT_FIELDS.slice(0, 3)} />
          </Panel>
        )}
        <Panel id="gd-audit" title="서명·공개 기록 (최근 40건)">
          {board.audit.length === 0 ? (
            <EmptyNote>아직 서명·공개 기록이 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="가이드 서명·공개 감사" head={["시각", "버전", "행위", "결과", "행위자", "사유"]}>
              {board.audit.map((a) => (
                <tr key={a.id} data-outcome={a.outcome} data-code={a.code}>
                  <td className={`${TD} ${MONO}`}>{when(a.at)}</td>
                  <td className={TD}>{a.guide_version_id}</td>
                  <td className={TD}>{a.action === "sign" ? "감수 서명" : "공개"}</td>
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
