"use client";

import type { ReactNode } from "react";
import { track } from "@/lib/analytics/client";
import type { SectionKey } from "@/lib/server/public/constants";
import type { OrderMode, SourcePlacement } from "@/lib/store/rules";

// 상품 카드 누름 측정 (W8 BIZ-09 - docs/dev/W8_설계.md 2장). 그리는 것은 감싸는 div 하나 - 안의 링크를 누르면 이벤트 1건.
// 주문 링크(orderHref와 같은 주소)를 누르면 order_link_clicked, 그 밖의 링크(상세 보기)는 product_clicked.
// 측정 거부·GPC면 track()이 아무것도 보내지 않는다. 가격·이름·주소는 속성에 넣지 않는다 (번호·위치·방식만).

export function ProductTrack({
  productId,
  placement,
  articleId,
  orderHref = null,
  orderMode = null,
  section = null,
  children,
}: {
  productId: number;
  placement: SourcePlacement;
  articleId: number | null;
  orderHref?: string | null;
  orderMode?: OrderMode | null;
  section?: SectionKey | null;
  children: ReactNode;
}) {
  function onActivate(e: { target: EventTarget }) {
    const a = (e.target as Element | null)?.closest?.("a");
    if (!a) return;
    const base = { product_id: productId, placement, ...(articleId ? { article_id: articleId } : {}) };
    if (orderHref && orderMode && a.getAttribute("href") === orderHref) void track("order_link_clicked", { section, props: { ...base, mode: orderMode } });
    else void track("product_clicked", { section, props: base });
  }
  return (
    <div data-product-track="true" data-product-id={productId} data-placement={placement} onClick={onActivate} onAuxClick={onActivate}>
      {children}
    </div>
  );
}
