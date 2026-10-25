"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { track } from "@/lib/analytics/client";
import { PANEL_TABS, PANEL_TAB_LABELS, PANEL_TAB_NAMES, groupByTab, isAfterAsOf, reasonForProvision, type PanelTab, type RelatedItem } from "@/lib/law/related";

// 관련 자료 패널 (LAW-06 · TX-11) - 조문 옆 오른쪽 패널(1024px 미만은 아래 시트). 연결 목록은 서버가 확인된 연결(public_links)로 만든 그대로다.
//  · 유형 탭 [판]·[심]·[해]·기사, 카드마다 '왜 관련 있나' 한 줄(관계 값에서 만든 글 - AI 생성 0), 편집자 연결과 자동 추출 구분
//  · 0건이면 '아직 연결된 자료가 없어요 · 판례·해석 검색'. 키보드로 열고 닫는다(버튼, Esc). 패널은 화면에 고정돼 있어 본문 스크롤 위치가 바뀌지 않는다.
//  · mode column(3단 보기)은 1024px 이상에서 오른쪽 열로 항상 보인다(열고 닫아도 3열 정렬 불변), 미만에서는 시트.

const EVENT_TAB: Partial<Record<PanelTab, "case" | "tribunal" | "interpretation">> = { case: "case", tribunal: "tribunal", interpretation: "interpretation" };

export function RelatedPanel({ items, asOf, place, searchHref, mode = "overlay", from = "panel", emptyText = "아직 연결된 자료가 없어요", searchLabel = "판례·해석 검색" }: { items: RelatedItem[]; asOf: string; place: "law_view" | "three_view"; searchHref: string; mode?: "overlay" | "column"; from?: string; emptyText?: string; searchLabel?: string }) {
  const groups = groupByTab(items);
  const firstWithItems = PANEL_TABS.find((t) => groups[t].length > 0) ?? "case";
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<PanelTab>(firstWithItems);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  function toggle(next: boolean) {
    setOpen(next);
    if (next) {
      const t = EVENT_TAB[tab];
      if (t) void track("related_panel_opened", { section: "tax", props: { tab: t, place } });
    } else button.current?.focus();
  }

  const panelClass =
    mode === "column"
      ? `${open ? "fixed inset-x-0 bottom-0 z-30 max-h-[70vh] overflow-y-auto rounded-t-2xl shadow-lg" : "hidden"} border border-navy-100 bg-white p-4 lg:static lg:block lg:max-h-none lg:rounded-2xl lg:shadow-none`
      : `${open ? "fixed inset-x-0 bottom-0 z-30 max-h-[70vh] overflow-y-auto rounded-t-2xl shadow-lg lg:inset-y-0 lg:left-auto lg:right-0 lg:max-h-none lg:w-[360px] lg:rounded-none" : "hidden"} border border-navy-100 bg-white p-4`;

  return (
    <div data-part="related-panel" data-open={open ? "true" : "false"}>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => toggle(!open)}
        className={`rounded-lg border border-navy-300 bg-white px-3 py-1.5 text-[14px] font-bold text-navy-900 ${mode === "column" ? "lg:hidden" : ""}`}
      >
        관련 자료 {items.length}건 {open ? "닫기" : "열기"}
      </button>
      <aside
        id={id}
        aria-label="관련 자료"
        data-part="related-body"
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            toggle(false);
          }
        }}
        className={panelClass}
      >
        {items.length === 0 ? (
          <p data-part="related-empty" className="text-[14px] text-navy-700">
            {emptyText} ·{" "}
            <Link href={searchHref} className="font-bold underline underline-offset-4">
              {searchLabel}
            </Link>
          </p>
        ) : (
          <>
            <div role="tablist" aria-label="자료 유형" className="flex gap-1">
              {PANEL_TABS.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  id={`${id}-tab-${t}`}
                  aria-selected={tab === t}
                  aria-controls={`${id}-panel-${t}`}
                  onClick={() => setTab(t)}
                  className={`rounded-full px-3 py-1 text-[13px] font-bold ${tab === t ? "bg-navy-900 text-white" : "border border-navy-200 text-navy-900"}`}
                >
                  <span aria-hidden="true">{PANEL_TAB_LABELS[t]}</span>
                  <span className="sr-only">{PANEL_TAB_NAMES[t]}</span> {groups[t].length}
                </button>
              ))}
            </div>
            {PANEL_TABS.map((t) => (
              <ul key={t} role="tabpanel" id={`${id}-panel-${t}`} aria-labelledby={`${id}-tab-${t}`} hidden={tab !== t} data-tab={t} className="mt-3 space-y-3">
                {groups[t].length === 0 && <li className="text-[14px] text-navy-500">이 유형의 연결된 자료가 없습니다.</li>}
                {groups[t].map((i) => (
                  <li key={i.linkId} data-link-id={i.linkId} data-origin={i.origin} className="rounded-xl border border-navy-100 p-3">
                    <Link href={i.href.includes("?") ? i.href : `${i.href}${i.kind === "legal_doc" ? `?from=${from}` : ""}`} className="text-[15px] font-bold text-navy-900 underline underline-offset-4">
                      {i.title}
                    </Link>
                    <p className="mt-1 text-[13px] text-navy-700">{reasonForProvision(i)}</p>
                    <p className="mt-1 flex flex-wrap gap-1 text-[12px]">
                      <span className="rounded-full border border-navy-200 px-2 py-0.5">{i.origin === "auto" ? "자동 추출 · 편집자 확인" : "편집자 연결"}</span>
                      {i.decidedOn && <time dateTime={i.decidedOn} className="font-mono text-navy-700">{i.decidedOn}</time>}
                      {isAfterAsOf(i.decidedOn, asOf) && (
                        <span data-part="after-as-of" className="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-900">
                          기준일 이후 문서
                        </span>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            ))}
          </>
        )}
        {open && (
          <button type="button" onClick={() => toggle(false)} className="mt-3 rounded-lg border border-navy-300 px-3 py-1 text-[13px] font-bold lg:hidden">
            닫기
          </button>
        )}
      </aside>
    </div>
  );
}
