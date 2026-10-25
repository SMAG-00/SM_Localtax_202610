// 백오피스 역할별 메뉴 (ADM-01) — 메뉴 항목은 접근 판정 한 함수(lib/access.ts)의 허용 작업에서만 나온다.
// 편집국 외 역할(광고·스토어·브랜드·전문가 담당)에게는 기사 승인·정렬·발행 메뉴가 없고, 편집자에게는 상품·광고·전문가·브랜드 메뉴가 없다.
// 제휴사(/admin/partners)는 광고·협찬 담당과 관리자의 편집 메뉴다. 편집 책임자는 목록을 읽기만 하므로(partner.read) 메뉴에 두지 않고,
// 기사 편집기의 제휴사 고르기에서 목록 화면으로 간다 — 편집자 화면에 광고 편집 메뉴 0 (ADM-01 수용 기준).
import { allowedActions, type Action, type Viewer } from "@/lib/access";

export interface MenuItem {
  id: string;
  label: string;
  href: string;
}

interface MenuRule extends MenuItem {
  /** 이 메뉴를 보이는 조건 — 허용 작업 집합으로만 판단한다 */
  when: (actions: ReadonlySet<Action>) => boolean;
  /** 이 메뉴로 치는 화면 주소 앞부분 (지금 보는 메뉴 표시) */
  paths: readonly string[];
}

const RULES: readonly MenuRule[] = [
  { id: "dashboard", label: "첫 화면", href: "/admin", when: () => true, paths: [] },
  { id: "assignments", label: "기사 기획", href: "/admin/stories", when: (a) => a.has("assignment.read"), paths: ["/admin/stories"] },
  { id: "articles", label: "기사", href: "/admin/articles", when: (a) => a.has("article.read"), paths: ["/admin/articles"] },
  {
    id: "reviews",
    label: "검토·발행",
    href: "/admin/reviews",
    when: (a) => a.has("review.desk_edit") || a.has("review.tax_review"),
    paths: ["/admin/reviews"],
  },
  { id: "placement", label: "기사 배치", href: "/admin/placement", when: (a) => a.has("article.sort"), paths: ["/admin/placement"] },
  { id: "home", label: "홈 배치", href: "/admin/home", when: (a) => a.has("article.home"), paths: ["/admin/home"] },
  { id: "amendments", label: "개정 트래커", href: "/admin/amendments", when: (a) => a.has("amendment.record_event"), paths: ["/admin/amendments"] },
  { id: "links", label: "바깥 연결", href: "/admin/links", when: (a) => a.has("link.manage"), paths: ["/admin/links"] },
  { id: "calc-links", label: "계산기 연결", href: "/admin/calc-links", when: (a) => a.has("link.manage"), paths: ["/admin/calc-links"] },
  // 바로가기·캠페인 랜딩 (GROW-03·04 · PR-15 — W10-i) — 캠페인은 편집 책임자·광고 담당·관리자, 재테크 포인트는 기자·편집 책임자·관리자
  { id: "campaigns", label: "캠페인 랜딩", href: "/admin/campaigns", when: (a) => a.has("campaign.edit") || a.has("campaign.approve"), paths: ["/admin/campaigns"] },
  { id: "realestate-weekly", label: "이번 주 재테크 포인트", href: "/admin/realestate-weekly", when: (a) => a.has("weekly_point.edit") || a.has("weekly_point.publish"), paths: ["/admin/realestate-weekly"] },
  // 허브 지방세 포인트 (CORE-02 — W3 9단계) — 초안은 편집 책임자, 감수 서명은 세무 감수위원
  { id: "hub-points", label: "허브 지방세 포인트", href: "/admin/hub-points", when: (a) => a.has("hub_point.edit") || a.has("review.tax_review"), paths: ["/admin/hub-points"] },
  // 원문 검수 큐 (REG1-13 — W4 6단계) — 편집 책임자·관리자
  { id: "source-review", label: "원문 검수", href: "/admin/source-review", when: (a) => a.has("source_review.resolve"), paths: ["/admin/source-review"] },
  // 공통 검수 큐 (REV-01~03 — W10-c) — 편집 책임자·관리자. 수집 파이프라인 원천·실행 (PIPE — W10-c) — 관리자만
  { id: "review", label: "공통 검수", href: "/admin/review", when: (a) => a.has("review_item.decide"), paths: ["/admin/review"] },
  // 주간 브리핑 호 (BRIEF-01~04 — W10-e) — 편집 책임자·관리자
  { id: "brief", label: "브리핑", href: "/admin/brief", when: (a) => a.has("review_item.decide"), paths: ["/admin/brief"] },
  { id: "pipelines", label: "수집 파이프라인", href: "/admin/pipelines", when: (a) => a.has("pipeline.manage"), paths: ["/admin/pipelines"] },
  // 감수 가이드 (W11-a) — 가이드 작성·서명·공개
  { id: "guides", label: "감수 가이드", href: "/admin/guides", when: (a) => a.has("guide.edit") || a.has("guide.sign") || a.has("guide.publish"), paths: ["/admin/guides"] },
  // 기관 구독·계약·좌석·확인표·견적 요청 (BIZ-07·PAY-04 — W11-f) — 스토어·구독 담당·관리자 / 프리미엄 리포트 편집·발행 — 편집 책임자·관리자
  { id: "orgs", label: "기관 구독", href: "/admin/orgs", when: (a) => a.has("org.manage"), paths: ["/admin/orgs"] },
  { id: "reports", label: "프리미엄 리포트", href: "/admin/reports", when: (a) => a.has("report.publish"), paths: ["/admin/reports"] },
  // 룰셋·판정표·달력 (RULE-01~04 — W10-a) 세무 감수위원 서명·관리자 승인 / 정확도 대조 (CALC-14·FAM-07) — 세무 감수위원·관리자
  { id: "rulesets", label: "룰셋·판정표", href: "/admin/rulesets", when: (a) => a.has("ruleset.read"), paths: ["/admin/rulesets"] },
  { id: "accuracy", label: "정확도 대조", href: "/admin/accuracy", when: (a) => a.has("accuracy.manage"), paths: ["/admin/accuracy"] },
  // 지역 기사 판정판 — 별도 상품 검토 큐·편집 분야 승인 대기·보류 (REG1-14·17 — W4 8단계) — 편집 책임자·관리자
  { id: "regions", label: "지역 기사 판정", href: "/admin/regions", when: (a) => a.has("regional.judge"), paths: ["/admin/regions"] },
  // 프로젝트 트래커 — 프로젝트·단계 기록·정정·공개 전환·지역 연결 (PR-02·03 — W4 14단계) — 편집 책임자·관리자
  { id: "projects", label: "프로젝트", href: "/admin/projects", when: (a) => a.has("project.manage"), paths: ["/admin/projects"] },
  // 단계별 「지방세로 읽기」 감수 (PR-08 — W4 16단계) — 세무 감수위원의 서명 자리. 편집 책임자·관리자는 '프로젝트' 화면에서 같은 템플릿을 쓴다(메뉴 그대로)
  { id: "project-lenses", label: "단계 지방세로 읽기 감수", href: "/admin/projects/lenses", when: (a) => a.has("review.tax_review"), paths: ["/admin/projects/lenses"] },
  // 분양 정보 — 공식 공고를 보고 넣는 정보 목록(기사 아님 — PR-04 · W4 17단계) — 편집 책임자·관리자
  { id: "supply", label: "분양 정보", href: "/admin/supply", when: (a) => a.has("supply.manage"), paths: ["/admin/supply"] },
  // 개발방법 비교 — 7개 방법의 내용·비교 항목·숫자 요건 사실 행(편집 책임자·관리자)과 세무 감수 서명(세무 감수위원) (PR-09·10 · W4 19단계)
  { id: "dev-methods", label: "개발방법 비교", href: "/admin/dev-methods", when: (a) => a.has("dev_method.manage") || a.has("review.tax_review"), paths: ["/admin/dev-methods"] },
  // 개발금융 - 구조 해설 초안·법률 확인(편집 책임자·관리자)과 세무 감수 서명(세무 감수위원), 통계·규제·사례·칼럼 소속 (W5 DF-01~05·09)
  { id: "finance", label: "부동산금융", href: "/admin/finance", when: (a) => a.has("finance.manage") || a.has("review.tax_review"), paths: ["/admin/finance"] },
  // 지자체뉴스 - 금주 핫뉴스(후보 선정·유사도·발행)와 행사안내(회차·상태·연결) 입력 (W6 LG-01~14) - 편집 책임자·관리자
  { id: "local-news", label: "지자체뉴스", href: "/admin/local-news", when: (a) => a.has("local_news.manage"), paths: ["/admin/local-news"] },
  {
    id: "situations",
    label: "상황 카드",
    href: "/admin/situations",
    // 쓰는 사람(편집국·관리자)·공개하는 사람(편집 책임자)·감수 서명하는 사람(세무 감수위원) — 편집국 외 역할에게는 0
    when: (a) => a.has("situation.edit") || a.has("situation.publish") || a.has("review.tax_review"),
    paths: ["/admin/situations"],
  },
  { id: "categories", label: "분야", href: "/admin/categories", when: (a) => a.has("category.edit"), paths: ["/admin/categories"] },
  { id: "dictionaries", label: "사전", href: "/admin/dictionaries", when: (a) => a.has("dictionary.edit"), paths: ["/admin/dictionaries"] },
  // 검색어 집계 (SRCH-03) — 편집 책임자·관리자 (W2-d 설계 8.3)
  { id: "query-terms", label: "검색어", href: "/admin/query-terms", when: (a) => a.has("query_terms.read"), paths: ["/admin/query-terms"] },
  {
    id: "sponsored",
    label: "광고·협찬 콘텐츠",
    href: "/admin/articles?type=sponsored",
    when: (a) => a.has("sponsored.manage"),
    paths: ["/admin/articles"],
  },
  { id: "partners", label: "제휴사", href: "/admin/partners", when: (a) => a.has("sponsored.manage"), paths: ["/admin/partners"] },
  { id: "store", label: "스토어·구독", href: "/admin/store", when: (a) => a.has("product.manage"), paths: ["/admin/store"] },
  { id: "brand", label: "브랜드 관리", href: "/admin/brand", when: (a) => a.has("brand.manage"), paths: ["/admin/brand"] },
  { id: "experts", label: "전문가 등재", href: "/admin/experts", when: (a) => a.has("expert.manage"), paths: ["/admin/experts"] },
  // 측정 지표 대시보드 (GROW-01) — 관리자만 (W2-c 설계 9장)
  { id: "metrics", label: "측정 지표", href: "/admin/metrics", when: (a) => a.has("metrics.read"), paths: ["/admin/metrics"] },
  // 기사 생산·제휴 준비 대시보드·규정 버전 (NAV-13·14) — 편집 책임자·관리자 (PRD-01A 3장)
  { id: "readiness", label: "제휴 준비", href: "/admin/news-readiness", when: (a) => a.has("readiness.read"), paths: ["/admin/news-readiness"] },
  // 검색 최적화 (OPT-01·07·08·09) — 색인 전환 점검·신선도 검수·AI 검색 표본. 편집 책임자·관리자 (W7)
  { id: "seo", label: "검색 최적화", href: "/admin/seo", when: (a) => a.has("seo.read"), paths: ["/admin/seo"] },
  // 문의함 (ADM-03) — 종류별 열람 역할이 하나라도 있는 사람 (W2-e 7.3)
  { id: "inquiries", label: "문의함", href: "/admin/inquiries", when: (a) => a.has("inquiry.read"), paths: ["/admin/inquiries"] },
  { id: "pages", label: "정책 페이지", href: "/admin/pages", when: (a) => a.has("policy.edit"), paths: ["/admin/pages"] },
  { id: "settings", label: "설정", href: "/admin/settings", when: (a) => a.has("settings.edit"), paths: ["/admin/settings"] },
  { id: "members", label: "회원·역할", href: "/admin/members", when: (a) => a.has("member.read") && a.has("role.grant"), paths: ["/admin/members"] },
];

/** 기사 승인·정렬·발행·홈 배치 메뉴 — 편집국 외 역할에게 0 (ADM-01 수용 기준 · PRD-00 6장 홈 배치는 편집 책임자) */
export const APPROVE_SORT_PUBLISH_MENU_IDS = ["reviews", "placement", "home"] as const;
/** 상품·광고(제휴사 관리 포함)·전문가 등재·브랜드 관리 메뉴 — 편집자에게 0 (ADM-01 수용 기준) */
export const OPERATIONS_MENU_IDS = ["sponsored", "partners", "store", "brand", "experts"] as const;
/** 관리자 전용 메뉴 — 측정 지표(GROW-01) · 운영 설정 · 회원·역할 (ADM-02) */
export const ADMIN_MENU_IDS = ["metrics", "settings", "members"] as const;

/** 로그인한 사람의 메뉴 — 순서는 위 목록 순서 */
export function adminMenu(viewer: Viewer): MenuItem[] {
  const actions = new Set(allowedActions(viewer));
  return RULES.filter((r) => r.when(actions)).map(({ id, label, href }) => ({ id, label, href }));
}

/** 지금 보는 화면의 메뉴 id — 첫 화면은 /admin 정확히 일치, 나머지는 주소 앞부분이 가장 긴 것. 없으면 "" */
export function activeMenuId(menu: readonly MenuItem[], pathname: string): string {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/admin") return menu.some((m) => m.id === "dashboard") ? "dashboard" : "";
  let best = { id: "", length: 0 };
  for (const item of menu) {
    const rule = RULES.find((r) => r.id === item.id);
    for (const prefix of rule?.paths ?? []) {
      const hit = path === prefix || path.startsWith(`${prefix}/`);
      // 같은 길이면 앞 메뉴가 이긴다 — '기사'가 있으면 '기사', 없으면(광고 담당) '광고·협찬 콘텐츠'
      if (hit && prefix.length > best.length) best = { id: item.id, length: prefix.length };
    }
  }
  return best.id;
}
