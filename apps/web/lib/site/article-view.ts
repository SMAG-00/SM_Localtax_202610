// 기사 상세 화면 값 (ART-02 · ART-03 · ART-04 · ART-05 · ART-10 · CORE-01 · PRD-01A 3장 '기사 상세') — 순수 함수 (시험 article-view.test.ts)
//  · 부분 순서 고정: 머리 → 알림(업데이트 표시·갱신 배너·정정 이력 — 본문 위) → 본문(대표 이미지·블록 | 카드뉴스 장 | 해결 사례 카드 · 출처) →
//    「지방세로 읽기」 → 기자 소개 → 자사 상품 → 면책 → 관련 기사 → 다음 행동 띠 → 정책 링크. 내용 0건인 부분은 빠진다
//  · 표기 배지: 광고는 기사 유형 배지 "광고" 하나, 공동 기획은 제휴 배지 "공동 기획 ○○" 하나 — 목록 카드와 같은 함수 (PRD-00 8.8 '섞지 않는다')
//  · 날짜: 최초 발행(늘) · 실질 수정(실질 수정·정정이 있을 때만 — 오탈자는 바꾸지 않는다, OPT-07) · 법령 기준일(있을 때)
import type { ArticleTypeBadgeKind, TaxLensLinkKind } from "@ltr/ui";
import { isBlockedPath } from "@/lib/server/public/constants";
import { typeBadgeKind } from "./home-view";

export type SponsorMarkView = { kind: "ad" } | { kind: "co_planned"; partner: string } | null;

/** 기사 유형 배지 — 공동 기획이면 유형 배지("광고")를 빼고 제휴 배지만 (둘을 섞지 않는다) */
export function typeBadgeFor(contentType: string | null, sponsor: SponsorMarkView): ArticleTypeBadgeKind | undefined {
  if (sponsor?.kind === "co_planned") return undefined;
  return typeBadgeKind(contentType);
}

/** 제휴 배지의 제휴사 이름 — 공동 기획만 */
export function partnerBadgeFor(sponsor: SponsorMarkView): string | undefined {
  return sponsor?.kind === "co_planned" ? sponsor.partner : undefined;
}

/** 화면에 보이는 표기 글자 — 목록 카드·기사 머리 비교용 (광고 → "광고", 공동 기획 → "공동 기획 ○○", 없음 → null) */
export function sponsorText(sponsor: SponsorMarkView): string | null {
  if (!sponsor) return null;
  return sponsor.kind === "ad" ? "광고" : `공동 기획 ${sponsor.partner}`;
}

/** 기사 상세 부분 — 이 순서 고정 */
export const ARTICLE_PARTS = ["head", "notices", "body", "tax-lens", "reporter", "product", "disclaimer", "related", "next", "policy"] as const;
export type ArticlePart = (typeof ARTICLE_PARTS)[number];

export interface ArticleShape {
  updates: readonly unknown[];
  corrections: readonly unknown[];
  banner: unknown;
  taxLens: unknown;
  author: unknown;
  product: unknown;
  disclaimer: boolean;
  related: readonly unknown[];
  similarCases: readonly unknown[];
  nextActions: readonly unknown[];
  policyLinks: readonly unknown[];
}

/** 보이는 부분 — 내용이 있는 것만, 순서 고정 */
export function articleParts(a: ArticleShape): ArticlePart[] {
  const has: Record<ArticlePart, boolean> = {
    head: true,
    notices: a.updates.length > 0 || a.corrections.length > 0 || Boolean(a.banner),
    body: true,
    "tax-lens": Boolean(a.taxLens),
    reporter: Boolean(a.author),
    product: Boolean(a.product),
    disclaimer: a.disclaimer,
    related: a.related.length > 0,
    next: a.similarCases.length > 0 || a.nextActions.length > 0,
    policy: a.policyLinks.length > 0,
  };
  return ARTICLE_PARTS.filter((p) => has[p]);
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 한국 시간 "2026-10-18 09:30" — 읽을 수 없으면 글자 그대로 */
export function kstDateTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t + KST_OFFSET_MS).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)}`;
}

/** 날짜 줄 — 실질 수정일은 있을 때만 (오탈자 수정은 실질 수정일을 바꾸지 않는다 — 그대로 보인다) */
export function dateLines(a: { firstPublishedAt: string | null; substantiveUpdatedAt: string | null; legalBasisDate: string | null }): {
  published: { iso: string; text: string } | null;
  modified: { iso: string; text: string } | null;
  basis: string | null;
} {
  return {
    published: a.firstPublishedAt ? { iso: a.firstPublishedAt, text: kstDateTime(a.firstPublishedAt) } : null,
    modified: a.substantiveUpdatedAt ? { iso: a.substantiveUpdatedAt, text: kstDateTime(a.substantiveUpdatedAt) } : null,
    basis: a.legalBasisDate,
  };
}

/** 칼럼 연재 줄 — "연재 「그때와 지금」 3회" */
export function seriesLine(series: { title: string; episode: number } | null): string | null {
  return series ? `연재 「${series.title}」 ${series.episode}회` : null;
}

export type Segment = { kind: "text"; text: string } | { kind: "link"; text: string; href: string; external: boolean };

const MD_LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

/**
 * 문단 글의 링크 표기 [글](주소) → 조각. 사이트 안 주소(/…)는 숨긴 경로가 아닐 때만, 바깥 주소는 http(s)만 링크가 된다.
 * 링크가 될 수 없는 표기는 글 그대로 둔다 (주소를 지우지 않는다 — 편집자가 고친다)
 */
export function paragraphSegments(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(MD_LINK)) {
    const [whole, label, href] = m as unknown as [string, string, string];
    const internal = href.startsWith("/") && !href.startsWith("//");
    const external = /^https?:\/\//i.test(href);
    if (!(internal && !isBlockedPath(href)) && !external) continue;
    if (m.index! > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push({ kind: "link", text: label, href, external });
    last = m.index! + whole.length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out.filter((s) => s.text !== "");
}

/** 표 블록 — 첫 행이 머리 행(2행 이상일 때), 빈 표는 null */
export function tableView(rows: readonly (readonly string[])[]): { head: string[] | null; body: string[][] } | null {
  const clean = rows.filter((r) => r.some((c) => c.trim() !== "")).map((r) => [...r]);
  if (clean.length === 0) return null;
  return clean.length > 1 ? { head: clean[0]!, body: clean.slice(1) } : { head: null, body: clean };
}

/** 「지방세로 읽기」 링크 종류 (CMS 값 → 박스 컴포넌트 값) */
const LENS_KIND: Record<string, TaxLensLinkKind> = { explainer: "explainer", calculator: "smCalculator", book: "product", expert: "experts" };

/** 박스 링크 — 공개 데이터 함수가 이미 열린 기능·허용 경로만 남겼다. 같은 종류가 둘이면 앞의 것 */
export function taxLensBoxLinks(links: readonly { kind: string; href: string }[]): Partial<Record<TaxLensLinkKind, { href: string; enabled: boolean }>> {
  const out: Partial<Record<TaxLensLinkKind, { href: string; enabled: boolean }>> = {};
  for (const l of links) {
    const kind = LENS_KIND[l.kind];
    if (kind && !out[kind]) out[kind] = { href: l.href, enabled: true };
  }
  return out;
}

/** 기자 소개 블록의 정책 링크 — 정책 페이지가 공개 승인된 것만 (HELP-05), 아니면 null(링크 0) */
export function reporterPolicyLinks(policyLinks: readonly { key: string; href: string }[]): { correctionHref: string | null; editorialPolicyHref: string | null } {
  const of = (key: string) => policyLinks.find((l) => l.key === key)?.href ?? null;
  return { correctionHref: of("corrections"), editorialPolicyHref: of("editorial_policy") };
}

/** 동영상 블록 — 유튜브 nocookie 주소만 링크로 (ART-08). 아니면 null(블록 0) */
export function videoHref(embedUrl: string): string | null {
  try {
    const u = new URL(embedUrl);
    return u.protocol === "https:" && (u.hostname === "www.youtube-nocookie.com" || u.hostname === "youtube-nocookie.com") ? u.toString() : null;
  } catch {
    return null;
  }
}

/** 기사 본문 면책 (ART-02 — 하위 분야의 면책 대상 값일 때만) */
export const ARTICLE_DISCLAIMER = "이 기사는 일반 정보이며 세무 자문이 아닙니다. 내 상황에 맞는 판단은 세무 전문가와 확인하세요.";
/** 업데이트 표시 글자 — 정정 이력(정정·반론·추후보도)과 다른 라벨 (ART-05) */
export const UPDATE_LABEL = "수정";
