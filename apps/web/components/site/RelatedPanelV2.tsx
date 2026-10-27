"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PANEL_KINDS_V2, PANEL_KIND_LABELS, ORIGIN_LABELS, countByKind, filterByKind, sortItems, type PanelItemV2, type PanelKindV2, type PanelSort } from "@/lib/law/panel-v2";

// 관련 자료 패널 v2 (LAW-10) - 유형 필터 · 최신순/관련도순 · 카드마다 추천 이유와 출처 · 프리미엄 잠금 배지.
// 패널은 본문을 받지 않는다(제목·이유·배지뿐). splitBase(예: /workspace/split?p=)가 있으면 [분할 화면에 열기]를 보인다(키 law_split 켜짐일 때 서버가 넘긴다).
export function RelatedPanelV2({ items, searchHref, splitBase }: { items: PanelItemV2[]; searchHref: string; splitBase: string | null }) {
  const [kind, setKind] = useState<PanelKindV2 | "all">("all");
  const [sort, setSort] = useState<PanelSort>("latest");
  const counts = useMemo(() => countByKind(items), [items]);
  const shown = useMemo(() => sortItems(filterByKind(items, kind), sort), [items, kind, sort]);
  if (items.length === 0) {
    return (
      <p data-part="related-v2-empty" className="text-[14px] text-navy-700">
        아직 연결된 자료가 없어요 ·{" "}
        <Link href={searchHref} className="font-bold underline underline-offset-4">
          판례·해석 검색
        </Link>
      </p>
    );
  }
  return (
    <section data-part="related-panel-v2" aria-label="관련 자료" className="rounded-2xl border border-navy-100 bg-white p-4">
      <div role="group" aria-label="자료 유형" className="flex flex-wrap gap-1">
        {(["all", ...PANEL_KINDS_V2] as const).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={`rounded-full px-3 py-1 text-[13px] font-bold ${kind === k ? "bg-navy-900 text-white" : "border border-navy-200 text-navy-900"}`}>
            {k === "all" ? "전체" : PANEL_KIND_LABELS[k]} {counts[k]}
          </button>
        ))}
      </div>
      <label className="mt-3 flex items-center gap-2 text-[13px]">
        정렬
        <select value={sort} onChange={(e) => setSort(e.target.value as PanelSort)} className="rounded border border-navy-200 px-2 py-1">
          <option value="latest">최신순</option>
          <option value="relevance">관련도순</option>
        </select>
      </label>
      <ul className="mt-3 space-y-3">
        {shown.length === 0 && <li className="text-[14px] text-navy-500">이 유형의 연결된 자료가 없습니다.</li>}
        {shown.map((i) => (
          <li key={i.linkId} data-link-id={i.linkId} data-origin={i.origin} data-locked={i.locked ? "true" : "false"} className="rounded-xl border border-navy-100 p-3">
            <Link href={i.href} className="text-[15px] font-bold text-navy-900 underline underline-offset-4">
              {i.title}
            </Link>
            <p data-part="reason" className="mt-1 text-[13px] text-navy-700">
              {i.reason}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-1 text-[12px]">
              <span className="rounded-full border border-navy-200 px-2 py-0.5">{PANEL_KIND_LABELS[i.kind]}</span>
              <span className="rounded-full border border-navy-200 px-2 py-0.5">{ORIGIN_LABELS[i.origin]}</span>
              {i.decidedOn && <time dateTime={i.decidedOn} className="font-mono text-navy-700">{i.decidedOn}</time>}
              {i.locked && <span data-part="lock-badge" className="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-900">구독자 전용</span>}
              {splitBase && i.splitSpec && !i.locked && (
                <Link href={`${splitBase}${i.splitSpec}`} className="underline underline-offset-4">
                  분할 화면에 열기
                </Link>
              )}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
