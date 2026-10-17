"use client";

import { useId, useState } from "react";
import { cx } from "../base";
import { TaxKindBadge, type TaxKindBadgeKind } from "./TaxKindBadge";

export type TaxAccordionItem = {
  id: string;
  /** 세목 이름 (예: 취득세) */
  name: string;
  kind: TaxKindBadgeKind;
  /** 한 줄 설명 */
  summary: string;
  /** 과세표준 */
  base: string;
  /** 세율 */
  rate: string;
  /** 납부시기 */
  due: string;
  /** 근거조문 — 고정폭 */
  law: string;
  /** 펼쳤을 때 더 보일 설명 */
  detail?: string;
};

function Row({ term, desc, mono }: { term: string; desc: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 font-semibold text-navy-600">{term}</dt>
      <dd className={cx("text-navy-800", mono && "font-mono text-[13px] tracking-wide")}>{desc}</dd>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={cx("mt-1 size-[24px] shrink-0 text-navy-500 transition", open && "rotate-180")} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function AccordionItem({ item }: { item: TaxAccordionItem }) {
  const [open, setOpen] = useState(false);
  const base = useId();
  const buttonId = `${base}-button`;
  const panelId = `${base}-panel`;
  return (
    <li className="rounded-2xl border border-navy-100 bg-white">
      <h3>
        <button
          id={buttonId}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-11 w-full items-start gap-3 rounded-2xl px-5 py-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500"
        >
          <span className="mt-1 shrink-0">
            <TaxKindBadge kind={item.kind} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[19px] font-black tracking-tight text-navy-900">{item.name}</span>
            <span className="mt-1 block text-[15px] text-navy-600">{item.summary}</span>
          </span>
          <Chevron open={open} />
        </button>
      </h3>
      <div id={panelId} hidden={!open} className="rounded-b-2xl border-t border-navy-100 bg-ivory px-5 py-4">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-[15px] sm:grid-cols-2">
          <Row term="과세표준" desc={item.base} />
          <Row term="세율" desc={item.rate} />
          <Row term="납부시기" desc={item.due} />
          <Row term="근거조문" desc={item.law} mono />
        </dl>
        {item.detail && <p className="mt-3 text-[16px] leading-relaxed whitespace-pre-line text-navy-700">{item.detail}</p>}
      </div>
    </li>
  );
}

/**
 * 세목 아코디언 — SM 세목 카드 목록 그대로 (PRD-00 8.6). 배지(지방세·국세·기타) + 제목 19px + 한 줄 설명 → 펼치면
 * 과세표준·세율·납부시기·근거조문. 세목마다 따로 펼치는 공개(disclosure) 버튼이고 aria-expanded·aria-controls로 알린다 (8.9).
 */
export function TaxAccordion({ items }: { items: readonly TaxAccordionItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul data-ui="tax-accordion" className="space-y-3">
      {items.map((item) => (
        <AccordionItem key={item.id} item={item} />
      ))}
    </ul>
  );
}
