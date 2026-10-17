// services 묶음 내부 조각 — 같은 토큰·문법을 여러 컴포넌트가 함께 쓴다 (견본 등록 대상이 아니다)
import type { ReactNode } from "react";
import { cx, DarkButton } from "../base";
import { UiLink } from "../link";
import { isExternalHref, kstDate, kstDateTime } from "./format";

/** 밝은 바탕 글자 링크 — SM 링크 문법(hermes-800 밑줄, 호버 hermes-900). 주 버튼이 아니다. 터치 44px */
export const TEXT_LINK =
  "inline-flex min-h-11 items-center gap-1 font-bold text-hermes-800 underline underline-offset-4 hover:text-hermes-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500";

/** 새 창 아이콘 — 글자("새 창")와 함께만 쓴다 (8.9) */
export function NewWindowIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx("h-4 w-4 shrink-0", className)}
    >
      <path d="M9.5 2.5h4v4" />
      <path d="M13.5 2.5 7.5 8.5" />
      <path d="M11.5 9.5v4h-9v-9h4" />
    </svg>
  );
}

/** 글자 링크 — 바깥 주소면 새 창(rel=noopener noreferrer) + 아이콘 + "(새 창)", 사이트 안 주소는 화면 전환 링크(UiLink) */
export function SiteLink({ href, children, className, newWindowLabel = "새 창" }: { href: string; children: ReactNode; className?: string; newWindowLabel?: string }) {
  const external = isExternalHref(href);
  return (
    <UiLink href={href} className={cx(TEXT_LINK, className)} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {children}
      {external && (
        <>
          <NewWindowIcon />
          <span className="sr-only"> ({newWindowLabel})</span>
        </>
      )}
    </UiLink>
  );
}

/** 기사 유형 배지 문법 — 'AI 답변'·'교육·상품'·'자사 상품' (navy-800 / 흰 바탕, 8.3) */
export function TypeBadge({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center rounded-md border border-navy-200 bg-white px-2.5 py-1 text-[13px] font-bold text-navy-800">{children}</span>;
}

/** 국세·지방세 글자 표시 — 국세 navy-800/ivory-dark, 지방세 흰 글자/navy-900 (8.3 · 8.6 국세·지방세 배지와 같은 조합) */
export function TaxKindLabel({ kind }: { kind: "national" | "local" }) {
  return kind === "national" ? (
    <span className="inline-flex items-center rounded-md border border-navy-200 bg-ivory-dark px-2.5 py-1 text-[13px] font-bold text-navy-800">국세</span>
  ) : (
    <span className="inline-flex items-center rounded-md border border-navy-900 bg-navy-900 px-2.5 py-1 text-[13px] font-bold text-white">지방세</span>
  );
}

const TONE = {
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  rose: "border-rose-200 bg-rose-50 text-rose-800",
} as const;

/** 상태 글자 칩 — 색에 더해 글자로 뜻을 전한다 (8.9). 조합은 8.3 대비표 (800 글자 / 50 바탕) */
export function StateChip({ tone, children, part }: { tone: keyof typeof TONE; children: ReactNode; part?: string }) {
  return (
    <span data-part={part} className={cx("inline-flex shrink-0 items-center rounded-md border px-2.5 py-1 text-[13px] font-bold", TONE[tone])}>
      {children}
    </span>
  );
}

/** 날짜 <time> — 한국 시간 표기. 고정폭은 감싸는 요소가 정한다 */
export function DateText({ value, withTime = false, className }: { value: string; withTime?: boolean; className?: string }) {
  return (
    <time dateTime={value} className={className}>
      {withTime ? kstDateTime(value) : kstDate(value)}
    </time>
  );
}

/** 고정폭 13px (8.4) */
export const MONO = "font-mono text-[13px] tracking-wide text-navy-600";

export type ExpertLinks = {
  /** [전문가 직접 찾기] — `/experts?field=` 분야 코드 (EXPL-06) */
  findHref: string;
  /** [SM 전문가에게 연락 받기] — 연락 요청이 닫혀 있으면 넘기지 않는다 (버튼 0) */
  requestHref?: string;
};

/** 전문가 연결 두 버튼 (CHAT-17) — 어두운 버튼 같은 비중, 주 버튼 0 */
export function ExpertButtons({ links }: { links: ExpertLinks }) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <DarkButton href={links.findHref}>전문가 직접 찾기</DarkButton>
      {links.requestHref && <DarkButton href={links.requestHref}>SM 전문가에게 연락 받기</DarkButton>}
    </div>
  );
}
