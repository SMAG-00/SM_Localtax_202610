import "server-only";
import nodemailer from "nodemailer";
import { mailEnv } from "../env";
import { readMailConfig } from "./config";
import { renderMail, type MailTemplate, type MailVars } from "./templates";

// 메일 발송 모듈 (W2-e 설계 8.1, 이식성 규칙 5) — 바깥에서는 sendMail 하나만 부른다. 내부는 SMTP 하나.
//  · 기록에는 템플릿 이름 · 성공/실패 · 걸린 시간만 남긴다(받는 주소·본문·오류 문장 0)
//  · 실패해도 던지지 않고 { ok: false }를 돌려준다 — 호출하는 쪽이 상황에 맞게(가입은 503 + 임시 계정 정리) 처리한다
export { mailConfigured } from "./config";

const TIMEOUT_MS = 8000;

export async function sendMail(input: { to: string; template: MailTemplate; vars: MailVars }): Promise<{ ok: boolean }> {
  const started = Date.now();
  let ok = false;
  try {
    const config = readMailConfig(mailEnv());
    if (!config) throw new Error("not configured");
    const { subject, text } = renderMail(input.template, input.vars);
    const transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth ?? undefined,
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    });
    await transport.sendMail({ from: config.from, to: input.to, subject, text });
    ok = true;
  } catch {
    ok = false;
  }
  console.info(`[mail] template=${input.template} ok=${ok} ms=${Date.now() - started}`);
  return { ok };
}
