// 메일 본문 (W2-e 설계 8.1) — 순수 함수. 링크와 "요청하지 않았다면 무시하세요" 수준의 짧은 안내문만 둔다(약관·동의 문구는 되풀이하지 않는다).
export const MAIL_TEMPLATES = ["signup_confirm", "signup_exists_notice", "signup_resend", "password_reset"] as const;
export type MailTemplate = (typeof MAIL_TEMPLATES)[number];
export interface MailVars {
  /** 확인 링크 (signup_confirm) */
  link?: string;
  /** 로그인 화면 주소 (signup_exists_notice) */
  loginUrl?: string;
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
    case "signup_exists_notice":
      return {
        subject: `[${SERVICE}] 이미 가입된 이메일입니다`,
        text: ["이 이메일 주소로 가입 요청이 있었지만 이미 가입된 계정이 있습니다.", "아래 주소에서 로그인해 주세요.", "", url(vars.loginUrl, "loginUrl"), "", IGNORE].join("\n"),
      };
  }
}
