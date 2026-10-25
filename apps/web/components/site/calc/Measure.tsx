"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics/client";

// 계산기 화면 측정 연결 - 그리는 것 0. 이벤트에는 도구 종류·화면·링크 상태·지역 코드뿐이다(입력값·금액·취득 원인 0, PRD-02 11장).

/** 콘텐츠 -> 도구 이동 (content_to_tool) - 자체 계산기 카드를 누르면 1건. 카드 요소의 data-tool-card(도구)·data-tool-kind="self" */
export function MeasureToolCards({ contentKind, regionCode }: { contentKind: "region_hub" | "search"; regionCode: string | null }) {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const card = event.target instanceof Element ? event.target.closest('[data-tool-card][data-tool-kind="self"]') : null;
      const tool = card?.getAttribute("data-tool-card");
      if (tool === "acquisition" || tool === "holding" || tool === "refund") {
        void track("content_to_tool", { section: null, props: { content_kind: contentKind, tool, ...(regionCode ? { region_code: regionCode } : {}) } });
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [contentKind, regionCode]);
  return null;
}

/** 외부 계산기 카드를 누르면 external_calculator_opened(화면·링크 상태) 1건 - 취득 원인·금액 0 */
export function MeasureExternalOpened({ screen }: { screen: "acquisition_result" }) {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const card = event.target instanceof Element && event.target.closest("a[href]") ? event.target.closest('[data-ui="external-calculator-card"]') : null;
      if (card) void track("external_calculator_opened", { section: null, props: { from_screen: screen, link_state: card.getAttribute("data-state") === "fallback" ? "fallback" : "ok" } });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [screen]);
  return null;
}

/** 기사에서 계산기로 - 다음 행동 띠·「지방세로 읽기」 상자의 계산기 링크를 누르면 content_to_tool(article) 1건. 도구는 주소 경로에서 읽는다(해시의 미리 채운 값은 보내지 않는다) */
export function MeasureArticleToTool() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const a = event.target instanceof Element ? event.target.closest('[data-ui="next-action-band"] a[href^="/calc/"], [data-ui="tax-lens-box"] a[href^="/calc/"]') : null;
      const path = a?.getAttribute("href")?.split("#")[0];
      const tool = path === "/calc/acquisition" ? "acquisition" : path === "/calc/holding" ? "holding" : path === "/calc/refund" ? "refund" : null;
      if (tool) void track("content_to_tool", { section: null, props: { content_kind: "article", tool } });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}
