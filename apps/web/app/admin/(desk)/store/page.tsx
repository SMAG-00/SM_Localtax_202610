import type { Metadata } from "next";
import Link from "next/link";
import { OpButton, OpForm, type LnField } from "@/components/admin/LocalNewsControls";
import { DataTable, EmptyNote, MONO, PageTitle, Panel, TD, TEXT_LINK, ToneChip } from "@/components/admin/ui";
import { can } from "@/lib/access";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { loadStoreBoard, type BoardProduct } from "@/lib/server/store/board";
import { KIND_LABEL, LINK_STATUS_LABEL, ORDER_MODE_LABEL, STATUS_LABEL, type OrderMode, type ProductKind, type ProductStatus } from "@/lib/store/rules";

// 스토어·구독 (/admin/store - W8, PRD-01C BIZ-01·02·03, docs/dev/W8_설계.md 1장 3단계).
//  · 상품 담당(store_ops)·관리자: 상품 등록·판매 상태·자사 상품 카드 연결 제안. 승인·철회는 편집 책임자·관리자, 허용 도메인·구독 확인 기록은 관리자만.
//  · 상품 내용(이름·설명·목차·판매 확인일·근거)은 PO가 실사 자료를 보고 직접 적는다 - 채워 넣는 기본값 0. 가격·결제 칸은 없다.
export const metadata: Metadata = { title: "스토어·구독" };
export const dynamic = "force-dynamic";

const ENDPOINT = "/api/admin/store";
const KIND_OPTIONS = [{ value: "", label: "고르세요" }, ...(Object.entries(KIND_LABEL) as [ProductKind, string][]).map(([value, label]) => ({ value, label }))];
const MODE_OPTIONS = [{ value: "", label: "고르세요" }, ...(Object.entries(ORDER_MODE_LABEL) as [OrderMode, string][]).map(([value, label]) => ({ value, label }))];
const STATUS_TONE: Record<ProductStatus, "emerald" | "amber" | "navy"> = { on_sale: "emerald", draft: "amber", stopped: "navy" };

const PRODUCT_FIELDS: LnField[] = [
  { name: "slug", label: "주소 이름 (영문 소문자·숫자·-)", required: true },
  { name: "title", label: "상품 이름 (80자 이하)", required: true },
  { name: "kind", label: "종류", type: "select", options: KIND_OPTIONS, required: true },
  { name: "summary", label: "한 줄 설명 (200자 이하, 할인·가격 표기 금지)", type: "area" },
  { name: "audience", label: "대상 (80자 이하)" },
  { name: "edition", label: "판차 (도서)" },
  { name: "toc", label: "목차 (도서 - 줄마다 하나)", type: "area" },
  { name: "order_mode", label: "주문 방식", type: "select", options: MODE_OPTIONS, required: true },
  { name: "order_url", label: "바깥 판매처 주소 (https, 허용 도메인만 - 문의함 방식이면 비움)" },
  { name: "verified_on", label: "판매 확인일 (YYYY-MM-DD)" },
  { name: "verified_ref", label: "확인 근거 위치 (200자 이하)" },
];

function productInitial(p: BoardProduct): Record<string, string> {
  return {
    slug: p.slug,
    title: p.title,
    kind: p.kind,
    summary: p.summary,
    audience: p.audience,
    edition: p.edition ?? "",
    toc: p.toc.join("\n"),
    order_mode: p.order_mode,
    order_url: p.order_url ?? "",
    verified_on: p.verified_on ?? "",
    verified_ref: p.verified_ref ?? "",
  };
}

export default async function StorePage() {
  const viewer = await pageViewer();
  requirePage(viewer, "product.manage");
  const board = await loadStoreBoard(serviceDb());
  const canApprove = can(viewer, "product.approve");
  const isAdmin = viewer.isAdmin;
  const review = board.subscriptionReview;
  const rv = (k: string) => String(review[k] ?? "");

  return (
    <>
      <PageTitle title="스토어·구독" description="자사 상품(도서·교육·구독 신청)을 등록하고, 기사·홈에 '자사 상품' 카드로 연결합니다. 1단계에는 결제가 없습니다 - 주문은 바깥 판매처 링크 또는 문의함으로 갑니다." />
      <div className="space-y-8">
        <Panel id="st-gate" title="공개 조건" description="기능 키 store는 설정 화면에서 켭니다. 판매 중 + 판매 확인일·근거 + 허용 도메인(바깥 링크) + (구독이면) 구독 확인 기록이 모두 있어야 공개됩니다. 판매 중지는 다음 요청부터 모든 자리에서 빠집니다.">
          <p data-testid="st-gate-state" className="text-[15px] text-navy-800">
            스토어 <ToneChip tone={board.flags.store ? "emerald" : "amber"}>{board.flags.store ? "켜짐" : "꺼짐"}</ToneChip> · 허용 도메인 {board.domains.length}개 · 구독 확인 기록 {review.approved === true ? "승인" : "미승인"}
          </p>
          <p className="mt-2 text-[15px]">
            <Link href="/admin/store/revenue" className={TEXT_LINK}>
              수익 대시보드 (클릭 집계) 보기
            </Link>
          </p>
        </Panel>

        <Panel id="st-products" title="상품" description="초안으로 저장한 뒤 판매 확인일·근거를 적고 판매 중으로 바꿉니다. 도서는 판차·목차가 있어야 판매 중이 됩니다.">
          {board.products.length === 0 ? (
            <EmptyNote>등록된 상품이 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="상품 목록" head={["번호", "이름", "종류", "주문 방식", "상태", "판매 확인일", "작업"]}>
              {board.products.map((p) => (
                <tr key={p.id} data-product-id={p.id} data-product-slug={p.slug}>
                  <td className={`${TD} ${MONO}`}>{p.id}</td>
                  <td className={TD}>{p.title}</td>
                  <td className={TD}>{KIND_LABEL[p.kind as ProductKind] ?? p.kind}</td>
                  <td className={TD}>{ORDER_MODE_LABEL[p.order_mode as OrderMode] ?? p.order_mode}</td>
                  <td className={TD}>
                    <ToneChip tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</ToneChip>
                  </td>
                  <td className={`${TD} ${MONO}`}>{p.verified_on ?? "-"}</td>
                  <td className={TD}>
                    <details>
                      <summary className="cursor-pointer font-bold text-navy-900">고치기·상태</summary>
                      <div className="mt-3 space-y-4">
                        <OpForm id={`st-edit-${p.id}`} op="product" label={`${p.title} 고치기`} submit="상품 저장" endpoint={ENDPOINT} fields={PRODUCT_FIELDS} initial={productInitial(p)} ctx={{ id: p.id }} />
                        <div className="flex flex-wrap gap-3">
                          {p.status !== "on_sale" && <OpButton id={`st-sale-${p.id}`} op="product_status" label="판매 중으로" ctx={{ id: p.id, status: "on_sale" }} endpoint={ENDPOINT} />}
                          {p.status === "on_sale" && <OpButton id={`st-stop-${p.id}`} op="product_status" label="판매 중지" ctx={{ id: p.id, status: "stopped" }} endpoint={ENDPOINT} />}
                          {p.status !== "draft" && <OpButton id={`st-draft-${p.id}`} op="product_status" label="초안으로" ctx={{ id: p.id, status: "draft" }} endpoint={ENDPOINT} />}
                        </div>
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
          <details className="mt-4">
            <summary className="cursor-pointer font-bold text-navy-900">상품 등록</summary>
            <div className="mt-3">
              <OpForm id="st-new" op="product" label="상품 등록" submit="초안으로 등록" endpoint={ENDPOINT} fields={PRODUCT_FIELDS} />
            </div>
          </details>
        </Panel>

        <Panel id="st-links" title="자사 상품 카드 연결" description="기사 하단·홈에 보이는 '자사 상품' 카드는 승인된 연결만 나옵니다. 기사당 승인 1개, 홈 승인 1개입니다. 상품 담당은 제안까지, 승인·철회는 편집 책임자·관리자가 합니다.">
          {board.links.length === 0 ? (
            <EmptyNote>연결이 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="자사 상품 카드 연결" head={["번호", "상품", "위치", "기사", "상태", "작업"]}>
              {board.links.map((l) => (
                <tr key={l.id} data-link-id={l.id} data-link-status={l.status}>
                  <td className={`${TD} ${MONO}`}>{l.id}</td>
                  <td className={TD}>{l.product_title}</td>
                  <td className={TD}>{l.placement === "home" ? "홈" : "기사 하단"}</td>
                  <td className={TD}>{l.article_id === null ? "-" : `${l.article_id} ${l.article_title ?? ""}`}</td>
                  <td className={TD}>{LINK_STATUS_LABEL[l.status] ?? l.status}</td>
                  <td className={TD}>
                    {canApprove && l.status === "proposed" && <OpButton id={`st-approve-${l.id}`} op="link_approve" label="승인" ctx={{ id: l.id }} endpoint={ENDPOINT} />}
                    {canApprove && l.status !== "revoked" && <OpButton id={`st-revoke-${l.id}`} op="link_revoke" label="철회" ctx={{ id: l.id }} endpoint={ENDPOINT} />}
                    {!canApprove && <span className="text-[14px] text-navy-600">승인은 편집 책임자·관리자</span>}
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
          <details className="mt-4">
            <summary className="cursor-pointer font-bold text-navy-900">연결 제안</summary>
            <div className="mt-3">
              <OpForm
                id="st-propose"
                op="link_propose"
                label="연결 제안"
                submit="연결 제안"
                endpoint={ENDPOINT}
                fields={[
                  { name: "product_id", label: "상품 번호", required: true },
                  { name: "placement", label: "위치", type: "select", options: [{ value: "", label: "고르세요" }, { value: "article", label: "기사 하단" }, { value: "home", label: "홈" }], required: true },
                  { name: "article_id", label: "기사 번호 (기사 하단일 때만)" },
                ]}
              />
            </div>
          </details>
        </Panel>

        {isAdmin && (
          <>
            <Panel id="st-domains" title="바깥 주문 허용 도메인" description="바깥 판매처 링크 상품은 이 목록에 있는 호스트(정확히 일치)의 https 주소만 쓸 수 있습니다. 비어 있으면 바깥 링크 상품은 공개되지 않습니다. 줄마다 하나.">
              <OpForm
                id="st-domains-form"
                op="domains"
                label="허용 도메인 저장"
                submit="허용 도메인 저장"
                endpoint={ENDPOINT}
                initial={{ domains: board.domains.join("\n") }}
                fields={[{ name: "domains", label: "허용 도메인 (소문자 호스트, 줄마다 하나)", type: "area" }]}
              />
            </Panel>
            <Panel id="st-sub-review" title="구독 확인 기록" description="정기간행물 등록·구독료 부가세 확인 기록입니다. 승인 전에는 '구독 신청' 종류 상품이 공개되지 않습니다 (BIZ-01).">
              <OpForm
                id="st-sub-review-form"
                op="subscription_review"
                label="구독 확인 기록 저장"
                submit="구독 확인 기록 저장"
                endpoint={ENDPOINT}
                initial={{ ref: rv("ref"), reviewed_by: rv("reviewed_by"), reviewed_on: rv("reviewed_on"), approved: review.approved === true }}
                fields={[
                  { name: "ref", label: "근거 위치 (200자 이하)" },
                  { name: "reviewed_by", label: "확인자" },
                  { name: "reviewed_on", label: "확인일 (YYYY-MM-DD)" },
                  { name: "approved", label: "승인 - 확인을 마쳤습니다", type: "check" },
                ]}
              />
            </Panel>
          </>
        )}
      </div>
    </>
  );
}
