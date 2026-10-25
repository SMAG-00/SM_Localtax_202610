// 메일 본문 (W2-e 설계 8.1) — 순수 함수. 링크와 "요청하지 않았다면 무시하세요" 수준의 짧은 안내문만 둔다(약관·동의 문구는 되풀이하지 않는다).
export const MAIL_TEMPLATES = ["signup_confirm", "signup_exists_notice", "signup_resend", "password_reset", "inquiry_receipt", "brief_confirm", "expert_request_notice", "brief_subscribe_confirm", "brief_reconfirm", "brief_issue", "amendment_alert", "brief_launch_notice"] as const;
export type MailTemplate = (typeof MAIL_TEMPLATES)[number];
export interface MailVars {
  /** 확인 링크 (signup_confirm) */
  link?: string;
  /** 로그인 화면 주소 (signup_exists_notice) */
  loginUrl?: string;
  /** 접수 번호·문의 종류 이름 (inquiry_receipt — 본문·연락처는 되풀이하지 않는다) */
  refCode?: string;
  kindLabel?: string;
  /** 담당자 알림 (expert_request_notice) - 접수 번호·분야 이름·보안 화면 주소만. 이름·연락처·요약은 싣지 않는다 (EXPL-16) */
  categoryLabel?: string;
  /** 사전 알림 철회 링크 (brief_confirm) */
  unsubscribeLink?: string;
  /** W10-e - 구독 종류 이름 (brief_subscribe_confirm · brief_reconfirm) */
  kindLabel2?: string;
  /** W10-e - 브리핑 호/알림 (brief_issue · amendment_alert) - 제목과 본문은 이미 만들어진 글 */
  subjectTitle?: string;
  bodyText?: string;
}

const SERVICE = "선명 지방세·부동산";
const IGNORE = "본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다.";

function url(value: string | undefined, name: string): string {
  if (!value || !/^https?:\/\/[^\s]+$/.test(value)) throw new Error(`메일 변수 ${name}에 http(s) 주소가 필요합니다`);
  return value;
}

export function renderMail(template: MailTemplate, vars: MailVars): { subject: string; text: string } {
  switch (template) {
    case "signup_confirm":
      return {
        subject: `[${SERVICE}] 가입 확인`,
        text: ["가입을 마치려면 아래 링크를 열고 [가입 확인하기] 버튼을 눌러 주세요.", "", url(vars.link, "link"), "", IGNORE].join("\n"),
      };
    case "signup_resend":
      return {
        subject: `[${SERVICE}] 가입 확인 메일 다시 보냄`,
        text: ["가입 확인 메일을 다시 보냅니다. 아래 링크를 열고 [가입 확인하기] 버튼을 눌러 주세요.", "", url(vars.link, "link"), "", IGNORE].join("\n"),
      };
    case "password_reset":
      return {
        subject: `[${SERVICE}] 비밀번호 재설정`,
        text: ["비밀번호를 다시 정하려면 아래 링크를 열고 [비밀번호 재설정하기] 버튼을 눌러 주세요. 링크는 한 번만 쓸 수 있습니다.", "", url(vars.link, "link"), "", IGNORE].join("\n"),
      };
    case "inquiry_receipt":
      return {
        subject: `[${SERVICE}] 문의가 접수되었습니다`,
        text: [`${vars.kindLabel ?? "문의"}가 접수되었습니다.`, `접수 번호: ${vars.refCode ?? ""}`, "", "담당자가 확인한 뒤 회사 메일로 직접 연락드릴 수 있습니다. 이 메일에는 회신하지 않으셔도 됩니다.", "", IGNORE].join("\n"),
      };
    case "brief_confirm":
      return {
        subject: `[${SERVICE}] 브리핑 알림 신청 확인`,
        text: ["브리핑 사전 알림 신청을 마치려면 아래 링크를 열고 [신청 확정하기] 버튼을 눌러 주세요.", "", url(vars.link, "link"), "", "신청을 철회하려면 아래 링크를 열어 주세요.", url(vars.unsubscribeLink, "unsubscribeLink"), "", IGNORE].join("\n"),
      };
    case "brief_subscribe_confirm":
      return {
        subject: `[${SERVICE}] ${vars.kindLabel2 ?? "알림"} 신청 확인`,
        text: [`${vars.kindLabel2 ?? "알림"} 신청을 마치려면 아래 링크를 열고 [신청 확정하기] 버튼을 눌러 주세요. 확인 전에는 아무것도 보내지 않습니다.`, "", url(vars.link, "link"), "", "신청을 철회하려면 아래 링크를 열어 주세요.", url(vars.unsubscribeLink, "unsubscribeLink"), "", IGNORE].join("\n"),
      };
    case "brief_reconfirm":
      return {
        subject: `[${SERVICE}] ${vars.kindLabel2 ?? "알림"} 수신 재확인`,
        text: ["계속 받으시려면 오늘 안에 아래 링크를 열고 [신청 확정하기] 버튼을 눌러 주세요. 확인하지 않으시면 내일부터 보내지 않습니다.", "", url(vars.link, "link"), "", "그만 받으시려면 아래 링크를 열어 주세요.", url(vars.unsubscribeLink, "unsubscribeLink")].join("\n"),
      };
    case "brief_issue":
    case "amendment_alert":
      // 제목·본문은 호/알림을 만드는 쪽이 완성한다 - 광고성 호의 제목은 "(광고)"로 시작해야 하므로 서비스 이름을 앞에 붙이지 않는다
      return { subject: vars.subjectTitle ?? "", text: vars.bodyText ?? "" };
    case "brief_launch_notice":
      return {
        subject: `[${SERVICE}] 브리핑이 시작되었습니다`,
        text: ["사전 알림을 신청하신 분께 한 번만 알려 드립니다. 브리핑을 받으시려면 아래에서 구독을 신청하고 확인 메일의 링크를 눌러 주세요. 사전 알림 신청만으로는 브리핑이 발송되지 않습니다.", "", url(vars.link, "link"), "", "사전 알림을 철회하려면 아래 링크를 열어 주세요.", url(vars.unsubscribeLink, "unsubscribeLink")].join("\n"),
      };
    case "expert_request_notice":
      return {
        subject: `[${SERVICE}] SM 전문가 연락 요청이 접수되었습니다`,
        text: [`접수 번호: ${vars.refCode ?? ""}`, `분야: ${vars.categoryLabel ?? ""}`, "", "내용은 로그인한 보안 화면에서만 볼 수 있습니다.", url(vars.link, "link")].join("\n"),
      };
    case "signup_exists_notice":
      return {
        subject: `[${SERVICE}] 이미 가입된 이메일입니다`,
        text: ["이 이메일 주소로 가입 요청이 있었지만 이미 가입된 계정이 있습니다.", "아래 주소에서 로그인해 주세요.", "", url(vars.loginUrl, "loginUrl"), "", IGNORE].join("\n"),
      };
  }
}
