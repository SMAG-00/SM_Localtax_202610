// 공개 상세 화면의 응답 상태 정하기 (NAV-06 삭제 기사 410 · 공개 데이터를 읽지 못할 때 503) — 순수 모듈 (시험 public-gate.test.ts).
// proxy.ts가 상세 경로(/news/[slug] · /situations/[slug] · /people/[slug] · /partners/[id] — W2-c 4단계 · /glossary/[id] — W2-d 3단계)마다 공개 표 한 번을 anon 키로 읽어 정한다:
//  · 기사 — 삭제된 기사 주소 표(article_tombstones)에 있으면 410 + 삭제 안내. 없으면 화면으로 넘긴다(화면이 200·404를 정한다)
//  · 상황·인물·제휴사·용어 — 그 표를 읽을 수 있는지만 본다 (있는지·없는지·기능 키는 화면이 정한다)
//  · 읽지 못하면(접속값 없음·네트워크 오류·표 없음·시간 초과) 503 "잠시 뒤 다시 확인해 주세요" — 있는지 모르므로 404·410을 보이지 않는다.
//    오류 원문은 응답에 넣지 않는다(서버 로그에 상태 번호만). 캐시하지 않는다(no-store) — 다음 요청이 다시 확인한다.
// 목록 화면(홈·허브·하위 분야·칼럼·뉴스 전체)은 이 확인 없이 화면이 닫힌 모습(200 + 안내 한 줄)으로 그린다 — lib/server/public/fallback.ts.
// proxy는 서버 전용 모듈을 부르지 않는다 — 이 파일은 의존 없이 글자만 다룬다.

export type PublicDetailKind = "article" | "situation" | "person" | "partner" | "glossary";

export interface PublicDetailRoute {
  kind: PublicDetailKind;
  slug: string;
}

/** 기사 slug로 쓸 수 없는 목록 경로 (ART-01) — 기사 상세가 아니다 */
const RESERVED_NEWS = new Set(["video", "photo", "popular"]);
/** 상황·인물 주소 형식 (DB slug 검사와 같다) — 형식 밖은 DB 없이 404라 확인하지 않는다 */
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** 기사 slug 형식 (DB articles.slug 검사 — 공백·'/' 없음) */
const ARTICLE_SLUG = /^[^\s/]+$/;
/** 제휴사 번호 (partners.id — 1 이상 정수, W2-c 4단계 /partners/[id]). 형식 밖은 DB 없이 404라 확인하지 않는다 */
const PARTNER_ID = /^[1-9]\d{0,15}$/;

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** 공개 상세 경로인가 — 아니면 null (목록·백오피스·그 밖의 경로) */
export function publicDetailRoute(pathname: string): PublicDetailRoute | null {
  const m = pathname.match(/^\/(news|situations|people|partners|glossary)\/([^/]+)\/?$/);
  if (!m) return null;
  const slug = decode(m[2]!);
  if (slug === null) return null;
  if (m[1] === "news") return ARTICLE_SLUG.test(slug) && !RESERVED_NEWS.has(slug.toLowerCase()) ? { kind: "article", slug } : null;
  if (m[1] === "partners") return PARTNER_ID.test(slug) ? { kind: "partner", slug } : null;
  // 용어 쪽 (W2-d 3단계 /glossary/[번호]) — 번호 형식은 제휴사와 같다
  if (m[1] === "glossary") return PARTNER_ID.test(slug) ? { kind: "glossary", slug } : null;
  if (!KEBAB.test(slug)) return null;
  return { kind: m[1] === "situations" ? "situation" : "person", slug };
}

/**
 * 확인 요청 경로 (Supabase REST, anon 키) — 공개 칸만 고른다.
 * 값은 주소 인코딩만 한다 — 단순 비교(eq.)의 값은 `eq.` 뒤 글자 그대로라 쉼표·괄호·마침표도 한 값이다(따옴표를 두르면 따옴표까지 값이 된다 — 로컬 PostgREST로 확인)
 */
export function probePath(route: PublicDetailRoute): string {
  const v = encodeURIComponent(route.slug);
  switch (route.kind) {
    case "article":
      return `/rest/v1/article_tombstones?select=slug,removed_at&slug=eq.${v}&limit=1`;
    case "situation":
      return `/rest/v1/situations?select=slug&slug=eq.${v}&limit=1`;
    case "person":
      return `/rest/v1/public_people?select=slug&slug=eq.${v}&limit=1`;
    case "partner":
      return `/rest/v1/partners?select=id&id=eq.${v}&limit=1`;
    case "glossary":
      return `/rest/v1/glossary_terms?select=id&id=eq.${v}&limit=1`;
  }
}

export type ProbeResult = { ok: true; rows: unknown } | { ok: false };

export type GateDecision = { kind: "pass" } | { kind: "gone"; removedAt: string } | { kind: "unavailable" };

/** 확인 결과 → 응답 — 읽지 못함·모양이 틀린 응답은 503, 삭제 기록이 있는 기사는 410, 그 밖은 화면으로 */
export function gateDecision(route: PublicDetailRoute, probe: ProbeResult): GateDecision {
  if (!probe.ok || !Array.isArray(probe.rows)) return { kind: "unavailable" };
  if (route.kind !== "article") return { kind: "pass" };
  const row = probe.rows.find((r): r is { slug: string; removed_at: string } => typeof r === "object" && r !== null && (r as { slug?: unknown }).slug === route.slug);
  return row && typeof row.removed_at === "string" ? { kind: "gone", removedAt: row.removed_at } : { kind: "pass" };
}

/** 공개 데이터를 읽지 못했을 때의 안내 (목록 화면 한 줄 · 상세 503 화면 제목) */
export const UNAVAILABLE_NOTICE = "새 소식을 잠시 불러오지 못했습니다. 잠시 뒤 다시 확인해 주세요.";
export const UNAVAILABLE_TITLE = "잠시 뒤 다시 확인해 주세요";
export const GONE_TITLE = "삭제된 기사입니다";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
/** 한국 날짜 "2026-10-18" — 읽을 수 없으면 null */
export function kstDay(iso: string): string | null {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t + KST_OFFSET_MS).toISOString().slice(0, 10);
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

export interface Notice {
  status: 410 | 503;
  title: string;
  lines: string[];
  links: { label: string; href: string }[];
}

/** 410·503 안내 내용 — 쉬운 말, 오류 원문 0 */
export function noticeFor(decision: Exclude<GateDecision, { kind: "pass" }>): Notice {
  if (decision.kind === "gone") {
    const day = kstDay(decision.removedAt);
    return {
      status: 410,
      title: GONE_TITLE,
      lines: [day ? `이 기사는 ${day}에 편집국이 내렸습니다.` : "이 기사는 편집국이 내렸습니다.", "다른 기사는 뉴스 전체에서 볼 수 있습니다."],
      links: [
        { label: "뉴스 전체 보기", href: "/news" },
        { label: "홈으로 가기", href: "/" },
      ],
    };
  }
  return {
    status: 503,
    title: UNAVAILABLE_TITLE,
    lines: ["지금 이 화면의 자료를 읽지 못했습니다. 잠시 뒤 다시 열어 주세요."],
    links: [{ label: "홈으로 가기", href: "/" }],
  };
}

/** 안내 화면 HTML — 공개 틀(헤더·바닥글) 없이 혼자 서는 쪽. 색은 글꼴 기본값만 쓴다 (디자인 토큰 CSS는 이 응답에 없다) */
export function noticeHtml(n: Notice): string {
  const lines = n.lines.map((l) => `<p>${esc(l)}</p>`).join("");
  const links = n.links.map((l) => `<li><a href="${esc(l.href)}">${esc(l.label)}</a></li>`).join("");
  return [
    "<!doctype html>",
    '<html lang="ko">',
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">',
    `<title>${esc(n.title)}</title>`,
    "<style>body{margin:0;font-family:Pretendard,-apple-system,BlinkMacSystemFont,'Malgun Gothic',sans-serif;line-height:1.6;font-size:17px}main{max-width:40rem;margin:0 auto;padding:80px 16px}h1{font-size:28px;line-height:1.25}ul{padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:8px 24px}a{display:inline-flex;min-height:44px;align-items:center;font-weight:700}</style>",
    "</head>",
    `<body><main data-notice="${n.status}"><h1>${esc(n.title)}</h1>${lines}<ul>${links}</ul></main></body>`,
    "</html>",
  ].join("");
}

/** 안내 응답 머리글 — 캐시 0 · 검색 노출 0 · 503은 30초 뒤 다시 */
export function noticeHeaders(status: 410 | 503): Record<string, string> {
  return {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-robots-tag": "noindex",
    ...(status === 503 ? { "retry-after": "30" } : {}),
  };
}
