// 사이트 주소 정하기 (W2-e 설계 4.3) — 메일 링크가 자기 주소로 돌아오게 요청의 호스트를 쓴다. 순수 함수.
//  · 허용 호스트: localhost·127.0.0.1·[::1] · *.vercel.app · 환경변수 사이트 주소(NEXT_PUBLIC_SITE_URL)의 호스트
//  · 허용 호스트가 아니면(호스트 머리글 위조) 환경변수 사이트 주소로 대체 — 그것도 없으면 null(메일 링크를 만들지 않는다)
export interface SiteUrlInput {
  host: string | null;
  forwardedHost: string | null;
  forwardedProto: string | null;
  /** 요청 주소의 프로토콜("http:" 또는 "https:") */
  requestProtocol: string;
  envSiteUrl: string | undefined;
}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseHost(raw: string | null): URL | null {
  const host = raw?.split(",")[0]?.trim().toLowerCase();
  if (!host) return null;
  try {
    const u = new URL(`http://${host}`);
    return u.host === host && u.username === "" && u.pathname === "/" ? u : null;
  } catch {
    return null;
  }
}

export function resolveSiteBase(input: SiteUrlInput): string | null {
  const env = input.envSiteUrl?.trim().replace(/\/+$/, "") || null;
  let envHost: string | null = null;
  if (env) {
    try {
      envHost = new URL(env).host.toLowerCase();
    } catch {
      envHost = null;
    }
  }
  const candidate = parseHost(input.forwardedHost) ?? parseHost(input.host);
  if (candidate) {
    const local = LOCAL_HOSTNAMES.has(candidate.hostname);
    const allowed = local || candidate.hostname.endsWith(".vercel.app") || candidate.host === envHost;
    if (allowed) {
      const forwarded = input.forwardedProto?.split(",")[0]?.trim().toLowerCase();
      const proto = forwarded === "http" || forwarded === "https" ? forwarded : local ? input.requestProtocol.replace(":", "") : "https";
      return `${proto}://${candidate.host}`;
    }
  }
  return env;
}
