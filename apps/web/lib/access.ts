// 접근 판정 한 함수 (PRD-00 6장 · ACC-04 · ADM-01 · NAV-06 · NAV-12, docs/dev/W2-a_설계.md §5)
// 순수 함수다 — DB·네트워크·시계를 쓰지 않는다. 서버(lib/server/dal.ts)가 로그인 확인 뒤 이 함수로만 허용 여부를 정한다.
//  · 관리자(ADMIN_EMAILS)는 데이터·설정 전권(역할 부여, 분야·사전·설정 편집, 모든 기록 조회)이다.
//  · 편집 행위(편집 승인·발행·정렬·HOT·홈 배치·발행 뒤 수정·정정 결정)는 editor 역할이 있어야 한다 — 관리자도 같다 (PO 결정 2026-10-17).
//  · 작성 기자와 편집 승인자는 다른 사람이어야 한다 (NAV-12 — DB 트리거도 막는다).
//  · 세무 감수 서명은 reviewer만 한다.
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
  "category.edit": "분야 편집",
  "dictionary.edit": "금지 표현·공포 표현·용어 사전 편집",
  "settings.edit": "운영 설정 편집",
  "role.grant": "서비스 역할 부여",
  "role.revoke": "서비스 역할 회수",
  "audit.read": "감사 기록 조회",
  "sponsored.manage": "광고·협찬·제휴 콘텐츠 등록·광고 상품 운영",
  "product.manage": "스토어 상품·주문 경로·구독 운영",
  "brand.manage": "인물 페이지·표준 약력·증빙·동의 기록",
  "expert.manage": "전문가 등재·연락 요청 처리",
} as const;
export type Action = keyof typeof ACTIONS;
export const ACTION_LIST = Object.keys(ACTIONS) as Action[];

/** 거부되면 감사 로그에 남기는 작업 — 기사 승인·정렬·발행 (NAV-06 · ACC-04)과 역할 부여 */
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

export type Resource = ArticleResource;

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
function writeArticle(viewer: Viewer, resource: Resource | undefined, action: "article.create" | "article.edit" | "article.submit"): Decision {
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
export function check(viewer: Viewer, action: Action, resource?: Resource): Decision {
  switch (action) {
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

    case "article.tax_lens_skip":
    case "review.sponsor_check":
    case "article.publish":
    case "article.sort":
    case "article.hot":
    case "article.home":
    case "correction.decide":
      return editorOnly(viewer);

    case "correction.request":
      return has(viewer, "reporter", "editor") ? ALLOW : deny("정정·반론 요청은 기자·편집 책임자가 작성합니다");

    case "assignment.read":
    case "assignment.create":
    case "assignment.update":
      return has(viewer, "reporter", "editor") || viewer.isAdmin ? ALLOW : deny("기사 기획은 기자·편집 책임자가 다룹니다");

    case "category.edit":
    case "dictionary.edit":
      return has(viewer, "editor") || viewer.isAdmin ? ALLOW : deny("분야·사전 편집은 편집 책임자와 관리자만 합니다");

    case "settings.edit":
    case "role.grant":
    case "role.revoke":
    case "audit.read":
      return viewer.isAdmin ? ALLOW : deny(ADMIN_ONLY);

    case "sponsored.manage":
      return has(viewer, "ad_ops") || viewer.isAdmin ? ALLOW : deny("광고·협찬 담당(ad_ops)과 관리자만 합니다");
    case "product.manage":
      return has(viewer, "store_ops") || viewer.isAdmin ? ALLOW : deny("스토어·구독 담당(store_ops)과 관리자만 합니다");
    case "brand.manage":
      return has(viewer, "brand_ops") || viewer.isAdmin ? ALLOW : deny("브랜드 관리 담당(brand_ops)과 관리자만 합니다");
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
