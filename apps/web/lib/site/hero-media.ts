// 히어로 배경 미디어 설정 검사·읽기·재생 판정 — 본체는 packages/ui(HeroMedia 화면과 같은 모듈). 설정 hero_media (PO 결정 2026-10-25)
import { HERO_MEDIA_KEYS, resolveHeroMedia, type HeroMediaKey, type HeroMediaSettings } from "@ltr/ui";

export {
  HERO_AI_LABEL,
  HERO_IMAGE_FIELDS,
  HERO_MEDIA_DIR,
  HERO_MEDIA_KEYS,
  HERO_MOBILE_MAX_WIDTH,
  HERO_PLAYBACK_LABELS,
  HERO_VIDEO_FIELDS,
  canPlayHeroVideo,
  heroMediaErrors,
  isHeroMediaPath,
  parseHeroMedia,
  pickHeroVideo,
  resolveHeroMedia,
  type HeroMediaEntry,
  type HeroMediaField,
  type HeroMediaKey,
  type HeroMediaSettings,
  type ResolvedHeroMedia,
} from "@ltr/ui";

/** 홈 분야 카드 그림 — 분야 키마다 작은 그림 경로 (없으면 그 카드는 그림 없이 지금 모양) */
export function heroCardImages(settings: HeroMediaSettings): Partial<Record<Exclude<HeroMediaKey, "home">, string>> {
  const out: Partial<Record<Exclude<HeroMediaKey, "home">, string>> = {};
  for (const key of HERO_MEDIA_KEYS) {
    if (key === "home") continue;
    const card = resolveHeroMedia(settings, key)?.card;
    if (card) out[key] = card;
  }
  return out;
}
