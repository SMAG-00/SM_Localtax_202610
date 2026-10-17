"use client";

import { usePathname } from "next/navigation";
import { TabNav } from "@ltr/ui";
import { activeMenuId, type MenuItem } from "@/lib/admin/menu";

/** 역할별 메뉴 (ADM-01) — 메뉴 항목은 서버가 허용 작업에서 정해 넘긴다. 지금 보는 메뉴는 aria-current="page" */
export function AdminNav({ items }: { items: readonly MenuItem[] }) {
  const pathname = usePathname() ?? "/admin";
  return (
    <div className="border-b border-navy-100 bg-white">
      <div className="mx-auto max-w-6xl px-4">
        <TabNav label="편집국 메뉴" items={items.map((m) => ({ id: m.id, label: m.label, href: m.href }))} current={activeMenuId(items, pathname)} />
      </div>
    </div>
  );
}
