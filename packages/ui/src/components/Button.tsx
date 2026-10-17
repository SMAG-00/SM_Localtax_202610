import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

type Common = { children: ReactNode; className?: string };
type AsButton = Common & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> & { href?: undefined };
type AsLink = Common & { href: string; external?: boolean };
export type ButtonProps = AsButton | AsLink;

function renderButton(base: string, ui: string, props: ButtonProps) {
  if (props.href !== undefined) {
    const { href, children, className } = props;
    const external = "external" in props && props.external;
    return (
      <a href={href} data-ui={ui} className={cx(base, className)} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
        {children}
      </a>
    );
  }
  const { children, className, type = "button", ...rest } = props;
  return (
    <button type={type} data-ui={ui} className={cx(base, "disabled:cursor-not-allowed disabled:opacity-50", className)} {...rest}>
      {children}
    </button>
  );
}

/** 주 버튼 — 한 화면(뷰포트)에 1개 (R2). 글자는 반드시 navy-900 (흰 글자/hermes-500 대비 3.1:1 금지) */
export function PrimaryButton(props: ButtonProps) {
  return renderButton(
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-hermes-500 px-7 py-4 text-[17px] font-bold text-navy-900 shadow-lg shadow-hermes-500/25 transition hover:bg-hermes-600 hover:shadow-[0_2px_20px_-8px_rgba(242,106,27,0.35)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500",
    "primary-button",
    props,
  );
}

/** 보조 버튼 (어두운 바탕 위) */
export function SecondaryButton(props: ButtonProps) {
  return renderButton(
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-navy-500 bg-navy-800/60 px-6 py-3.5 text-[16px] font-semibold text-white transition hover:border-navy-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400",
    "secondary-button",
    props,
  );
}

/** 어두운 버튼 — 카드 안 할 일 버튼. 상위 요소에 group이 있으면 호버 때 오렌지 면 + navy-900 글자 */
export function DarkButton(props: ButtonProps) {
  return renderButton(
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-navy-900 px-5 py-3 text-[15px] font-bold text-white transition group-hover:bg-hermes-500 group-hover:text-navy-900 hover:bg-hermes-500 hover:text-navy-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500",
    "dark-button",
    props,
  );
}
