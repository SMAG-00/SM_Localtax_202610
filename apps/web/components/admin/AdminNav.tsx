"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@ltr/ui";
import { activeMenuId, groupOfMenuId, type MenuGroup, type MenuItem } from "@/lib/admin/menu";

const BUTTON =
  "inline-flex min-h-11 w-full items-center justify-between gap-2 border-b-[3px] px-3 py-2 text-left text-[15px] transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500 md:w-auto";
const LINK =
  "inline-flex min-h-11 items-center border-b-[3px] px-3 py-2 text-[15px] transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500";

/**
 * 역할별 묶음 메뉴 (ADM-01 · F4) — 그룹 7개 이하만 한 줄에 보이고, 그룹 버튼(aria-expanded)을 누르면 안의 항목이 두 번째 줄에 펼쳐진다.
 * 지금 보는 화면이 속한 그룹은 처음부터 펼쳐져 있고, 지금 보는 항목은 aria-current="page". Esc는 펼친 그룹을 닫고 그 그룹 버튼으로 포커스를 돌려 준다.
 * 아래 방향키는 펼친 그룹의 첫 항목으로 포커스를 옮긴다. 360px에서는 '메뉴' 버튼 하나로 접히고, 열면 그룹이 세로로 쌓여 가로 스크롤이 없다.
 * 항목 링크는 닫힌 그룹에서도 문서에 남는다(보이지 않을 뿐) — 화면 읽기 프로그램·시험이 전체 목록을 같은 방식으로 읽는다.
 */
export function AdminNav({ groups }: { groups: readonly MenuGroup[] }) {
  const pathname = usePathname() ?? "/admin";
  const flat: MenuItem[] = groups.flatMap((g) => g.items);
  const currentId = activeMenuId(flat, pathname);
  const activeGroup = groups.find((g) => g.items.some((i) => i.id === currentId))?.id ?? (groupOfMenuId(currentId) || null);
  const [open, setOpen] = useState<string | null>(activeGroup);
  const [mobileOpen, setMobileOpen] = useState(false);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const toggle = useRef<HTMLButtonElement | null>(null);

  // 다른 화면으로 가면 그 화면이 속한 그룹을 펼치고, 접는 메뉴는 닫는다 (렌더 중 상태 맞춤 — effect 없이)
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setOpen(activeGroup);
    setMobileOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== "Escape") return;
    if (open !== null) {
      const id = open;
      setOpen(null);
      buttons.current[id]?.focus();
    } else if (mobileOpen) {
      setMobileOpen(false);
      toggle.current?.focus();
    }
  }

  function onGroupKeyDown(e: KeyboardEvent<HTMLButtonElement>, g: MenuGroup) {
    if (e.key !== "ArrowDown") return;
    e.preventDefault();
    setOpen(g.id);
    // 펼친 뒤 첫 항목으로 — 그려진 다음에 포커스를 옮긴다
    requestAnimationFrame(() => document.querySelector<HTMLAnchorElement>(`#menu-group-${g.id} a`)?.focus());
  }

  const openLabel = groups.find((g) => g.id === open)?.label ?? groups.find((g) => g.id === activeGroup)?.label ?? "";

  return (
    <div className="border-b border-navy-100 bg-white">
      <nav aria-label="편집국 메뉴" className="mx-auto max-w-6xl px-4" data-ui="admin-nav" onKeyDown={onKeyDown}>
        <button
          ref={toggle}
          type="button"
          className={cx(BUTTON, "border-transparent font-bold text-navy-900 md:hidden")}
          aria-expanded={mobileOpen}
          aria-controls="admin-menu-groups"
          onClick={() => setMobileOpen((v) => !v)}
        >
          <span>메뉴{openLabel ? ` · ${openLabel}` : ""}</span>
          <span aria-hidden="true">{mobileOpen ? "−" : "+"}</span>
        </button>
        <ul id="admin-menu-groups" className={cx("flex-col md:flex md:flex-row md:flex-wrap md:gap-x-1", mobileOpen ? "flex" : "hidden")}>
          {groups.map((g) => {
            const isOpen = open === g.id;
            const isActive = activeGroup === g.id;
            return (
              <li key={g.id} className="md:contents">
                <button
                  ref={(el) => {
                    buttons.current[g.id] = el;
                  }}
                  type="button"
                  className={cx(BUTTON, isActive ? "border-hermes-500 font-bold text-navy-900" : "border-transparent font-semibold text-navy-500 hover:text-navy-800")}
                  aria-expanded={isOpen}
                  aria-controls={`menu-group-${g.id}`}
                  data-group={g.id}
                  onClick={() => setOpen(isOpen ? null : g.id)}
                  onKeyDown={(e) => onGroupKeyDown(e, g)}
                >
                  <span>{g.label}</span>
                  <span aria-hidden="true" className="md:hidden">
                    {isOpen ? "−" : "+"}
                  </span>
                </button>
                <ul
                  id={`menu-group-${g.id}`}
                  aria-label={g.label}
                  className={cx(
                    "flex-wrap gap-x-1 rounded-xl bg-ivory px-2 py-1 md:order-last md:basis-full",
                    isOpen ? "flex" : "hidden",
                  )}
                >
                  {g.items.map((m) => (
                    <li key={m.id}>
                      <Link
                        href={m.href}
                        aria-current={m.id === currentId ? "page" : undefined}
                        className={cx(LINK, m.id === currentId ? "border-hermes-500 font-bold text-navy-900" : "border-transparent font-semibold text-navy-600 hover:text-navy-900")}
                      >
                        {m.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
