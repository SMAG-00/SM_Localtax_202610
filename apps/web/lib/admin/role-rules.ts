// 역할 겸직 금지 화면 검사 (ACC-04 · ADM-02) — 회원·역할 화면이 역할 부여 API를 부르기 전에 막고 사유를 보인다.
// 같은 규칙을 DB 트리거(staff_roles_separation)가 강제한다 — 화면 검사를 지나도(예: 다른 관리자가 먼저 바꿈) 서버가 409로 거부한다.
// 순수 모듈이다 — 브라우저에서도 쓴다.
import { NON_NEWSROOM_ROLES, STAFF_ROLES, type StaffRole } from "@/lib/access";
import { ROLE_LABELS } from "./labels";

const name = (role: StaffRole) => `${ROLE_LABELS[role]}(${role})`;

/** 이 역할을 지금 역할에 더할 수 없는 사유 — 더할 수 있으면 null */
export function roleConflict(current: readonly StaffRole[], role: StaffRole): string | null {
  if (current.includes(role)) return "이미 부여된 역할입니다";
  const other: StaffRole | undefined =
    role === "editor" ? current.find((r) => NON_NEWSROOM_ROLES.includes(r)) : NON_NEWSROOM_ROLES.includes(role) && current.includes("editor") ? "editor" : undefined;
  if (!other) return null;
  const nonNewsroom = role === "editor" ? other : role;
  return `${name("editor")}와 ${name(nonNewsroom)}는 한 사람에게 함께 줄 수 없습니다 — 편집 승인 권한과 편집국 외 역할의 겸직 금지 (ACC-04)`;
}

export interface GrantChoice {
  role: StaffRole;
  label: string;
  /** 고를 수는 있지만 부여하면 막히는 사유 (겸직 금지) — 없으면 null */
  blockedReason: string | null;
}

/** 역할 더하기 선택지 — 이미 있는 역할은 뺀다 */
export function grantChoices(current: readonly StaffRole[]): GrantChoice[] {
  return STAFF_ROLES.filter((r) => !current.includes(r)).map((role) => ({ role, label: ROLE_LABELS[role], blockedReason: roleConflict(current, role) }));
}
