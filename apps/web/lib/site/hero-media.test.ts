// 히어로 배경 설정(hero_media)의 웹 쪽 연결 — 홈 분야 카드 그림, 공개 설정 읽기, 설정 화면 검사 (본체 시험은 packages/ui hero-media.test.tsx)
import { describe, expect, test } from "vitest";
import { heroCardImages, parseHeroMedia } from "./hero-media";
import { isEditableSetting, validateSettingValue } from "@/lib/admin/settings-rules";
import { EXTRA_PUBLIC_SETTING_KEYS } from "@/lib/server/public/constants";
import { parsePublicSettings } from "@/lib/server/public/settings";

const SEED = {
  aiLabel: true,
  home: { video: "/media/hero/home.mp4", videoMobile: "/media/hero/home-m.mp4", poster: "/media/hero/home.avif", posterMobile: "/media/hero/home-m.avif", card: "/media/hero/home-card.avif" },
  tax: { poster: "/media/hero/tax.avif", posterMobile: "/media/hero/tax-m.avif", card: "/media/hero/tax-card.avif" },
  realestate: { poster: "/media/hero/realestate.avif", card: "/media/hero/realestate-card.avif" },
  finance: { poster: "/media/hero/finance.avif" },
};

describe("홈 분야 카드 그림", () => {
  test("분야 네 곳의 card 그림을 돌려준다 — card가 없으면 모바일·데스크톱 포스터로, 설정 없는 분야·홈은 빠진다", () => {
    expect(heroCardImages(parseHeroMedia(SEED))).toEqual({
      tax: "/media/hero/tax-card.avif",
      realestate: "/media/hero/realestate-card.avif",
      finance: "/media/hero/finance.avif",
    });
  });

  test("설정이 비어 있으면 카드 그림 0 (지금 모양)", () => {
    expect(heroCardImages(parseHeroMedia(undefined))).toEqual({});
  });
});

describe("공개 설정 읽기", () => {
  test("hero_media는 anon이 읽는 설정 키 목록에 있다 (DB 정책 settings_public_hero_media)", () => {
    expect(EXTRA_PUBLIC_SETTING_KEYS).toContain("hero_media");
  });

  test("parsePublicSettings가 hero_media를 읽는다 — 없으면 미디어 0·aiLabel 켜짐, 틀린 칸은 비운다", () => {
    expect(parsePublicSettings([]).heroMedia).toEqual({ entries: {}, aiLabel: true });
    const s = parsePublicSettings([{ key: "hero_media", value: { home: { video: "https://evil.example/a.mp4", poster: "/media/hero/home.avif" }, aiLabel: false } }]);
    expect(s.heroMedia.aiLabel).toBe(false);
    expect(s.heroMedia.entries.home).toEqual({ video: null, videoMobile: null, poster: "/media/hero/home.avif", posterMobile: null, card: null });
  });
});

describe("관리자 설정 검사 hero_media", () => {
  test("화면에서 고칠 수 있는 설정이고, 씨앗 값은 통과한다", () => {
    expect(isEditableSetting("hero_media")).toBe(true);
    expect(validateSettingValue("hero_media", SEED, null).ok).toBe(true);
  });

  test("외부 주소·모르는 칸은 거부하고 사유에 칸 경로가 있다", () => {
    const r = validateSettingValue("hero_media", { home: { video: "https://evil.example/a.mp4" }, news: {} }, null);
    expect(r.ok).toBe(false);
    const errors = (r as { errors: string[] }).errors;
    expect(errors.some((e) => e.startsWith("home.video:"))).toBe(true);
    expect(errors.some((e) => e.startsWith("news:"))).toBe(true);
  });
});
