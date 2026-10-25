// 히어로 배경 미디어 읽기 (설정 hero_media — PO 결정 2026-10-25). 공개 설정을 읽지 못하면 null/빈 값 = 지금의 어두운 그라데이션 (닫힌 쪽).
import { heroCardImages, resolveHeroMedia, type HeroMediaKey, type HeroMediaSettings, type ResolvedHeroMedia } from "@/lib/site/hero-media";
import { readPublic } from "./fallback";
import { readPublicSettings } from "./reads";

const EMPTY: HeroMediaSettings = { entries: {}, aiLabel: true };

async function readSettings(): Promise<HeroMediaSettings> {
  return readPublic("히어로 배경 설정", async () => (await readPublicSettings()).heroMedia, () => EMPTY);
}

/** 한 곳의 히어로 미디어 — 없으면 null */
export async function getHeroMedia(key: HeroMediaKey): Promise<ResolvedHeroMedia | null> {
  return resolveHeroMedia(await readSettings(), key);
}

/** 홈 — 전체 화면 배경 + 분야 카드 그림 */
export async function getHomeHeroMedia(): Promise<{ hero: ResolvedHeroMedia | null; cards: ReturnType<typeof heroCardImages> }> {
  const settings = await readSettings();
  return { hero: resolveHeroMedia(settings, "home"), cards: heroCardImages(settings) };
}
