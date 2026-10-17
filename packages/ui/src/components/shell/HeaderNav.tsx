"use client";

import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { cx } from "../base";
import { UiLink } from "../link";

export type HeaderNavLink = { key: string; label: string; href: string };
/** 분야 메뉴 한 칸 — 하위 메뉴(분야 데이터에서 온 하위 분야 + 공통 `뉴스 전체`, HOME-02)가 있으면 펼침 단추가 붙는다 */
export type HeaderNavSection = HeaderNavLink & { children?: readonly HeaderNavLink[] };

const LINK =
  "inline-flex min-h-11 w-full items-center px-1 text-[16px] font-semibold text-navy-100 transition hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400 lg:w-auto lg:px-2.5 lg:text-[14px]";

const SUB_LINK =
  "inline-flex min-h-11 w-full items-center px-3 text-[15px] font-semibold text-navy-100 transition hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400 lg:text-[14px]";

function MenuIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[20px]" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={cx("size-[18px] transition", open && "rotate-180")} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/**
 * 헤더의 메뉴 — 분야 메뉴(4대 분야) + 유틸 메뉴 자리. 1024px 미만에서는 [메뉴] 공개(disclosure) 버튼으로 열고 닫는다.
 * 메뉴 HTML은 한 벌뿐이다(데스크톱·모바일 공용) — 상단 메뉴가 HTML에 정확히 4개 (HOME-02).
 * 분야마다 하위 메뉴가 있으면 분야 링크 옆에 펼침 단추(공개 단추 — 링크는 그대로 허브로 간다). 하위 메뉴는 한 번에 하나만 열린다.
 * Esc로 닫으면 포커스가 그 단추로 돌아온다 (8.9). 메뉴 바깥을 누르거나 포커스가 그 분야 밖으로 나가면 하위 메뉴가 닫힌다.
 */
export function HeaderNav({ sections, utilities, currentSection }: { sections: readonly HeaderNavSection[]; utilities: readonly HeaderNavLink[]; currentSection?: string }) {
  const [open, setOpen] = useState(false);
  const [openSub, setOpenSub] = useState<string | null>(null);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const subButtons = useRef(new Map<string, HTMLButtonElement>());

  // 화면 전환(새로고침 없음)에서는 헤더가 그대로 남는다 — 메뉴 항목을 누르면 펼친 메뉴·하위 메뉴를 닫는다
  const close = () => {
    setOpen(false);
    setOpenSub(null);
  };

  useEffect(() => {
    if (openSub === null) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!navRef.current?.contains(e.target as Node)) setOpenSub(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [openSub]);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    if (openSub !== null) {
      // 하위 메뉴가 먼저 닫힌다 — 포커스는 그 펼침 단추로
      e.preventDefault();
      e.stopPropagation();
      const key = openSub;
      setOpenSub(null);
      subButtons.current.get(key)?.focus();
      return;
    }
    if (!open) return;
    e.preventDefault();
    setOpen(false);
    buttonRef.current?.focus();
  }

  function onSectionBlur(e: FocusEvent<HTMLLIElement>, key: string) {
    // 키보드로 다른 곳에 포커스가 가면 닫는다. 포커스 대상이 없는 누름(바깥 누름)은 pointerdown이 맡는다
    const next = e.relatedTarget as Node | null;
    if (openSub === key && next && !e.currentTarget.contains(next)) setOpenSub(null);
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
        <nav ref={navRef} aria-label="분야 메뉴">
          <ul className="flex flex-col lg:flex-row lg:items-center">
            {sections.map((s) => {
              const children = s.children ?? [];
              const subId = `${panelId}-${s.key}`;
              const expanded = openSub === s.key;
              return (
                <li key={s.key} data-menu-section={s.key} className="lg:relative" onBlur={(e) => onSectionBlur(e, s.key)}>
                  <div className="flex items-center">
                    <UiLink
                      href={s.href}
                      onClick={close}
                      data-part="section-link"
                      aria-current={s.key === currentSection ? "page" : undefined}
                      className={cx(LINK, "flex-1 lg:flex-none", s.key === currentSection && "underline decoration-hermes-500 decoration-2 underline-offset-8")}
                    >
                      {s.label}
                    </UiLink>
                    {children.length > 0 && (
                      <button
                        ref={(el) => {
                          if (el) subButtons.current.set(s.key, el);
                          else subButtons.current.delete(s.key);
                        }}
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={subId}
                        onClick={() => setOpenSub((v) => (v === s.key ? null : s.key))}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-navy-200 transition hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400 lg:min-w-7"
                      >
                        <ChevronIcon open={expanded} />
                        <span className="sr-only">{`${s.label} 하위 메뉴`}</span>
                      </button>
                    )}
                  </div>
                  {children.length > 0 && (
                    <ul
                      id={subId}
                      aria-label={`${s.label} 하위 메뉴`}
                      hidden={!expanded}
                      className="ml-2 border-l border-navy-700 pl-2 lg:absolute lg:top-full lg:left-0 lg:z-40 lg:ml-0 lg:min-w-52 lg:rounded-xl lg:border lg:bg-navy-800 lg:p-2"
                    >
                      {children.map((c) => (
                        <li key={c.key}>
                          <UiLink href={c.href} onClick={close} data-part="sub-link" className={SUB_LINK}>
                            {c.label}
                          </UiLink>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
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
