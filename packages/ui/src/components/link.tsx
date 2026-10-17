"use client";

import { createContext, useContext, type AnchorHTMLAttributes, type ComponentType, type ReactNode, type Ref } from "react";

/** 컴포넌트 안 링크가 받는 값 — 보통의 a 요소 속성 + 주소 */
export type UiLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string; ref?: Ref<HTMLAnchorElement> };

/** 사이트 안 이동을 맡는 링크 컴포넌트 (앱이 정한다 — 예: Next.js의 Link) */
export type LinkComponent = ComponentType<UiLinkProps>;

const LinkContext = createContext<LinkComponent | null>(null);

/**
 * 사이트 안 이동 링크를 컴포넌트 묶음에 알려 준다 (FND-09 — 사이트 안 이동은 새로고침 없이).
 * 이 묶음은 특정 프레임워크에 묶이지 않으므로, 앱이 자기 링크 컴포넌트를 넘긴다. 없으면 보통의 a 요소다(견본·시험·관리자 화면).
 */
export function LinkProvider({ component, children }: { component: LinkComponent; children: ReactNode }) {
  return <LinkContext value={component}>{children}</LinkContext>;
}

/** 사이트 안 주소 — '/'로 시작하고 '//'(다른 사이트 주소)가 아니다. '#본문' 같은 쪽 안 이동은 사이트 안 이동이 아니다 */
export function isInternalHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

/**
 * 컴포넌트 안의 모든 링크 — 사이트 안 주소이고 같은 창이면 앱의 링크 컴포넌트(화면 전환), 아니면 보통의 a 요소(전체 이동).
 * 외부 링크·새 창·파일 내려받기는 전체 이동한다 (FND-09).
 */
export function UiLink({ href, target, download, ...rest }: UiLinkProps) {
  const AppLink = useContext(LinkContext);
  const sameWindow = target === undefined || target === "_self";
  if (AppLink && isInternalHref(href) && sameWindow && download === undefined) return <AppLink href={href} target={target} {...rest} />;
  return <a href={href} target={target} download={download} {...rest} />;
}
