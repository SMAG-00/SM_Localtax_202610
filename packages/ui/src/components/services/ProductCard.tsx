import { useId } from "react";
import { DarkButton } from "../base";
import { DateText, MONO, NewWindowIcon, TypeBadge } from "./parts";
import { isBlank, isHttpUrl } from "./format";
import type { OfficialLink } from "./official-link";

export type ProductFormat = "print-subscription" | "book" | "education" | "digital-subscription";
export type SaleStatus = "on_sale" | "stopped";

/**
 * 주문 방식 (`products.order_mode`, BIZ-02) — 1단계는 기존 경로·사이트 신청 양식 두 가지.
 * PG 결제(`pg`)는 2단계라 이 타입에 없다 — 결제 버튼·카드 입력 0.
 */
export type ProductOrder =
  | { mode: "existing_channel"; link: OfficialLink; /** 경로 점검 실패 때 보낼 고객센터 */ helpdeskHref: string }
  | { mode: "request_form"; href: string };

export type StoreProductCardProps = {
  variant?: "store";
  name: string;
  /** 대상 */
  audience: string;
  format: ProductFormat;
  /** 판매 확인일(실사) — 없으면 렌더 0 (BIZ-01) */
  verifiedAt: string;
  saleStatus: SaleStatus;
  /** 상품 상세 */
  detailHref?: string;
  order: ProductOrder;
};

export type OwnProductCardProps = {
  /** '자사 상품' 변형 — 기사·칼럼 하단·홈에 1개 이하 (BIZ-03 · BR-11) */
  variant: "own";
  name: string;
  /** 한 줄 설명 */
  description: string;
  detailHref: string;
  /** `product_links` 승인 기록(상품 담당 제안 → 편집 책임자 승인)이 있는가 */
  approved: boolean;
  saleStatus: SaleStatus;
};

export type ProductCardProps = StoreProductCardProps | OwnProductCardProps;

const FORMAT_LABEL: Record<ProductFormat, string> = {
  "print-subscription": "지면 구독",
  book: "도서",
  education: "교육",
  "digital-subscription": "디지털 구독",
};

const CARD =
  "group rounded-2xl border border-navy-100 bg-white p-6 transition hover:border-hermes-400 hover:shadow-[0_2px_20px_-8px_rgba(242,106,27,0.35)]";

function OrderButton({ order }: { order: ProductOrder }) {
  if (order.mode === "request_form") return <DarkButton href={order.href}>신청하기</DarkButton>;
  if (order.mode === "existing_channel") {
    if (order.link.status === "broken" || !isHttpUrl(order.link.url)) return <DarkButton href={order.helpdeskHref}>고객센터에 문의하기</DarkButton>;
    return (
      <DarkButton href={order.link.url} external>
        주문하러 가기
        <NewWindowIcon />
        <span className="sr-only"> (새 창)</span>
      </DarkButton>
    );
  }
  return null; // 1단계에 없는 주문 방식 — 버튼을 만들지 않는다
}

/**
 * 상품 카드 — 링크 카드 문법 + 어두운 버튼 (BIZ-01 · BIZ-02 · BIZ-03).
 * 판매 중지·판매 확인일 없음·('자사 상품') 승인 기록 없음이면 렌더 0. 결제 버튼·카드 입력·가격 카운트다운·팝업 없음.
 */
export function ProductCard(props: ProductCardProps) {
  const nameId = useId();
  if (props.saleStatus !== "on_sale" || isBlank(props.name)) return null;

  if (props.variant === "own") {
    if (!props.approved) return null;
    return (
      <article data-ui="product-card" data-variant="own" aria-labelledby={nameId} className={CARD}>
        <div className="flex flex-wrap gap-2">
          <TypeBadge>자사 상품</TypeBadge>
          <TypeBadge>교육·상품</TypeBadge>
        </div>
        <h3 id={nameId} data-part="name" className="mt-3 text-[19px] font-black text-navy-900">
          {props.name}
        </h3>
        <p className="mt-1 text-[15px] text-navy-600">{props.description}</p>
        <div className="mt-4">
          <DarkButton href={props.detailHref}>
            자세히 보기<span className="sr-only"> — {props.name}</span>
          </DarkButton>
        </div>
      </article>
    );
  }

  if (isBlank(props.verifiedAt)) return null;
  return (
    <article data-ui="product-card" data-variant="store" aria-labelledby={nameId} className={CARD}>
      <TypeBadge>교육·상품</TypeBadge>
      <h3 id={nameId} data-part="name" className="mt-3 text-[19px] font-black text-navy-900">
        {props.detailHref ? (
          <a href={props.detailHref} className="inline-flex min-h-11 items-center hover:text-hermes-900 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500">
            {props.name}
          </a>
        ) : (
          props.name
        )}
      </h3>
      <dl className="mt-2 space-y-1 text-[15px] text-navy-800">
        <div className="flex gap-2">
          <dt className="shrink-0 font-bold text-navy-600">대상</dt>
          <dd>{props.audience}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 font-bold text-navy-600">형식</dt>
          <dd>{FORMAT_LABEL[props.format]}</dd>
        </div>
      </dl>
      <p className={`mt-2 ${MONO}`}>
        판매 확인일 <DateText value={props.verifiedAt} />
      </p>
      <div className="mt-4">
        <OrderButton order={props.order} />
      </div>
    </article>
  );
}
