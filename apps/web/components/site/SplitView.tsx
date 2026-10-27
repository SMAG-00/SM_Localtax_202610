"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SPLIT_KIND_LABELS, buildSplitHref, keyAction, layoutFor, resizeWidths, visibleIndexes, type PanelSpec, type SplitKind } from "@/lib/law/split";

// 분할 화면 (LAW-07) - 패널 내용은 서버가 받는 사람 권한으로 읽어 넘긴다. 이 컴포넌트는 배치·포커스·너비·닫기만 하고 주소에 구성을 반영한다.
// 1280px 이상 3분할 · 1024~1279px 2분할 · 1024px 미만 탭. 키보드: Alt+←/→ 이동, Alt+Shift+←/→ 너비, Alt+W 닫기.
export interface SplitPanelData {
  spec: PanelSpec;
  status: "ok" | "denied" | "not_found";
  title: string;
  text: string;
  href: string | null;
  locked: boolean;
}

const subscribe = (cb: () => void) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};
const NOTE_KINDS: Record<SplitKind, string> = SPLIT_KIND_LABELS;
const MESSAGE = { denied: "이 내용을 볼 권한이 없습니다", not_found: "찾을 수 없거나 공개되지 않은 자료입니다" } as const;

export function SplitView({ panels: initial, active: initialActive, widths: initialWidths }: { panels: SplitPanelData[]; active: number; widths: number[] }) {
  const width = useSyncExternalStore(subscribe, () => window.innerWidth, () => 1280);
  const layout = layoutFor(width);
  const [panels, setPanels] = useState(initial);
  const [active, setActive] = useState(initialActive);
  const [widths, setWidths] = useState(initialWidths);
  const refs = useRef<(HTMLElement | null)[]>([]);

  // 구성을 주소에 반영 (새로고침·공유 때 같은 구성으로 복원)
  useEffect(() => {
    window.history.replaceState(null, "", buildSplitHref(panels.map((p) => p.spec), active, widths));
  }, [panels, active, widths]);

  function removeAt(index: number) {
    const keep = panels.filter((_, k) => k !== index);
    const base = keep.length > 0 ? Math.floor(100 / keep.length) : 0;
    setPanels(keep);
    setWidths(keep.map((_, k) => (k === keep.length - 1 ? 100 - base * (keep.length - 1) : base)));
    setActive(Math.min(index, Math.max(keep.length - 1, 0)));
  }
  function focusPanel(i: number) {
    setActive(i);
    queueMicrotask(() => refs.current[i]?.focus());
  }
  function onKey(e: React.KeyboardEvent, index: number) {
    const a = keyAction(e);
    if (!a) return;
    e.preventDefault();
    if (a.type === "focus") {
      const next = Math.min(Math.max(index + a.delta, 0), panels.length - 1);
      focusPanel(next);
    } else if (a.type === "resize") setWidths(resizeWidths(widths, index, a.delta));
    else removeAt(index);
  }

  if (panels.length === 0) {
    return (
      <p data-part="split-empty" className="text-[15px] text-navy-700">
        열린 패널이 없습니다. 조문이나 결정례 화면의 [분할 화면에 열기]로 패널을 추가하세요.
      </p>
    );
  }
  const shown = visibleIndexes(layout, panels.length, active);
  const sum = shown.reduce((a, i) => a + (widths[i] ?? 0), 0) || 100;
  return (
    <div data-part="split" data-layout={layout} className="flex flex-col gap-3">
      {layout === "tabs" && (
        <div role="tablist" aria-label="열린 패널" className="flex flex-wrap gap-1">
          {panels.map((p, i) => (
            <button key={i} type="button" role="tab" aria-selected={active === i} onClick={() => setActive(i)} className={`rounded-full px-3 py-1 text-[13px] font-bold ${active === i ? "bg-navy-900 text-white" : "border border-navy-200"}`}>
              {NOTE_KINDS[p.spec.kind]} {i + 1}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2" data-part="split-row">
        {shown.map((i) => {
          const p = panels[i];
          return (
            <section
              key={i}
              ref={(el) => {
                refs.current[i] = el;
              }}
              tabIndex={0}
              aria-label={`패널 ${i + 1}: ${NOTE_KINDS[p.spec.kind]}`}
              data-panel={i}
              data-active={active === i ? "true" : "false"}
              onKeyDown={(e) => onKey(e, i)}
              onFocus={() => setActive(i)}
              style={{ flexBasis: `${((widths[i] ?? 100 / panels.length) / sum) * 100}%` }}
              className={`min-w-0 overflow-y-auto rounded-xl border p-3 ${active === i ? "border-navy-900" : "border-navy-100"}`}
            >
              <header className="flex items-center justify-between gap-2">
                <span className="rounded-full border border-navy-200 px-2 py-0.5 text-[12px] font-bold">{NOTE_KINDS[p.spec.kind]}</span>
                <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-navy-900">{p.status === "ok" ? p.title : ""}</span>
                <button
                  type="button"
                  aria-label={`패널 ${i + 1} 닫기`}
                  onClick={() => removeAt(i)}
                  className="rounded border border-navy-200 px-2 text-[13px]"
                >
                  닫기
                </button>
              </header>
              {p.status !== "ok" ? (
                <p className="mt-3 text-[14px] text-navy-700">{MESSAGE[p.status]}</p>
              ) : (
                <>
                  {p.locked && <p data-part="lock-badge" className="mt-2 text-[13px] font-bold text-amber-900">구독자 전용 자료입니다. 미리보기만 보입니다</p>}
                  <div data-part="panel-text" className="mt-3 whitespace-pre-wrap text-[14px] leading-7 text-navy-900">
                    {p.text}
                  </div>
                  {p.href && (
                    <Link href={p.href} className="mt-3 inline-block text-[13px] underline underline-offset-4">
                      원문 보기
                    </Link>
                  )}
                </>
              )}
            </section>
          );
        })}
      </div>
      {layout !== "tabs" && shown.length > 1 && (
        <p className="text-[12px] text-navy-600" data-part="split-help">
          키보드: Alt+←/→ 패널 이동 · Alt+Shift+←/→ 너비 조절 · Alt+W 닫기
        </p>
      )}
    </div>
  );
}
