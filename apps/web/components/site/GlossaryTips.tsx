"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics/client";
import type { SectionKey } from "@/lib/server/public/constants";

// 본문 용어 풀이 보조 스크립트 (GLO-02 — docs/dev/W2-d_설계.md 8.2). 그리는 것 0 — 서버가 그린 풀이(GlossaryTip.tsx)에 동작만 붙인다.
//  · 열기: 키보드 포커스(Tab — 포커스 표시가 보일 때) · 누르기(터치·마우스 — 다시 누르면 닫힘) · 마우스 올리기
//  · 닫기: Esc(포커스는 용어 단추로) · 바깥을 누르기 · 포커스가 풀이 밖으로 · 마우스가 떠남(누르거나 포커스로 연 것은 그대로)
//  · 한 번에 풀이 하나 · 열 때 화면 밖으로 나가지 않게 옆으로 옮긴다(360px 가로 스크롤 0)
//  · 측정 — 누르기·키보드로 연 용어마다 glossary_opened(용어 번호) 한 번 (마우스 올리기는 세지 않는다). 측정 거부·GPC면 track()이 보내지 않는다
const EDGE = 16;

/** articleId — 화면 전환으로 다른 기사가 그려지면 새 풀이에 다시 붙인다 */
export function GlossaryTips({ articleId, section }: { articleId: number; section: SectionKey }) {
  useEffect(() => {
    const roots = [...document.querySelectorAll<HTMLElement>("[data-glossary-tip]")];
    if (roots.length === 0) return;
    const sent = new Set<string>();
    const pinned = new Set<HTMLElement>();
    /** Esc로 닫고 포커스를 단추로 돌릴 때는 다시 열지 않는다 */
    let quiet: HTMLElement | null = null;
    const parts = (root: HTMLElement) => ({ trigger: root.querySelector<HTMLButtonElement>("[data-tip-trigger]"), pop: root.querySelector<HTMLElement>("[data-tip-pop]") });

    function close(root: HTMLElement) {
      pinned.delete(root);
      if (!root.hasAttribute("data-open")) return;
      root.removeAttribute("data-open");
      const { trigger, pop } = parts(root);
      trigger?.setAttribute("aria-expanded", "false");
      if (pop) pop.style.transform = "";
    }
    function place(pop: HTMLElement) {
      pop.style.transform = "";
      const r = pop.getBoundingClientRect();
      const width = document.documentElement.clientWidth;
      let dx = 0;
      if (r.right > width - EDGE) dx = width - EDGE - r.right;
      if (r.left + dx < EDGE) dx = EDGE - r.left;
      if (dx !== 0) pop.style.transform = `translateX(${Math.round(dx)}px)`;
    }
    function open(root: HTMLElement, how: "hover" | "focus" | "click") {
      for (const r of roots) if (r !== root) close(r);
      const { trigger, pop } = parts(root);
      if (!root.hasAttribute("data-open")) {
        root.setAttribute("data-open", "");
        trigger?.setAttribute("aria-expanded", "true");
        if (pop) place(pop);
      }
      const id = root.dataset.termId;
      if (how !== "hover" && id && !sent.has(id)) {
        sent.add(id);
        void track("glossary_opened", { section, props: { term_id: Number(id) } });
      }
    }

    const cleanups: Array<() => void> = [];
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void) => {
      el.addEventListener(type, fn);
      cleanups.push(() => el.removeEventListener(type, fn));
    };
    for (const root of roots) {
      const { trigger } = parts(root);
      if (!trigger) continue;
      root.setAttribute("data-enhanced", "");
      trigger.setAttribute("aria-expanded", "false");
      on(root, "pointerenter", (e) => {
        if (e.pointerType === "mouse") open(root, "hover");
      });
      on(root, "pointerleave", (e) => {
        if (e.pointerType === "mouse" && !pinned.has(root) && !root.contains(document.activeElement)) close(root);
      });
      on(trigger, "click", () => {
        if (root.hasAttribute("data-open") && pinned.has(root)) return close(root);
        open(root, "click");
        pinned.add(root);
      });
      on(root, "focusin", (e) => {
        if (quiet !== root && e.target === trigger && trigger.matches(":focus-visible")) open(root, "focus");
      });
      on(root, "focusout", (e) => {
        if (!(e.relatedTarget instanceof Node && root.contains(e.relatedTarget))) close(root);
      });
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      for (const root of roots) {
        if (!root.hasAttribute("data-open")) continue;
        const { trigger } = parts(root);
        const inside = root.contains(document.activeElement);
        close(root);
        if (inside && trigger && document.activeElement !== trigger) {
          quiet = root;
          trigger.focus();
          quiet = null;
        }
      }
    };
    const onDown = (e: PointerEvent) => {
      for (const root of roots) if (root.hasAttribute("data-open") && !(e.target instanceof Node && root.contains(e.target))) close(root);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      for (const c of cleanups) c();
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
      for (const root of roots) {
        close(root);
        root.removeAttribute("data-enhanced");
      }
    };
  }, [articleId, section]);
  return null;
}
