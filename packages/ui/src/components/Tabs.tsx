"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";

const ACTIVE = "border-b-[3px] border-hermes-500 font-bold text-navy-900";
const INACTIVE = "border-b-[3px] border-transparent font-semibold text-navy-400 hover:text-navy-700";
const ITEM = "min-h-11 px-3 py-2 text-[15px] transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500";

export type TabItem = { id: string; label: string; panel: ReactNode };

/** 탭 (화면 안 전환) — role=tablist, 방향키로 이동 (8.9 키보드 접근) */
export function Tabs({ label, items, defaultId }: { label: string; items: TabItem[]; defaultId?: string }) {
  const base = useId();
  const [active, setActive] = useState(defaultId ?? items[0]?.id);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(e: KeyboardEvent, index: number) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (index + step + items.length) % items.length;
    setActive(items[next].id);
    refs.current[next]?.focus();
  }

  const current = items.find((i) => i.id === active) ?? items[0];
  return (
    <div data-ui="tabs">
      <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 border-b border-navy-100">
        {items.map((item, index) => {
          const selected = item.id === current.id;
          return (
            <button
              key={item.id}
              ref={(el) => {
                refs.current[index] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(item.id)}
              onKeyDown={(e) => onKeyDown(e, index)}
              className={cx(ITEM, selected ? ACTIVE : INACTIVE)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${base}-panel-${current.id}`} aria-labelledby={`${base}-tab-${current.id}`} className="pt-6">
        {current.panel}
      </div>
    </div>
  );
}

export type TabNavItem = { id: string; label: string; href: string };

/** 링크 탭 — 주소(쿼리)로 상태를 두는 탭. 서버에서 렌더하고 JS 없이 동작한다 (분야 필터 등) */
export function TabNav({ label, items, current }: { label: string; items: TabNavItem[]; current: string }) {
  return (
    <nav data-ui="tab-nav" aria-label={label} className="border-b border-navy-100">
      <ul className="flex flex-wrap gap-1">
        {items.map((item) => (
          <li key={item.id}>
            <a href={item.href} aria-current={item.id === current ? "page" : undefined} className={cx(ITEM, "inline-block", item.id === current ? ACTIVE : INACTIVE)}>
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
