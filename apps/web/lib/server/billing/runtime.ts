import "server-only";
import { billingEnv } from "@/lib/server/env";
import { readBillingConfig, type BillingConfig } from "./config";
import { createPgAdapter, type PgAdapter } from "./pg";

// 결제 실행 환경 — 환경변수에서 설정을 읽어 PgAdapter를 만든다. 설정이 맞지 않으면 null (결제 경로는 503으로 닫힌다). 설정 사유는 서버 로그에만 남기고 키는 쓰지 않는다.
export interface BillingRuntime {
  config: BillingConfig;
  adapter: PgAdapter;
}

let warned = false;

export function getBillingRuntime(): BillingRuntime | null {
  const result = readBillingConfig(billingEnv());
  if (!result.ok) {
    if (!warned) {
      warned = true;
      console.error("[billing] 결제 설정이 맞지 않아 결제 경로를 닫습니다:", result.reason);
    }
    return null;
  }
  return { config: result.config, adapter: createPgAdapter(result.config) };
}
