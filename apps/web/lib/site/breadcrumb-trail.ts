// 고정 주소의 경로 표시(BreadcrumbList) 목록 — 분야 이름은 SECTION_INFO 한 표에서 읽는다(분야 이름을 바꾸면 함께 바뀐다). 순수 모듈 (OPT-02 · SEO-01)
//  · 동적 주소(기사·하위 분야·프로젝트·지역 등)는 그 화면이 자기 데이터로 만든다. 여기에는 고정 주소만 있다.
import { breadcrumbList, toJsonLdScriptContent } from "@ltr/structured-data";
import { SECTION_INFO } from "@/lib/server/public/constants";

export interface TrailItem {
  name: string;
  /** 사이트 안 경로 (/…) */
  path: string;
}

const HOME: TrailItem = { name: "홈", path: "/" };
const section = (key: keyof typeof SECTION_INFO): TrailItem => ({ name: SECTION_INFO[key].name, path: SECTION_INFO[key].href });
const item = (name: string, path: string): TrailItem => ({ name, path });

/** 고정 주소 → 홈부터 현재 화면까지. 고정 주소가 아니면 null */
export function staticTrail(pathname: string): TrailItem[] | null {
  const path = pathname.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
  const inheritance = item("상속·증여 안내", "/realestate/inheritance-gift");
  const table: Record<string, TrailItem[]> = {
    "/tax": [section("tax")],
    "/realestate": [section("realestate")],
    "/finance": [section("finance")],
    "/local": [section("local")],
    "/news": [item("뉴스", "/news")],
    "/news/popular": [item("뉴스", "/news"), item("많이 본 기사", "/news/popular")],
    "/news/video": [item("뉴스", "/news"), item("동영상 기사", "/news/video")],
    "/news/photo": [item("뉴스", "/news"), item("포토 기사", "/news/photo")],
    "/tax/amendments": [section("tax"), item("개정 트래커", "/tax/amendments")],
    "/tax/interpretations": [section("tax"), item("해석·해설", "/tax/interpretations")],
    "/realestate/inheritance-gift": [section("realestate"), inheritance],
    "/realestate/inheritance-gift/inheritance": [section("realestate"), inheritance, item("상속", "/realestate/inheritance-gift/inheritance")],
    "/realestate/inheritance-gift/gift": [section("realestate"), inheritance, item("증여", "/realestate/inheritance-gift/gift")],
    "/finance/trust-pf": [section("finance"), item("신탁·PF 구조 해설", "/finance/trust-pf")],
    "/glossary": [item("용어사전", "/glossary")],
    "/experts": [item("SM 전문가", "/experts")],
    "/calc": [item("계산기", "/calc")],
    "/about": [item("매체 소개", "/about")],
    "/about/measurement": [item("매체 소개", "/about"), item("방문 통계 설정", "/about/measurement")],
  };
  const trail = table[path];
  return trail ? [HOME, ...trail] : null;
}

/** 경로 목록 → BreadcrumbList 글 (사이트 주소가 없으면 절대 주소를 만들 수 없어 내지 않는다) */
export function trailJsonLd(trail: readonly TrailItem[], site: string | undefined): string | null {
  if (!site || trail.length < 2) return null;
  return toJsonLdScriptContent([breadcrumbList({ items: trail.map((t) => ({ name: t.name, url: `${site}${t.path}` })) })]);
}
