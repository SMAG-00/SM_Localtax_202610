import { ProductCard, UiLink } from "@ltr/ui";
import type { OwnCardView, StoreDetailView, StoreListView, StoreProductView } from "@/lib/server/public/store";
import { STORE_INQUIRY_HREF, storeDetailHref } from "@/lib/store/rules";
import { ProductTrack } from "./ProductTrack";
import { SiteSection, TEXT_LINK } from "./SiteSection";

// 스토어 W8 공개 화면 (BIZ-01·02·03·08). 카드 모양은 @ltr/ui ProductCard - 가격·결제·장바구니·팝업 없음, 주문은 바깥 링크(새 창) 또는 문의함.
// 광고 정책 링크는 정책 페이지가 열려 있을 때만 (문구는 정책 페이지가 정한다).

function orderOf(p: StoreProductView) {
  return p.orderMode === "request_form"
    ? ({ mode: "request_form", href: STORE_INQUIRY_HREF } as const)
    : ({ mode: "existing_channel", link: { url: p.orderUrl ?? "", status: "ok", checkedAt: p.verifiedOn }, helpdeskHref: STORE_INQUIRY_HREF } as const);
}
const orderHrefOf = (p: StoreProductView) => (p.orderMode === "request_form" ? STORE_INQUIRY_HREF : p.orderUrl);

function AdPolicyLink({ href }: { href: string | null }) {
  if (!href) return null;
  return (
    <p className="mt-6">
      <UiLink href={href} data-part="ad-policy-link" className={`${TEXT_LINK} inline-flex min-h-11 items-center`}>
        광고·상품 표시 기준
      </UiLink>
    </p>
  );
}

/** 기사·홈의 '자사 상품' 카드 1개 (BIZ-03) */
export function OwnProductBlock({ card, section = null }: { card: OwnCardView; section?: "tax" | "realestate" | "finance" | "local" | null }) {
  return (
    <div data-part="own-product" data-product-id={card.id} data-placement={card.placement}>
      <ProductTrack productId={card.id} placement={card.placement} articleId={card.articleId} section={section}>
        <ProductCard variant="own" name={card.title} description={card.summary} detailHref={card.detailHref} approved saleStatus="on_sale" />
      </ProductTrack>
      <AdPolicyLink href={card.adPolicyHref} />
    </div>
  );
}

export function StoreListPage({ view }: { view: StoreListView }) {
  return (
    <div data-ui="store-page">
      <SiteSection id="store-head" tone="ivory" first heading={{ eyebrow: "STORE", title: "구독·도서·교육" }} data={{ "data-store-part": "head" }}>
        {view.products.length === 0 ? (
          <p data-part="store-empty" className="mt-6 text-[17px] text-navy-700">
            지금 안내할 상품이 없습니다.
          </p>
        ) : (
          <ul className="mt-8 grid gap-4 sm:grid-cols-2" data-part="store-list">
            {view.products.map((p) => (
              <li key={p.id} data-product-slug={p.slug} className="flex">
                <div className="w-full">
                  <ProductTrack productId={p.id} placement="store" articleId={null} orderHref={orderHrefOf(p)} orderMode={p.orderMode}>
                    <ProductCard
                      variant="store"
                      name={p.title}
                      audience={p.audience || p.kindLabel}
                      format={p.kind === "book" ? "book" : p.kind === "education" ? "education" : "print-subscription"}
                      verifiedAt={p.verifiedOn}
                      saleStatus="on_sale"
                      detailHref={storeDetailHref(p.slug)}
                      order={orderOf(p)}
                    />
                  </ProductTrack>
                </div>
              </li>
            ))}
          </ul>
        )}
        <AdPolicyLink href={view.adPolicyHref} />
      </SiteSection>
    </div>
  );
}

export function StoreDetailPage({ view }: { view: StoreDetailView }) {
  const p = view.product;
  if (!p) return null;
  return (
    <div data-ui="store-detail" data-product-slug={p.slug}>
      <SiteSection id="store-detail-head" tone="ivory" first heading={{ eyebrow: p.kindLabel, title: p.title }} data={{ "data-store-part": "detail" }}>
        {p.summary && (
          <p data-part="product-summary" className="mt-4 text-[17px] text-navy-800">
            {p.summary}
          </p>
        )}
        {p.edition && (
          <p data-part="product-edition" className="mt-2 text-[15px] text-navy-700">
            판차 {p.edition}
          </p>
        )}
        {p.toc.length > 0 && (
          <section data-part="product-toc" aria-label="목차" className="mt-6">
            <h3 className="text-[19px] font-black text-navy-900">목차</h3>
            <ol className="mt-2 list-decimal space-y-1 pl-6 text-[16px] text-navy-800">
              {p.toc.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ol>
          </section>
        )}
        <div className="mt-8 max-w-md">
          <ProductTrack productId={p.id} placement={view.source.placement} articleId={view.source.articleId} orderHref={orderHrefOf(p)} orderMode={p.orderMode}>
            <ProductCard variant="store" name={p.title} audience={p.audience || p.kindLabel} format={p.kind === "book" ? "book" : p.kind === "education" ? "education" : "print-subscription"} verifiedAt={p.verifiedOn} saleStatus="on_sale" order={orderOf(p)} />
          </ProductTrack>
        </div>
        <p className="mt-6">
          <UiLink href="/store" className={`${TEXT_LINK} inline-flex min-h-11 items-center`}>
            상품 목록으로
          </UiLink>
        </p>
        <AdPolicyLink href={view.adPolicyHref} />
      </SiteSection>
    </div>
  );
}

