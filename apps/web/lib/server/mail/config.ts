// 메일 설정 읽기 (W2-e 설계 8.1) — 순수 함수. 전송은 SMTP 하나이고, 서비스(Resend·사내 SMTP·로컬 수신함)는 환경변수로만 다르다.
//  · 필수: MAIL_FROM · MAIL_SMTP_HOST · MAIL_SMTP_PORT(1~65535). 사용자·비밀번호는 둘 다 있거나 둘 다 없어야 한다(하나만 있으면 설정 오류로 본다)
//  · 하나라도 빠지거나 모양이 틀리면 null — 호출하는 쪽은 메일이 필요한 기능(가입·재설정)을 열지 않는다

export interface MailConfig {
  from: string;
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string } | null;
}

type Env = Record<string, string | undefined>;
const TRUE_WORDS = new Set(["true", "1", "yes", "on"]);

export function readMailConfig(env: Env): MailConfig | null {
  const from = env.MAIL_FROM?.trim() ?? "";
  const host = env.MAIL_SMTP_HOST?.trim() ?? "";
  const portText = env.MAIL_SMTP_PORT?.trim() ?? "";
  if (from === "" || !from.includes("@") || host === "" || !/^\d{1,5}$/.test(portText)) return null;
  const port = Number(portText);
  if (port < 1 || port > 65535) return null;
  const user = env.MAIL_SMTP_USER ?? "";
  const pass = env.MAIL_SMTP_PASSWORD ?? "";
  if ((user === "") !== (pass === "")) return null;
  return { from, host, port, secure: TRUE_WORDS.has((env.MAIL_SMTP_SECURE ?? "").trim().toLowerCase()), auth: user === "" ? null : { user, pass } };
}

export const mailConfigured = (env: Env): boolean => readMailConfig(env) !== null;
