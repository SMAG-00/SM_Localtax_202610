"use client";

import { useRef, type ReactNode } from "react";
import { track } from "@/lib/analytics/client";
import { nextFocusIndex } from "@/lib/keyword-map/graph";

// 키워드 맵 클라이언트 부품 (CASE-06, W12-g). 서버가 그린 링크를 바꾸지 않는다 - 방향키로 노드 사이 포커스를 옮기고, 노드 클릭을 측정한다(세목 키·고른 노드 수뿐).
export function KeywordNodes({ taxItem, selectedCount, children }: { taxItem: string; selectedCount: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const links = Array.from(ref.current?.querySelectorAll<Element>("a[data-node]") ?? []);
    const at = links.indexOf(e.target as Element);
    if (at < 0) return;
    const next = nextFocusIndex(at, e.key, links.length);
    if (next === null) return;
    e.preventDefault();
    (links[next] as unknown as SVGElement).focus();
  };
  const onClick = (e: React.MouseEvent) => {
    const el = (e.target as Element).closest?.("a[data-node]");
    if (!el) return;
    const picked = el.getAttribute("aria-current") === "true" ? selectedCount - 1 : selectedCount + 1;
    void track("keyword_map_node_clicked", { section: "tax", props: { tax_item: taxItem, node_count: Math.min(Math.max(picked, 0), 50) }, keepalive: true });
  };
  return (
    <div ref={ref} onKeyDown={onKeyDown} onClick={onClick} data-part="keyword-nodes">
      {children}
    </div>
  );
}
