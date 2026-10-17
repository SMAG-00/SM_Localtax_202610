// 허브·하위 분야 목록·뉴스 전체·상황 페이지의 화면 값 (CAT-02 · UX-05 · PRD-01A 3장 화면 표) — 순수 함수 (시험 hub-view.test.ts)
//  · 허브 골격은 네 허브가 같다: 머리(분야 허브 머리 — 아이브로·제목·소개 → 지방세 포인트 → 탭) → 분야 고유 블록 자리 → 최신 목록 → 상황 카드 → 관련 용어.
//    내용이 0건인 부분은 빠지고(빈 칸 0), 빠지지 않은 부분의 순서는 그대로다. 바탕은 보이는 순서대로 ivory ↔ ivory-dark (머리가 ivory)
//  · 기사 0건인 목록(빈 하위 분야·기사 없는 편집 분야)은 상위 허브 안내 + noindex — 응답은 200 (설계 9장)
//  · 쪽 넘김은 주소 쿼리 page (2쪽부터). 다른 쿼리(section·topic)는 그대로 둔다
import { brand, type StepTimelineItem } from "@ltr/ui";
import { sectionTones, type SectionTone } from "./home-view";

/** 허브 본문 부분 — 이 순서 고정 */
export const HUB_PARTS = ["head", "blocks", "latest", "situations", "terms"] as const;
export type HubPart = (typeof HUB_PARTS)[number];

/** 부분 머리 — 아이브로(영문)와 제목 (분야 고유 블록은 블록마다 제목이 있어 머리가 없다) */
export const HUB_HEADINGS = {
  latest: { eyebrow: "LATEST", title: "최신 기사" },
  situations: { eyebrow: "SITUATIONS", title: "상황으로 찾기" },
  terms: { eyebrow: "GLOSSARY", title: "관련 용어" },
} as const;

interface HubShape {
  blocks: unknown;
  latest: readonly unknown[];
  situations: readonly unknown[];
  terms: readonly unknown[];
  /** 고른 분야에 기사가 0건 — 최신 목록 자리에 상위 허브 안내를 둔다 */
  noindex: boolean;
}

/** 보이는 허브 부분과 바탕 — 내용이 있는 부분만, 순서 고정 */
export function hubParts(hub: HubShape): Array<{ key: HubPart; tone: SectionTone }> {
  const present: HubPart[] = ["head"];
  if (hub.blocks) present.push("blocks");
  if (hub.latest.length > 0 || hub.noindex) present.push("latest");
  if (hub.situations.length > 0) present.push("situations");
  if (hub.terms.length > 0) present.push("terms");
  return sectionTones(present);
}

/** 화면 제목 — "이름 — 제품명" */
export const pageTitle = (name: string) => `${name} — ${brand.productName}`;

/** 기사 0건 목록의 검색 노출 — noindex (전환 뒤 SITE_INDEXING이 켜져도 유지, SEO-04). 아니면 루트 설정 그대로(undefined) */
export function listRobots(noindex: boolean): { index: false; follow: false } | undefined {
  return noindex ? { index: false, follow: false } : undefined;
}

/** 주소 쿼리 값 하나 (목록이면 첫 값) */
export function queryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** 쿼리 page → 쪽 번호 (숫자만, 아니면 1) */
export function parsePage(value: string | string[] | undefined): number {
  const raw = queryValue(value);
  if (raw === undefined || !/^[1-9]\d{0,5}$/.test(raw)) return 1;
  return Number(raw);
}

/** 이전·다음 쪽 주소 — 다른 쿼리는 그대로, 1쪽은 page를 뺀다 */
export function pagerLinks(basePath: string, query: Readonly<Record<string, string | null | undefined>>, page: number, hasMore: boolean): { prev: string | null; next: string | null } {
  const href = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  return { prev: page > 1 ? href(page - 1) : null, next: hasMore ? href(page + 1) : null };
}

/** 먼저 확인할 것 → 단계 타임라인 항목 (UX-05 — 공개 상황은 정확히 3개, DB가 보장한다) */
export function situationSteps(checks: readonly { title: string; when?: string; note?: string }[]): StepTimelineItem[] {
  return checks.map((c) => ({ title: c.title, ...(c.when ? { when: c.when } : {}), ...(c.note ? { note: c.note } : {}) }));
}

/** 지역 선택 칩 주소 — 이 상황 페이지 안에서 지역만 바꾼다 (UX-05 '집을 샀어요') */
export function regionHref(situationHref: string, code: string | null): string {
  return code ? `${situationHref}?region=${encodeURIComponent(code)}` : situationHref;
}

/** 감수일 — 한국 날짜 고정폭 (감수자 이름은 공개 칸이 아직 없다 — 설계 9장 #13) */
export function reviewedLine(reviewedOn: string | null): string | null {
  return reviewedOn ? `세무 감수 ${reviewedOn}` : null;
}
