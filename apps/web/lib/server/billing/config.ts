// 결제 설정 읽기 (W10-f, PAY-02) — 순수 함수. 환경변수 값은 lib/server/env.ts billingEnv()가 읽어 넘긴다.
//  · PG_MODE: test(기본) 또는 live. 비어 있거나 모르는 값이면 test로 읽는다 (안전한 쪽).
//  · 공급자: 시험 모드에서 PG_FAKE_URL이 있으면 fake(로컬 가짜 PG 서버), 아니면 PG_SECRET_KEY가 시험 키(test_*)면 toss(토스페이먼츠 시험 모드).
//  · 시험 모드에 실결제 키, 실결제 모드에 시험 키는 설정 오류로 보고 결제를 닫는다. 키 문자열은 오류 문장에 넣지 않는다.
//  · 실결제(live)는 이 설정만으로 열리지 않는다 — 주문을 만들 때 commerce_readiness 기록을 서버와 DB가 다시 확인한다.

export type PgMode = "test" | "live";
export type PgProvider = "fake" | "toss";

export interface BillingEnv {
  PG_MODE?: string | undefined;
  PG_SECRET_KEY?: string | undefined;
  PG_WEBHOOK_SECRET?: string | undefined;
  PG_FAKE_URL?: string | undefined;
  NEXT_PUBLIC_PG_CLIENT_KEY?: string | undefined;
}

export interface BillingConfig {
  mode: PgMode;
  provider: PgProvider;
  baseUrl: string;
  secretKey: string;
  webhookSecret: string;
  clientKey: string;
}

export type BillingConfigResult = { ok: true; config: BillingConfig } | { ok: false; reason: string };

/** 토스페이먼츠 API 주소 — 시험 모드·실결제 모드가 같은 주소를 쓰고 키로 갈린다 */
export const TOSS_API_BASE = "https://api.tosspayments.com";

export function readPgMode(raw: string | undefined): PgMode {
  return raw?.trim().toLowerCase() === "live" ? "live" : "test";
}

const TEST_KEY = /^test_(g?sk)_/;
const LIVE_KEY = /^live_(g?sk)_/;

export function readBillingConfig(env: BillingEnv): BillingConfigResult {
  const mode = readPgMode(env.PG_MODE);
  const secretKey = env.PG_SECRET_KEY?.trim() ?? "";
  const webhookSecret = env.PG_WEBHOOK_SECRET?.trim() ?? "";
  const clientKey = env.NEXT_PUBLIC_PG_CLIENT_KEY?.trim() ?? "";
  const fakeUrl = env.PG_FAKE_URL?.trim().replace(/\/+$/, "") ?? "";
  if (!webhookSecret) return { ok: false, reason: "웹훅 서명 열쇠(PG_WEBHOOK_SECRET)가 없습니다" };
  if (mode === "test") {
    if (fakeUrl) {
      if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(fakeUrl)) return { ok: false, reason: "가짜 PG 주소(PG_FAKE_URL)는 이 PC(localhost) 주소여야 합니다" };
      return { ok: true, config: { mode, provider: "fake", baseUrl: fakeUrl, secretKey: secretKey || "fake-secret", webhookSecret, clientKey } };
    }
    if (!secretKey) return { ok: false, reason: "PG 서버 키(PG_SECRET_KEY)가 없습니다" };
    if (LIVE_KEY.test(secretKey)) return { ok: false, reason: "시험 모드(PG_MODE=test)에 실결제 키가 들어 있습니다" };
    if (!TEST_KEY.test(secretKey)) return { ok: false, reason: "PG 서버 키가 시험 키(test_...) 모양이 아닙니다" };
    return { ok: true, config: { mode, provider: "toss", baseUrl: TOSS_API_BASE, secretKey, webhookSecret, clientKey } };
  }
  if (!secretKey || !LIVE_KEY.test(secretKey)) return { ok: false, reason: "실결제 모드(PG_MODE=live)에는 실결제 키(live_...)가 필요합니다" };
  return { ok: true, config: { mode, provider: "toss", baseUrl: TOSS_API_BASE, secretKey, webhookSecret, clientKey } };
}
