// 사진 주소 만들기 (F1) — http 주소 · 저장소 공개 경로 · 옛 상대 경로를 모두 올바르게 그린다
import { afterEach, describe, expect, test, vi } from "vitest";
import { absolute } from "./mapping";

afterEach(() => vi.unstubAllEnvs());

describe("absolute — 사진 주소", () => {
  test("http(s) 주소는 그대로", () => {
    expect(absolute("https://site.test", "https://cdn.test/a.jpg")).toBe("https://cdn.test/a.jpg");
  });
  test("저장소 공개 경로는 Supabase 주소에 붙는다 (끝 / 정리, 앞 / 있어도 같다)", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co/");
    expect(absolute("https://site.test", "storage/v1/object/public/media/x.png")).toBe("https://proj.supabase.co/storage/v1/object/public/media/x.png");
    expect(absolute("https://site.test", "/storage/v1/object/public/media/x.png")).toBe("https://proj.supabase.co/storage/v1/object/public/media/x.png");
  });
  test("옛 상대 경로는 사이트 주소에 붙는다 — Supabase 주소가 있어도 그대로", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
    expect(absolute("https://site.test", "/img/old.png")).toBe("https://site.test/img/old.png");
    expect(absolute(undefined, "img/old.png")).toBe("/img/old.png");
  });
  test("Supabase 주소를 모르면 저장소 경로도 사이트 주소에 붙는다 (빈 주소를 만들지 않는다)", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(absolute("https://site.test", "storage/v1/object/public/media/x.png")).toBe("https://site.test/storage/v1/object/public/media/x.png");
  });
});
