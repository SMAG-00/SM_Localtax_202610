// 접근 판정 한 함수 (PRD-00 6장 · ACC-04 · ADM-01 · NAV-06 · NAV-12, docs/dev/W2-a_설계.md §5)
// 순수 함수다 — DB·네트워크·시계를 쓰지 않는다. 서버(lib/server/dal.ts)가 로그인 확인 뒤 이 함수로만 허용 여부를 정한다.
//  · 관리자(ADMIN_EMAILS)는 데이터·설정 전권(역할 부여, 분야·사전·설정 편집, 모든 기록 조회)이다.
//  · 편집 행위(편집 승인·발행·정렬·HOT·홈 배치·발행 뒤 수정·정정 결정)는 editor 역할이 있어야 한다 — 관리자도 같다 (PO 결정 2026-10-17).
//  · 작성 기자와 편집 승인자는 다른 사람이어야 한다 (NAV-12 — DB 트리거도 막는다).
//  · 세무 감수 서명은 reviewer만 한다 (기사와 상황 카드의 '먼저 확인할 것' 모두 — review.tax_review).
//  · 상황 카드(UX-05)는 기자·편집 책임자·관리자가 쓰고, 공개·허브 배치는 편집 책임자만 한다 (PRD-00 6장 'CMS 작성·상황 카드' 행 · 발행 승인·홈 배치는 editor).
//  · 편집국 외 역할(ad_ops·store_ops·brand_ops·expert_ops)은 기사 작성·승인·정렬 권한이 없다. ad_ops는 sponsored 콘텐츠만 등록한다.

/** staff_roles.role 7종 (W2-a 설계 §2) */
export const STAFF_ROLES = ["reporter", "editor", "reviewer", "ad_ops", "store_ops", "brand_ops", "expert_ops"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** 편집국 — 기자 · 편집 책임자 · 세무 감수위원 */
export const NEWSROOM_ROLES: readonly StaffRole[] = ["reporter", "editor", "reviewer"];
/** 편집국 외 역할 — 기사 승인·정렬 권한 0 (PRD-00 6장 운영 역할 분리) */
export const NON_NEWSROOM_ROLES: readonly StaffRole[] = ["ad_ops", "store_ops", "brand_ops", "expert_ops"];

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
}

/** 로그인한 사람 — 역할은 staff_roles에서만, 관리자는 ADMIN_EMAILS에서만 읽는다 (가입 메타데이터를 믿지 않는다, ACC-04) */
export interface Viewer {
  userId: string;
  email: string | null;
  isAdmin: boolean;
  roles: readonly StaffRole[];
  /** 감사 기록 관리자(PO) — AUDIT_ADMIN_EMAILS에 있고 이메일 확인된 계정. 관리자 목록에 있어도 여기 없으면 감사 기록을 고치거나 지울 수 없다 (W2-e 10.1) */
  isAuditAdmin?: boolean;
}

/** 작업 목록 — 값은 PRD-00 6장 표의 행 이름 */
export const ACTIONS = {
  "article.read": "기사·취재 기록 열람",
  "article.create": "기사 기획·원고 작성",
  "article.edit": "원고 수정·취재 증거 입력 (발행 뒤 수정은 편집 책임자)",
  "article.submit": "검토 요청",
  "article.tax_lens_skip": "「지방세로 읽기」 생략 사유 승인",
  "review.desk_edit": "기사 발행 승인 — 취재·편집 승인 (작성자와 다른 사람)",
  "review.tax_review": "세무 감수 서명",
  "review.sponsor_check": "광고·협찬 표기 확인",
  "article.publish": "기사 발행",
  "article.sort": "기사 정렬·뉴스 전송 후보 선정",
  "article.hot": "HOT 고정",
  "article.home": "홈 배치",
  "correction.request": "정정·반론·추후보도 요청 작성",
  "correction.decide": "정정·반론·추후보도·삭제·제목 변경 결정",
  "assignment.read": "기사 기획 캘린더 열람",
  "assignment.create": "기사 기획 등록",
  "assignment.update": "기사 기획 수정·상태 변경",
  "situation.edit": "상황 카드 작성·수정 (먼저 확인할 것·체크리스트·연결 칸)",
  "situation.publish": "상황 카드 공개·내리기·허브 배치·허브 순서",
  "category.edit": "분야 편집",
  "dictionary.edit": "금지 표현·공포 표현·용어 사전 편집",
  "settings.edit": "운영 설정 편집",
  "partner.read": "제휴사 목록 열람",
  "member.read": "회원·편집국 계정 조회",
  "member.suspend": "계정 정지·정지 해제",
  "member.delete": "회원 계정 삭제",
  "role.grant": "서비스 역할 부여",
  "role.revoke": "서비스 역할 회수",
  "audit.read": "감사 기록 조회",
  "sponsored.manage": "광고·협찬·제휴 콘텐츠 등록·광고 상품 운영",
  "product.manage": "스토어 상품·주문 경로·구독 운영",
  "product.approve": "자사 상품 카드 연결 승인·철회 (편집 책임자·관리자 — 상품 담당은 제안까지, BIZ-03)",
  "brand.manage": "인물 페이지·표준 약력·증빙·동의 기록",
  "brand.approve": "브랜드 공개 승인 — 증빙 승인·동의서 기록/철회·경력 표시 승인·광고 규정 감수 기록·brand_copy 켜기 (관리자·PO만, W3 설계 6장)",
  "expert.manage": "전문가 등재·연락 요청 처리",
  "metrics.read": "측정 지표 대시보드 열람 (GROW-01 · 지역 탭 REG1-15)",
  "region_cost.edit": "지역 편집비 입력·변경 (REG1-15 — 관리자(운영 책임자)만, W4 설계 6장)",
  "readiness.read": "기사 생산·제휴 준비 대시보드 열람 (NAV-13·14)",
  "readiness.requirements": "제휴 규정 버전 등록·고치기·확정 (NAV-13)",
  "query_terms.read": "검색어 집계 열람 (SRCH-03 — 편집 기획 참고)",
  "seo.read": "검색 최적화 화면 열람 — 색인 전환 점검·신선도 검수·AI 검색 표본 (OPT-01·07·08·09)",
  "seo.write": "신선도 검수 처리·핵심 질문 50개 등록·AI 검색 표본 입력 (OPT-07·09)",
  "readiness.records": "제휴 규정 판단 값·부정평가 위험 기록·월 지표 재계산·경고 확인 (NAV-16~20)",
  "policy.edit": "정책 문서 초안 편집 (문서별 고치는 사람 — lib/policy/docs.ts)",
  "policy.publish": "정책 문서 게시 승인 (법률 검토 승인 기록 필수)",
  "inquiry.read": "문의 열람 (문의 종류별 역할 — INQUIRY_READERS)",
  "inquiry.update": "문의 상태·담당자·메모 변경",
  "inquiry.contact_view": "문의 연락처 보기 (누를 때마다 감사 로그)",
  "audit.amend": "감사 기록 수정·삭제 — 감사 기록 관리자(PO)만",
  "amendment.record_event": "개정 트래커 — 개정안 만들기·단계 기록·기사 연결 (편집 책임자)",
  "amendment.correct_event": "개정 트래커 — 단계 기록 정정 (편집 책임자, 사유 필수)",
  "legal_doc.manage": "해석 원문·해설 — 원문 입력, 기사 연결, 해설 지정, 변경 검수 (편집 책임자)",
  "column.manage": "칼럼 필자 체계 — 필자 검증·기고 계약·이해관계 기록 (편집 책임자)",
  "column.signature": "시그니처 연재 — 회차 지정·순서·「그때와 지금」 비교 항목·연재 제목·발행 주기 (편집 책임자 — 칼럼 정렬과 같은 편집 행위, BR-08)",
  "link.manage": "바깥 연결 — 주소·이용 조건 편집, 수동 점검 기록 (편집 책임자)",
  "hub_point.edit": "허브 지방세 포인트 — 초안(문구 1~3줄·기준일·해설 링크) 저장·지우기 (편집 책임자 — 감수 서명은 review.tax_review)",
  "source_review.resolve": "원문 검수 큐 — 공식 자료 원문 다시 받기·검수 항목 해결(확인일 다시 적기 포함) (편집 책임자·관리자, W4 6단계 REG1-13)",
  "regional.judge": "지역 기사 편집자 판정 — 기사 후보·여행 후기·맛집 추천·행사 홍보 (편집 책임자, 1인 체제면 관리자·PO — W4 7단계 REG1-17 · 12장 #7)",
  "article.regional_fields": "지역 기사 편집 칸 — 편집 분야·공익적 질문·소재·관계 유형·다룬 제휴사·이해관계 표시 (기자·편집 책임자·관리자 — 편집국 외 역할 403 + 감사, W4 7단계)",
  "regional_link.confirm": "지역 연결 — 같은 지역 후보 찾기·연결 만들기·확인·지우기 (편집 책임자·관리자, W4 13단계 REG1-10 — 확인된 연결만 공개)",
  "project.manage": "프로젝트 트래커 — 프로젝트 만들기·단계 기록·정정(사유)·공개 전환·지역 연결 (편집 책임자·관리자, W4 14단계 PR-02·03 — 가격·분담금·수익률 입력 0)",
  "finance.manage": "개발금융 - 구조 해설 초안·법률 확인·통계 지표·규제 항목·사례 구조 기록·칼럼 소속 항목 입력 (편집 책임자·관리자, W5 DF-01~05·09 - 세무 서명은 review.tax_review, 법률 검토 기록은 설정 권한)",
  "local_news.manage": "지자체뉴스 - 금주 핫뉴스(후보 넣기·선정·요약·유사도 검사·발행·기획 전환)와 행사안내(회차·상태·연결·공개) 입력 (편집 책임자·관리자, W6 LG-01~14 - 광고·협찬 담당은 행사 정렬·분류 권한 없음)",
  "supply.manage": "분양 정보 — 공식 공고를 보고 항목 만들기·고치기·공개 전환 (편집 책임자·관리자, W4 17단계 PR-04 — 가격 입력 0, 홍보 원고는 sponsored 기사로만)",
  "dev_method.manage": "개발방법 비교 — 방법 내용·비교 항목 6칸 초안·숫자 요건 사실 행(새 판 + 사유) 적기 (편집 책임자·관리자, W4 18단계 PR-09·10 — 감수 서명은 review.tax_review, 점수·순위·추천 입력 0)",
  "ruleset.read": "룰셋·판정표·달력·정확도 대조 화면 열람 (W10-a - 세무 감수위원·관리자)",
  "ruleset.sign": "룰셋·판정표·달력 감수 서명 (세무 감수위원만 - 관리자도 못 함, RULE-04)",
  "ruleset.approve": "룰셋·판정표·달력 활성화 승인 - approve_*() RPC 호출 (관리자만, 서명 뒤 - RULE-02)",
  "accuracy.manage": "공식 결과 대조 사례 입력·정확도 실행 요청 (W10-a CALC-14 - 세무 감수위원·관리자)",
  "review_item.decide": "공통 검수 큐 처리 - 승인·반려·보류 (W10-c REV-01 - 편집 책임자·관리자)",
  "pipeline.manage": "수집 원천 등록부·이용 조건 상태·수집 실패 처리 (W10-c PIPE - 관리자만)",
  "brief.manage": "브리핑 호 편집·발행·구독자 관리 화면 (W10-e BRIEF - 편집 책임자·관리자)",
  "billing.manage": "디지털 구독 상품 구성·요금표·주문 조회 (W10-f - 스토어·구독 담당·관리자)",
  "billing.readiness": "실결제 개시 기록 commerce_readiness - PG 계약·통신판매업 신고 (W10-f - 관리자만)",
  // W11 0차 - 3단계 공통 권한 (3단계 설계 3장). 서명은 세무 감수위원만, 공개·승인은 관리자 (역할은 늘리지 않음)
  "guide.sign": "가이드 버전 감수 서명 (W11-a - 세무 감수위원만, 관리자도 못 함)",
  "guide.publish": "가이드 초안 만들기·서명된 버전 공개 - 가이드 RPC 호출 (W11-a - 관리자만, 서명 뒤)",
  "issue_graph.edit": "쟁점 태그 제안·쟁점 지도 초안 편집 (W11-d - 편집 책임자·관리자)",
  "issue_graph.sign": "쟁점 지도 버전 감수 서명 (W11-d - 세무 감수위원만)",
  "issue_tag.approve": "쟁점 태그 사전·결정례 태그 승인 (W11-d - 편집 책임자·관리자)",
  "ordinance.manage": "자치법규 연결·확인일 갱신 (W11-e - 편집 책임자·관리자)",
  "ordinance_summary.sign": "조례 편집 요약 감수 서명 (W11-e - 세무 감수위원만)",
  "org.manage": "기관·계약·좌석 운영 (W11-f - 스토어·구독 담당·관리자)",
  "org_security.approve": "기관 보안·개인정보 확인표 승인 - 승인 전 좌석 개통 0 (W11-f - 관리자만)",
  "report.publish": "프리미엄 리포트 발행 (W11-f - 편집 책임자·관리자, 세무 감수 + 편집 승인 뒤)",
  "special_law.confirm": "특례법 확인 기록 — 공포 확인·철회와 특례법 근거 행의 확인·철회 (관리자(PO)만, W4 20단계 PR-13)",
} as const;
export type Action = keyof typeof ACTIONS;
export const ACTION_LIST = Object.keys(ACTIONS) as Action[];

/** 거부되면 감사 로그에 남기는 작업 — 기사 승인·정렬·발행 (NAV-06 · ACC-04)과 역할 부여·계정 정지·운영 설정 (ADM-02)·제휴 규정 버전 (NAV-13) */
export const AUDITED_DENIALS: ReadonlySet<Action> = new Set<Action>([
  "review.desk_edit",
  "review.tax_review",
  "review.sponsor_check",
  "article.publish",
  "article.sort",
  "article.hot",
  "article.home",
  "correction.decide",
  "role.grant",
  "role.revoke",
  "member.suspend",
  "member.delete",
  "settings.edit",
  "situation.publish",
  "readiness.requirements",
  "readiness.records",
  "seo.write",
  "policy.publish",
  "inquiry.update",
  "inquiry.contact_view",
  "audit.amend",
  "brand.approve",
  // W3 8단계 — 칼럼 필자 체계·시그니처 연재(회차·순서) 편집 행위. 편집국 외 역할(brand_ops 등)의 시도는 거부 + 감사 (BR-08)
  "column.manage",
  "column.signature",
  // W3 9단계 — 허브 지방세 포인트 초안(홈·허브 공개 문구). 편집국 외 역할의 시도는 거부 + 감사
  "hub_point.edit",
  // W4 6단계 — 원문 검수 큐(다시 받기·해결). 공개 기사의 '검토 중' 표시를 바꾸는 일이라 거부도 감사 (REG1-13)
  "source_review.resolve",
  // W4 7단계 — 지역 기사 편집자 판정·편집 분야 칸. 광고·협찬 담당 등 편집국 외 역할의 시도는 거부 + 감사 (REG1-17 · PRD_최종 §9.1)
  "regional.judge",
  "article.regional_fields",
  // W4 13단계 — 지역 연결 확인(공개 화면의 연결 링크를 바꾸는 편집 행위). 편집국 외 역할의 시도는 거부 + 감사 (REG1-10)
  "regional_link.confirm",
  // W4 14단계 — 프로젝트 트래커 입력·공개 전환. 광고·협찬·브랜드 담당 등 편집국 외 역할의 시도는 거부 + 감사 (W4 설계 2.5 '거부 감사 대상' · 6장)
  "project.manage",
  // W4 17단계 — 분양 정보 입력·공개 전환. 광고·협찬·브랜드 담당 등 편집국 외 역할의 시도는 거부 + 감사 (W4 설계 2.5 'brand_ops의 분양 승인' · 6장)
  "supply.manage",
  // W5 - 개발금융 입력. 편집국 외 역할의 시도는 거부 + 감사
  "finance.manage",
  // W6 - 지자체뉴스 입력. 광고·협찬 담당 등 편집국 외 역할의 시도(행사 정렬·분류 포함)는 거부 + 감사 (LG-13)
  "local_news.manage",
  // W4 18단계 — 개발방법 내용·비교 항목·숫자 요건 입력. 편집국 외 역할의 시도는 거부 + 감사 (W4 설계 6장 '개발방법 입력: 편집 책임자 이상')
  "dev_method.manage",
  // W4 20단계 — 특례법 확인 기록은 관리자(PO)만. 그 밖의 역할의 시도는 거부 + 감사 (W4 설계 6장)
  "special_law.confirm",
  // W8 - 자사 상품 카드 승인·철회. 상품 담당(store_ops) 등 편집 책임자 밖의 시도는 거부 + 감사 (BIZ-03: 상품 담당은 승인 권한 없음)
  "product.approve",
  // W10 0차 - 감수 서명·활성화 승인·실결제 개시 기록은 허용 밖 시도를 감사에 남긴다 (RULE-02·03, PAY-07)
  "ruleset.sign",
  "ruleset.approve",
  "billing.readiness",
  // W11 0차 - 가이드·쟁점 지도·조례 요약 서명은 감수위원만, 가이드 공개·보안 확인표 승인·리포트 발행은 허용 밖 시도를 감사에 남긴다
  "guide.sign",
  "guide.publish",
  "issue_graph.sign",
  "ordinance_summary.sign",
  "org_security.approve",
  "report.publish",
]);

/** 판정 대상 기사 — 서버가 DB에서 읽어 채운다 */
export interface ArticleResource {
  kind: "article";
  /** 작성 기자의 계정 (people.staff_user_id). 모르면 null */
  authorUserId: string | null;
  contentType: string | null;
  /** 한 번이라도 발행됨 (first_published_at 있음) — 발행 뒤 수정은 편집 행위다 */
  published: boolean;
}

/** 문의 종류 7개 (inquiries.kind — DB check와 같은 값) */
export const INQUIRY_KINDS = ["tip", "subscription", "advertising", "reader_submission", "correction", "product", "assistant_report"] as const;
export type InquiryKind = (typeof INQUIRY_KINDS)[number];

/** 종류별 열람 역할 (W2-e 7.3) — 관리자는 전 종류 */
export const INQUIRY_READERS: Readonly<Record<InquiryKind, readonly StaffRole[]>> = {
  tip: ["reporter", "editor"],
  reader_submission: ["reporter", "editor"],
  correction: ["editor"],
  assistant_report: ["editor"],
  advertising: ["ad_ops"],
  subscription: ["store_ops"],
  product: ["store_ops"],
};

export interface InquiryResource {
  kind: "inquiry";
  inquiryKind: InquiryKind;
}

export type Resource = ArticleResource | InquiryResource;

/** 이 사람이 열람할 수 있는 문의 종류 */
export function readableInquiryKinds(viewer: Viewer): InquiryKind[] {
  return INQUIRY_KINDS.filter((k) => viewer.isAdmin || INQUIRY_READERS[k].some((r) => viewer.roles.includes(r)));
}

export type Decision = { allowed: true } | { allowed: false; reason: string };

const ALLOW: Decision = { allowed: true };
const deny = (reason: string): Decision => ({ allowed: false, reason });

const has = (viewer: Viewer, ...roles: StaffRole[]) => roles.some((r) => viewer.roles.includes(r));

const EDITOR_ONLY = "편집 책임자(editor) 역할이 있어야 합니다 — 편집 신뢰 규칙은 관리자에게도 같습니다";
const NEWSROOM_WRITER = "기사 작성·수정은 기자(reporter)·편집 책임자(editor)만 합니다 — 편집국 외 역할은 기사 작성 권한이 없습니다";
const SPONSORED_WRITER = "광고·협찬 콘텐츠(sponsored)는 광고·협찬 담당(ad_ops)만 등록합니다 — 편집 책임자는 표기 확인만 합니다";
const ADMIN_ONLY = "관리자만 할 수 있습니다";

function editorOnly(viewer: Viewer): Decision {
  return has(viewer, "editor") ? ALLOW : deny(EDITOR_ONLY);
}

/** 기사 작성·수정·검토 요청 — 유형(sponsored 여부)과 발행 여부에 따라 다르다 */
function writeArticle(viewer: Viewer, resource: ArticleResource | undefined, action: "article.create" | "article.edit" | "article.submit"): Decision {
  if (!resource) {
    // 어떤 기사든 쓸 수 있는 사람인가 — 기사별 판정은 대상과 함께 다시 한다
    return has(viewer, "reporter", "editor", "ad_ops") || viewer.isAdmin ? ALLOW : deny(NEWSROOM_WRITER);
  }
  if (resource.published && action !== "article.create") {
    return has(viewer, "editor") ? ALLOW : deny(`발행된 기사의 수정은 ${EDITOR_ONLY}`);
  }
  if (resource.contentType === "sponsored") {
    return has(viewer, "ad_ops") || viewer.isAdmin ? ALLOW : deny(SPONSORED_WRITER);
  }
  return has(viewer, "reporter", "editor") || viewer.isAdmin ? ALLOW : deny(NEWSROOM_WRITER);
}

/**
 * 접근 판정 한 함수 — 허용이면 { allowed: true }, 거부면 사유(편집자에게 보일 한국어 문장).
 * resource를 주면 기사별 조건(작성자 본인 승인 금지·sponsored·발행 뒤 수정)까지 본다.
 */
export function check(viewer: Viewer, action: Action, anyResource?: Resource): Decision {
  const resource = anyResource?.kind === "article" ? anyResource : undefined;
  switch (action) {
    case "inquiry.read":
    case "inquiry.update":
    case "inquiry.contact_view": {
      const kinds = anyResource?.kind === "inquiry" ? [anyResource.inquiryKind] : readableInquiryKinds(viewer);
      const ok = anyResource?.kind === "inquiry" ? readableInquiryKinds(viewer).includes(anyResource.inquiryKind) : kinds.length > 0;
      return ok ? ALLOW : deny("이 종류의 문의는 담당 역할(기사 제보·독자 투고=기자·편집 책임자 / 정정·반론=편집 책임자 / 광고=광고·협찬 담당 / 구독·상품=스토어·구독 담당)과 관리자만 봅니다");
    }
    case "audit.amend":
      return viewer.isAuditAdmin === true ? ALLOW : deny("감사 기록은 감사 기록 관리자(PO)만 고치거나 지울 수 있습니다 — 관리자도 할 수 없습니다");

    case "article.read":
      if (has(viewer, ...NEWSROOM_ROLES) || viewer.isAdmin) return ALLOW;
      if (has(viewer, "ad_ops") && resource?.contentType === "sponsored") return ALLOW;
      return deny("편집국 기록은 편집국(기자·편집 책임자·세무 감수위원)과 관리자만 봅니다");

    case "article.create":
    case "article.edit":
    case "article.submit":
      return writeArticle(viewer, resource, action);

    case "review.desk_edit": {
      if (!has(viewer, "editor")) return deny(`편집 승인은 ${EDITOR_ONLY}`);
      if (resource && resource.authorUserId !== null && resource.authorUserId === viewer.userId) {
        return deny("작성 기자 본인은 자기 기사를 편집 승인할 수 없습니다 — 다른 편집자가 승인해야 합니다 (NAV-12)");
      }
      return ALLOW;
    }

    case "review.tax_review":
      return has(viewer, "reviewer") ? ALLOW : deny("세무 감수 서명은 세무 감수위원(reviewer)만 할 수 있습니다");

    // 발행 — 편집 책임자만. 칼럼(opinion)은 필자 본인이 자기 칼럼을 발행하지 못한다 (BR-08 — DB 트리거도 발행 기록으로 막는다)
    case "article.publish": {
      if (!has(viewer, "editor")) return deny(EDITOR_ONLY);
      if (resource && resource.contentType === "opinion" && resource.authorUserId !== null && resource.authorUserId === viewer.userId) {
        return deny("칼럼 필자 본인은 자기 칼럼을 발행할 수 없습니다 — 다른 편집 책임자가 발행합니다 (BR-08)");
      }
      return ALLOW;
    }

    case "article.tax_lens_skip":
    case "review.sponsor_check":
    case "article.sort":
    case "article.hot":
    case "article.home":
    case "amendment.record_event":
    case "amendment.correct_event":
    case "link.manage":
    case "hub_point.edit":
    case "legal_doc.manage":
    case "column.manage":
    case "column.signature":
    case "correction.decide":
      return editorOnly(viewer);

    // 원문 검수 큐 (W4 6단계) — 편집 책임자·관리자 (W4 설계 6장 '편집 책임자 이상')
    case "source_review.resolve":
      return has(viewer, "editor") || viewer.isAdmin ? ALLOW : deny("원문 검수(다시 받기·해결)는 편집 책임자와 관리자만 합니다 (REG1-13)");

    // 지역 기사 편집자 판정 (W4 7단계 · 12장 #7 권고안) — 편집 책임자, 1인 체제면 관리자(PO)
    case "regional.judge":
      return has(viewer, "editor") || viewer.isAdmin ? ALLOW : deny("지역 기사 판정은 편집 책임자(editor)와 관리자(PO)만 합니다 — 광고·협찬 등 편집국 외 역할은 판정을 바꿀 수 없습니다 (REG1-17)");
    // 지역 연결 (W4 13단계 — REG1-10 '편집자가 확인한 연결만 공개') — 편집 책임자·관리자
    case "regional_link.confirm":
      return has(viewer, "editor") || viewer.isAdmin ? ALLOW : deny("지역 연결(후보 찾기·만들기·확인·지우기)은 편집 책임자와 관리자만 합니다 (REG1-10)");
    // 프로젝트 트래커 (W4 14단계 — 6장 '프로젝트 입력: 편집 책임자 이상 · 공개 전환: 편집 책임자', 1인 체제면 관리자·PO — 12장 #7과 같다)
    case "project.manage":
      return has(viewer, "editor") || viewer.isAdmin ? ALLOW : deny("프로젝트 트래커(만들기·단계 기록·정정·공개 전환·지역 연결)는 편집 책임자와 관리자만 합니다 (PR-02)");
    // 분양 정보 (W4 17단계 — 6장 '분양 입력: 편집 책임자 이상 · 공개 전환: 편집 책임자', 1인 체제면 관리자·PO). 광고·협찬 담당은 정보 목록을 쓰지 않는다 — 홍보 원고는 sponsored 기사로만(PR-04)
    // 개발금융 (W5 - 편집 책임자 이상, 1인 체제면 관리자·PO). 세무 서명은 review.tax_review(감수위원만)
    case "finance.manage":
      return has(viewer, "editor") || viewer.isAdmin ? ALLOW : deny("개발금융(구조 해설·통계·규제·사례 구조·칼럼 소속)은 편집 책임자와 관리자만 적습니다 - 세무 감수위원은 서명만 합니다 (DF-01~05)");
    // 지자체뉴스 (W6 - 편집 책임자 이상, 1인 체제면 관리자·PO). 광고·협찬 담당은 행사 정렬·편집 분야 판정 권한이 없다 (LG-13)
    case "local_news.manage":
      return has(viewer, "editor") || viewer.isAdmin ? ALLOW : deny("지자체뉴스(금주 핫뉴스·행사안내)는 편집 책임자와 관리자만 다룹니다 (LG-13)");
    case "supply.manage":
      return has(viewer, "editor") || viewer.isAdmin ? ALLOW : deny("분양 정보(만들기·고치기·공개 전환)는 편집 책임자와 관리자만 합니다 — 시행사·분양대행사 홍보 원고는 광고·협찬 기사로만 냅니다 (PR-04)");
    // 개발방법 비교 (W4 18단계 — 6장 '개발방법 입력: 편집 책임자 이상', 1인 체제면 관리자·PO). 서명은 review.tax_review(감수위원만) — 이 권한으로는 서명하지 않는다
    case "dev_method.manage":
      return has(viewer, "editor") || viewer.isAdmin ? ALLOW : deny("개발방법 비교(방법 내용·비교 항목·숫자 요건 사실 행)는 편집 책임자와 관리자만 적습니다 — 세무 감수위원은 감수 서명만 합니다 (PR-09·PR-10)");
    // 특례법 확인 기록 (W4 20단계 — 6장 '특례법 확인 기록: 관리자(PO)만')
    case "special_law.confirm":
      return viewer.isAdmin ? ALLOW : deny("특례법 확인 기록(공포 확인·철회, 행 확인)은 관리자(PO)만 남깁니다 (PR-13)");
    // 지역 기사 편집 칸 (편집 분야·공익적 질문·소재·관계 유형·다룬 제휴사·이해관계 표시) — 기자·편집 책임자·관리자
    case "article.regional_fields":
      return has(viewer, "reporter", "editor") || viewer.isAdmin
        ? ALLOW
        : deny("지역 기사의 편집 분야·공익적 질문·소재·관계 유형·이해관계 표시는 기자·편집 책임자·관리자만 적습니다 — 광고·협찬 등 편집국 외 역할은 바꿀 수 없습니다 (REG1-17)");

    case "correction.request":
      return has(viewer, "reporter", "editor") ? ALLOW : deny("정정·반론 요청은 기자·편집 책임자가 작성합니다");

    case "assignment.read":
    case "assignment.create":
    case "assignment.update":
      return has(viewer, "reporter", "editor") || viewer.isAdmin ? ALLOW : deny("기사 기획은 기자·편집 책임자가 다룹니다");

    case "situation.edit":
      return has(viewer, "reporter", "editor") || viewer.isAdmin ? ALLOW : deny("상황 카드는 기자·편집 책임자·관리자가 씁니다 — 세무 감수위원은 감수 서명만 합니다");

    case "situation.publish":
      return has(viewer, "editor") ? ALLOW : deny(`상황 카드 공개·허브 배치는 ${EDITOR_ONLY}`);

    case "category.edit":
    case "dictionary.edit":
      return has(viewer, "editor") || viewer.isAdmin ? ALLOW : deny("분야·사전 편집은 편집 책임자와 관리자만 합니다");

    case "settings.edit":
    case "role.grant":
    case "role.revoke":
    case "audit.read":
    case "member.read":
    case "member.suspend":
    case "member.delete":
    // 측정 지표 대시보드(/admin/metrics) — PRD-00 6장 표에 행이 없어 관리자 전권만(같은 표의 수익 대시보드도 관리자만).
    // 집계 숫자를 읽는 일이라 거부는 감사 대상(AUDITED_DENIALS)이 아니다 (W2-c 설계 9장)
    case "metrics.read":
    case "region_cost.edit":
      return viewer.isAdmin ? ALLOW : deny(ADMIN_ONLY);

    // 기사 생산·제휴 준비 대시보드와 규정 버전 (NAV-13·14) — PRD-01A 3장 화면 '편집 책임자·관리자만'.
    // 규정 버전의 '담당자 승인'도 같은 사람들이 한다 — 작성자와 다른 사람일 필요는 PRD에 없다 (W2-c 설계 9장)
    case "readiness.read":
      return has(viewer, "editor") || viewer.isAdmin ? ALLOW : deny("기사 생산·제휴 준비 화면은 편집 책임자와 관리자만 봅니다 (PRD-01A 3장)");
    case "readiness.requirements":
      return has(viewer, "editor") || viewer.isAdmin ? ALLOW : deny("제휴 규정 버전은 편집 책임자와 관리자만 적고 확정합니다 (NAV-13)");

    // 검색어 집계 (SRCH-03 — 편집 기획 참고·많이 찾은 검색어 옆 동의어 더하기). PRD-00 6장 표에 행이 없어 동의어 사전을 고치는 사람(dictionary.edit)과
    // 같게 편집 책임자·관리자만. 가린 값·정규형 합계만 읽는 일이라 거부는 감사 대상이 아니다 (W2-d 설계 8.3 · 12장)
    case "query_terms.read":
      return has(viewer, "editor") || viewer.isAdmin ? ALLOW : deny("검색어 집계는 편집 책임자와 관리자만 봅니다");

    // 검색 최적화(W7 — OPT-01·07·08·09)·제휴 준비 기록(NAV-16~20) — 편집 책임자·관리자. 크롤러 정책·기능 키 같은 설정 변경은 기존 설정 화면(관리자)이 한다
    case "seo.read":
      return has(viewer, "editor") || viewer.isAdmin ? ALLOW : deny("검색 최적화 화면은 편집 책임자와 관리자만 봅니다");
    case "seo.write":
      return has(viewer, "editor") || viewer.isAdmin ? ALLOW : deny("신선도 검수·AI 검색 표본은 편집 책임자와 관리자만 처리합니다");
    case "readiness.records":
      return has(viewer, "editor") || viewer.isAdmin ? ALLOW : deny("제휴 규정 판단 값·부정평가 기록은 편집 책임자와 관리자만 적습니다 (NAV-13·20)");

    // 정책 문서 — 편집은 편집 책임자·광고·협찬 담당·관리자(문서별 세부는 canEditPolicy), 게시 승인은 관리자만 (W2-e 10.1)
    case "policy.edit":
      return viewer.isAdmin || has(viewer, "editor", "ad_ops") ? ALLOW : deny("정책 문서는 편집 책임자·광고·협찬 담당·관리자가 고칩니다");
    case "policy.publish":
      return viewer.isAdmin ? ALLOW : deny(ADMIN_ONLY);

    case "partner.read":
      // 편집 책임자는 공동 기획 표기 확인을 위해 읽기만 한다 — 등록·수정은 sponsored.manage
      return has(viewer, "editor", "ad_ops") || viewer.isAdmin ? ALLOW : deny("제휴사 목록은 편집 책임자·광고·협찬 담당·관리자만 봅니다");

    case "sponsored.manage":
      return has(viewer, "ad_ops") || viewer.isAdmin ? ALLOW : deny("광고·협찬 담당(ad_ops)과 관리자만 합니다");
    case "product.manage":
      return has(viewer, "store_ops") || viewer.isAdmin ? ALLOW : deny("스토어·구독 담당(store_ops)과 관리자만 합니다");
    // W10 0차 - 2단계 공통 권한 (2단계 설계 2.3)
    case "ruleset.read":
      return has(viewer, "reviewer") || viewer.isAdmin ? ALLOW : deny("룰셋·판정표·정확도 대조 화면은 세무 감수위원과 관리자만 봅니다");
    case "ruleset.sign":
      return has(viewer, "reviewer") ? ALLOW : deny("룰셋·판정표·달력의 감수 서명은 세무 감수위원(reviewer)만 할 수 있습니다 (RULE-04)");
    case "ruleset.approve":
      return viewer.isAdmin ? ALLOW : deny("룰셋·판정표·달력의 활성화 승인은 관리자만 합니다 (RULE-02)");
    case "accuracy.manage":
      return has(viewer, "reviewer") || viewer.isAdmin ? ALLOW : deny("대조 사례 입력·정확도 실행은 세무 감수위원과 관리자만 합니다 (CALC-14)");
    case "review_item.decide":
      return has(viewer, "editor") || viewer.isAdmin ? ALLOW : deny("공통 검수 큐의 처리는 편집 책임자와 관리자만 합니다 (REV-01)");
    case "pipeline.manage":
      return viewer.isAdmin ? ALLOW : deny("수집 원천 등록부와 이용 조건 상태는 관리자만 고칩니다 (PIPE)");
    case "brief.manage":
      return has(viewer, "editor") || viewer.isAdmin ? ALLOW : deny("브리핑 호 편집·발행은 편집 책임자와 관리자만 합니다 (BRIEF)");
    case "billing.manage":
      return has(viewer, "store_ops") || viewer.isAdmin ? ALLOW : deny("결제 상품 구성·주문 조회는 스토어·구독 담당과 관리자만 합니다 (PAY)");
    case "billing.readiness":
      return viewer.isAdmin ? ALLOW : deny("실결제 개시 기록(PG 계약·통신판매업 신고)은 관리자만 남깁니다 (PAY-07)");
    // W11 0차 - 3단계 공통 권한 (3단계 설계 3장)
    case "guide.sign":
      return has(viewer, "reviewer") ? ALLOW : deny("가이드의 감수 서명은 세무 감수위원(reviewer)만 할 수 있습니다");
    case "guide.publish":
      return viewer.isAdmin ? ALLOW : deny("가이드 초안 만들기와 공개는 관리자만 합니다 (서명 뒤)");
    case "issue_graph.edit":
      return has(viewer, "editor") || viewer.isAdmin ? ALLOW : deny("쟁점 태그·지도 편집은 편집 책임자와 관리자만 합니다 (LINK)");
    case "issue_graph.sign":
      return has(viewer, "reviewer") ? ALLOW : deny("쟁점 지도의 감수 서명은 세무 감수위원(reviewer)만 할 수 있습니다");
    case "issue_tag.approve":
      return has(viewer, "editor") || viewer.isAdmin ? ALLOW : deny("쟁점 태그 승인은 편집 책임자와 관리자만 합니다");
    case "ordinance.manage":
      return has(viewer, "editor") || viewer.isAdmin ? ALLOW : deny("자치법규 연결·확인일 갱신은 편집 책임자와 관리자만 합니다 (TX-13)");
    case "ordinance_summary.sign":
      return has(viewer, "reviewer") ? ALLOW : deny("조례 요약의 감수 서명은 세무 감수위원(reviewer)만 할 수 있습니다");
    case "org.manage":
      return has(viewer, "store_ops") || viewer.isAdmin ? ALLOW : deny("기관·계약·좌석 운영은 스토어·구독 담당과 관리자만 합니다 (BIZ-07)");
    case "org_security.approve":
      return viewer.isAdmin ? ALLOW : deny("기관 보안·개인정보 확인표 승인은 관리자만 합니다");
    case "report.publish":
      return has(viewer, "editor") || viewer.isAdmin ? ALLOW : deny("프리미엄 리포트 발행은 편집 책임자와 관리자만 합니다");
    case "product.approve":
      return has(viewer, "editor") || viewer.isAdmin ? ALLOW : deny("자사 상품 카드 연결의 승인·철회는 편집 책임자와 관리자만 합니다 — 상품 담당은 제안까지입니다 (BIZ-03)");
    case "brand.manage":
      return has(viewer, "brand_ops") || viewer.isAdmin ? ALLOW : deny("브랜드 관리 담당(brand_ops)과 관리자만 합니다");
    // 증빙 승인·동의서·경력 표시 승인·광고 규정 감수·brand_copy — 관리자(PO)만. 브랜드 관리 담당은 증빙 등록·약력 연결까지 (W3 설계 6장 · BR-08)
    case "brand.approve":
      return viewer.isAdmin ? ALLOW : deny("브랜드 공개 승인(증빙 승인·동의서·경력 표시)은 관리자(PO)만 합니다");
    case "expert.manage":
      return has(viewer, "expert_ops") || viewer.isAdmin ? ALLOW : deny("전문가 담당(expert_ops)과 관리자만 합니다");
  }
}

export function can(viewer: Viewer, action: Action, resource?: Resource): boolean {
  return check(viewer, action, resource).allowed;
}

/** 대상 없이 허용되는 작업 목록 — 백오피스 역할별 메뉴(ADM-01)가 쓴다 */
export function allowedActions(viewer: Viewer): Action[] {
  return ACTION_LIST.filter((a) => can(viewer, a));
}
