import "server-only";
import { resolveSiteBase } from "@/lib/auth/site-url";
import { siteUrl } from "./env";

/** 메일 링크에 쓰는 사이트 주소 — 요청 호스트(허용 호스트일 때) 또는 NEXT_PUBLIC_SITE_URL. 없으면 null */
export const siteBase = (request: Request): string | null =>
  resolveSiteBase({
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProto: request.headers.get("x-forwarded-proto"),
    requestProtocol: new URL(request.url).protocol,
    envSiteUrl: siteUrl(),
  });
