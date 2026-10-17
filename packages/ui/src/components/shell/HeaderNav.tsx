"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { cx } from "../base";
import { UiLink } from "../link";

export type HeaderNavLink = { key: string; label: string; href: string };

const LINK =
  "inline-flex min-h-11 w-full items-center px-1 text-[16px] font-semibold text-navy-100 transition hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400 lg:w-auto lg:px-2.5 lg:text-[14px]";

function MenuIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[20px]" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

/**
 * 헤더의 메뉴 — 분야 메뉴(4대 분야) + 유틸 메뉴 자리. 1024px 미만에서는 [메뉴] 공개(disclosure) 버튼으로 열고 닫는다.
 * 메뉴 HTML은 한 벌뿐이다(데스크톱·모바일 공용) — 상단 메뉴가 HTML에 정확히 4개 (HOME-02).
 * Esc로 닫으면 포커스가 버튼으로 돌아온다 (8.9).
 */
export function HeaderNav({ sections, utilities, currentSection }: { sections: readonly HeaderNavLink[]; utilities: readonly HeaderNavLink[]; currentSection?: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

  // 화면 전환(새로고침 없음)에서는 헤더가 그대로 남는다 — 메뉴 항목을 누르면 펼친 메뉴를 닫는다
  const close = () => setOpen(false);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== "Escape" || !open) return;
    e.preventDefault();
    setOpen(false);
    buttonRef.current?.focus();
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
        className="order-3 inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg border border-navy-600 px-3 text-[14px] font-semibold text-navy-100 transition hover:border-navy-400 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400 lg:hidden"
      >
        <MenuIcon />
        메뉴
      </button>
      <div
        id={panelId}
        onKeyDown={onKeyDown}
        className={cx(
          "order-4 basis-full flex-col gap-1 border-t border-navy-700 py-2 lg:order-2 lg:flex lg:flex-1 lg:basis-auto lg:flex-row lg:items-center lg:border-t-0 lg:py-0",
          open ? "flex" : "hidden",
        )}
      >
        <nav aria-label="분야 메뉴">
          <ul className="flex flex-col lg:flex-row lg:items-center">
            {sections.map((s) => (
              <li key={s.key}>
                <UiLink
                  href={s.href}
                  onClick={close}
                  aria-current={s.key === currentSection ? "page" : undefined}
                  className={cx(LINK, s.key === currentSection && "underline decoration-hermes-500 decoration-2 underline-offset-8")}
                >
                  {s.label}
                </UiLink>
              </li>
            ))}
          </ul>
        </nav>
        {utilities.length > 0 && (
          <nav aria-label="유틸 메뉴" className="border-t border-navy-700 pt-2 lg:ml-auto lg:border-t-0 lg:pt-0">
            <ul className="flex flex-col lg:flex-row lg:items-center">
              {utilities.map((u) => (
                <li key={u.key}>
                  <UiLink href={u.href} onClick={close} className={LINK}>
                    {u.label}
                  </UiLink>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </>
  );
}
