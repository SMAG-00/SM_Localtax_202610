import type { ReactNode } from "react";
import { cx } from "./cx";

export type CardLinkProps = {
  href: string;
  children: ReactNode;
  /** 새 창으로 여는 외부 링크 — rel=noopener noreferrer, 화면 읽기에 '새 창' 안내 */
  external?: boolean;
  className?: string;
  "aria-label"?: string;
};

function CardLink({ href, children, external, className, ui, ...aria }: CardLinkProps & { ui: string }) {
  return (
    <a href={href} data-ui={ui} className={className} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})} {...aria}>
      {children}
      {external && <span className="sr-only"> (새 창)</span>}
    </a>
  );
}

/** 링크 카드 — 카드 전체가 하나의 링크. 호버 때 hermes-400 테두리와 오렌지 그림자 */
export function LinkCard(props: CardLinkProps) {
  return (
    <CardLink
      {...props}
      ui="link-card"
      className={cx(
        "group block rounded-2xl border border-navy-100 bg-white p-6 transition hover:border-hermes-400 hover:shadow-[0_2px_20px_-8px_rgba(242,106,27,0.35)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500",
        props.className,
      )}
    />
  );
}

/** 도구 카드 — 계산기·도구 진입. 호버 때 살짝 뜨고 navy-900 테두리 */
export function ToolCard(props: CardLinkProps) {
  return (
    <CardLink
      {...props}
      ui="tool-card"
      className={cx(
        "group block rounded-2xl border border-navy-100 bg-white p-6 transition hover:-translate-y-0.5 hover:border-navy-900 hover:shadow-[0_8px_30px_-12px_rgba(6,24,42,0.35)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500",
        props.className,
      )}
    />
  );
}
