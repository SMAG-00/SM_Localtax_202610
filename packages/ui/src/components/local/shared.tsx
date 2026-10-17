// local 묶음 안에서만 쓰는 작은 조각 — 새 창 링크·고정폭 글자·공공누리 권리 표기
import type { ReactNode } from "react";
import { cx } from "../base";

/** 고정폭 13px (룰셋·조문 번호·기준일·확인일, 8.4) */
export const MONO = "font-mono text-[13px] tracking-wide";

/** 밝은 바탕 위 글자 링크 — navy-900 글자 + 오렌지 밑줄, 호버 hermes-900, 터치 44px */
export const TEXT_LINK =
  "inline-flex min-h-11 items-center gap-1.5 text-[15px] font-bold text-navy-900 underline decoration-hermes-500 decoration-2 underline-offset-4 transition hover:text-hermes-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500";

/** 카드 겉모양 — 링크 카드 문법(호버 hermes-400 테두리 + 오렌지 그림자), 안쪽 24px */
export const CARD =
  "rounded-2xl border border-navy-100 bg-white p-6 transition hover:border-hermes-400 hover:shadow-[0_2px_20px_-8px_rgba(242,106,27,0.35)]";

/** 새 창 아이콘 — 평면 선 아이콘, 글자와 함께만 쓴다 */
function NewWindowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-current" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

/** 새 창으로 여는 외부 링크 — rel=noopener noreferrer, 아이콘 + 화면 읽기용 '(새 창)' (8.9) */
export function ExternalLink({ href, children, className = TEXT_LINK }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
      <NewWindowIcon />
      <span className="sr-only"> (새 창)</span>
    </a>
  );
}

/** 공공누리 유형 (PR-07) — 미표시도 기록된 값이다 */
export type SourceRights = "kogl-1" | "kogl-2" | "kogl-3" | "kogl-4" | "unmarked";

const RIGHTS_LABEL: Record<SourceRights, string> = {
  "kogl-1": "공공누리 제1유형(출처표시)",
  "kogl-2": "공공누리 제2유형(출처표시·상업적 이용금지)",
  "kogl-3": "공공누리 제3유형(출처표시·변경금지)",
  "kogl-4": "공공누리 제4유형(출처표시·상업적 이용금지·변경금지)",
  unmarked: "공공누리 미표시",
};

export function rightsLabel(rights: unknown): string | null {
  return typeof rights === "string" && rights in RIGHTS_LABEL ? RIGHTS_LABEL[rights as SourceRights] : null;
}

/** 설명 목록 한 줄 — 이름(굵게) + 값 */
export function Field({ term, children, mono = false }: { term: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <dt className="text-[13px] font-bold text-navy-600">{term}</dt>
      <dd className={cx("text-navy-800", mono ? MONO : "text-[15px]")}>{children}</dd>
    </div>
  );
}

/** 상태 칩 — 칩 문법(새 색 없음). '검토 중' 등 */
export function StateChip({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center rounded-md bg-navy-50 px-2.5 py-1 text-[13px] font-bold text-navy-700">{children}</span>;
}
