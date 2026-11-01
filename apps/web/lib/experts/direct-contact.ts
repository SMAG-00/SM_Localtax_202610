// 전문가 상담 바로 연락 (설정 expert_direct_contact — PO 결정 2026-11-01). DB 트리거(…239)와 같은 검사 — 순수 함수 (시험 direct-contact.test.ts)
//  · 상담 요청 양식 위·칼럼 끝 상담 상자에 '바로 전화'·'카카오톡 상담'·무료 범위 한 줄로 보인다. 칸을 비우면 그 줄을 숨긴다

export interface DirectContact {
  /** 화면에 보이는 번호 그대로 (예: 010-1234-5678) */
  phone: string | null;
  /** tel: 주소 — 숫자만 */
  telHref: string | null;
  kakaoUrl: string | null;
  freeScope: string | null;
}

const PHONE = /^0[0-9-]{8,12}$/;
const KAKAO = /^https:\/\/open\.kakao\.com\/[A-Za-z0-9/_-]+$/;
export const FREE_SCOPE_MAX = 80;
const KEYS = ["phone", "kakaoUrl", "freeScope"] as const;

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** 설정 값의 문제 목록 — 빈 목록이면 저장할 수 있다 */
export function directContactErrors(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return ["값: { phone, kakaoUrl, freeScope } 객체여야 합니다"];
  const v = value as Record<string, unknown>;
  const errors: string[] = [];
  for (const k of Object.keys(v)) {
    if (!(KEYS as readonly string[]).includes(k)) errors.push(`${k}: 모르는 칸입니다 (phone·kakaoUrl·freeScope만)`);
    else if (typeof v[k] !== "string") errors.push(`${k}: 글자여야 합니다`);
  }
  if (errors.length) return errors;
  const phone = text(v.phone);
  if (phone && !PHONE.test(phone)) errors.push("phone: 0으로 시작하는 숫자·하이픈 9~13자입니다 (예: 010-1234-5678)");
  const kakao = text(v.kakaoUrl);
  if (kakao && !KAKAO.test(kakao)) errors.push("kakaoUrl: https://open.kakao.com/ 오픈채팅 주소(쿼리 없음)입니다");
  if (text(v.freeScope).length > FREE_SCOPE_MAX) errors.push(`freeScope: ${FREE_SCOPE_MAX}자 이하 한 줄입니다`);
  return errors;
}

/** 공개 화면 값 — 틀린 칸은 숨긴다. 보일 것이 하나도 없으면 null */
export function parseDirectContact(value: unknown): DirectContact | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const phone = PHONE.test(text(v.phone)) ? text(v.phone) : null;
  const kakaoUrl = KAKAO.test(text(v.kakaoUrl)) ? text(v.kakaoUrl) : null;
  const scope = text(v.freeScope);
  const freeScope = scope && scope.length <= FREE_SCOPE_MAX ? scope : null;
  if (!phone && !kakaoUrl && !freeScope) return null;
  return { phone, telHref: phone ? `tel:${phone.replace(/-/g, "")}` : null, kakaoUrl, freeScope };
}
