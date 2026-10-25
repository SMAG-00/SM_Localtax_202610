import { describe, expect, it } from "vitest";
import { readBillingConfig, readPgMode } from "./config";

const BASE = { PG_WEBHOOK_SECRET: "whsec_test_value" };

describe("결제 설정 읽기", () => {
  it("PG_MODE가 비어 있거나 모르는 값이면 test로 읽는다", () => {
    expect(readPgMode(undefined)).toBe("test");
    expect(readPgMode("")).toBe("test");
    expect(readPgMode("production")).toBe("test");
    expect(readPgMode(" LIVE ")).toBe("live");
  });

  it("웹훅 열쇠가 없으면 어떤 모드에서도 닫힌다", () => {
    expect(readBillingConfig({ PG_SECRET_KEY: "test_sk_abc" }).ok).toBe(false);
    expect(readBillingConfig({ PG_MODE: "live", PG_SECRET_KEY: "live_sk_abc" }).ok).toBe(false);
  });

  it("시험 모드 + 로컬 가짜 PG 주소면 fake 공급자(끝 슬래시 제거)", () => {
    const r = readBillingConfig({ ...BASE, PG_FAKE_URL: "http://127.0.0.1:4010/" });
    expect(r).toMatchObject({ ok: true, config: { mode: "test", provider: "fake", baseUrl: "http://127.0.0.1:4010" } });
  });

  it("가짜 PG 주소가 이 PC 밖이면 거부", () => {
    expect(readBillingConfig({ ...BASE, PG_FAKE_URL: "https://pg.example.test" }).ok).toBe(false);
    expect(readBillingConfig({ ...BASE, PG_FAKE_URL: "http://127.0.0.1.evil.test" }).ok).toBe(false);
  });

  it("시험 모드 + 시험 키(test_sk_)면 toss 공급자", () => {
    const r = readBillingConfig({ ...BASE, PG_SECRET_KEY: "test_sk_abc" });
    expect(r).toMatchObject({ ok: true, config: { mode: "test", provider: "toss", baseUrl: "https://api.tosspayments.com" } });
  });

  it("시험 모드에 실결제 키, 키 없음, 모양이 다른 키는 거부하고 키 값을 사유에 넣지 않는다", () => {
    for (const key of ["live_sk_secretvalue", "", "sk_without_prefix"]) {
      const r = readBillingConfig({ ...BASE, PG_SECRET_KEY: key });
      expect(r.ok).toBe(false);
      if (!r.ok && key) expect(r.reason).not.toContain(key);
    }
  });

  it("실결제 모드는 실결제 키(live_sk_)일 때만 설정이 열리고 시험 키·가짜 주소로는 열리지 않는다", () => {
    expect(readBillingConfig({ ...BASE, PG_MODE: "live", PG_SECRET_KEY: "live_sk_abc" })).toMatchObject({ ok: true, config: { mode: "live", provider: "toss" } });
    expect(readBillingConfig({ ...BASE, PG_MODE: "live", PG_SECRET_KEY: "test_sk_abc" }).ok).toBe(false);
    expect(readBillingConfig({ ...BASE, PG_MODE: "live", PG_FAKE_URL: "http://127.0.0.1:4010" }).ok).toBe(false);
  });
});
