// 히어로 배경 미디어 (PO 결정 2026-10-25) — 설정 hero_media의 모양 검사·읽기와 재생 판정. 순수 모듈 (HeroMedia 화면·apps/web 설정 검사·공개 설정 읽기가 같이 쓴다 — apps/web/lib/site/hero-media.ts가 다시 내보낸다).
//  · 홈(home)은 화면 전체, 분야 허브(tax·realestate·finance·local) 머리는 절반 높이 — 같은 설정 모양
//  · 파일 경로는 /media/hero/ 안의 공개 파일만 (외부 주소·상위 폴더 0). DB 트리거(마이그레이션 20261025000078)도 같은 규칙
//  · 모양이 틀린 값은 그 칸만 비운다 → 영상이 없으면 포스터 정지 그림, 둘 다 없으면 지금의 어두운 그라데이션 (닫힌 쪽)

export const HERO_MEDIA_KEYS = ["home", "tax", "realestate", "finance", "local"] as const;
export type HeroMediaKey = (typeof HERO_MEDIA_KEYS)[number];

/** 설정에서 고를 수 있는 파일 폴더 (공개 폴더 apps/web/public 아래) */
export const HERO_MEDIA_DIR = "/media/hero/";

export const HERO_VIDEO_FIELDS = ["video", "videoMobile"] as const;
export const HERO_IMAGE_FIELDS = ["poster", "posterMobile", "card"] as const;
const ENTRY_FIELDS = [...HERO_VIDEO_FIELDS, ...HERO_IMAGE_FIELDS] as const;
export type HeroMediaField = (typeof ENTRY_FIELDS)[number];

const VIDEO_EXT = /\.(mp4|webm)$/i;
const IMAGE_EXT = /\.(avif|webp|jpe?g|png)$/i;
const SAFE_PATH = /^\/media\/hero\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** 히어로 한 곳의 파일들 — 없는 칸은 null */
export type HeroMediaEntry = Record<HeroMediaField, string | null>;
export type HeroMediaSettings = { entries: Partial<Record<HeroMediaKey, HeroMediaEntry>>; aiLabel: boolean };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 공개 폴더 안 파일 경로인가 — 외부 주소·상위 폴더·하위 폴더·쿼리·확장자 틀림은 거짓 */
export function isHeroMediaPath(value: unknown, kind: "video" | "image"): value is string {
  return typeof value === "string" && SAFE_PATH.test(value) && (kind === "video" ? VIDEO_EXT : IMAGE_EXT).test(value);
}

const kindOf = (field: HeroMediaField): "video" | "image" => ((HERO_VIDEO_FIELDS as readonly string[]).includes(field) ? "video" : "image");

/** 저장 검사 — 틀린 곳마다 한 줄 (설정 화면·API가 보인다). 비어 있는 값은 없음으로 본다 */
export function heroMediaErrors(value: unknown): string[] {
  if (!isObj(value)) return ['값: { "home": { "video": "/media/hero/home.mp4", … }, …, "aiLabel": true } 모양의 객체여야 합니다'];
  const errors: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    if (k === "aiLabel") {
      if (typeof v !== "boolean") errors.push("aiLabel: true 또는 false여야 합니다");
      continue;
    }
    if (!(HERO_MEDIA_KEYS as readonly string[]).includes(k)) {
      errors.push(`${k}: 모르는 칸입니다 — ${HERO_MEDIA_KEYS.join(" · ")} · aiLabel만 쓸 수 있습니다`);
      continue;
    }
    if (!isObj(v)) {
      errors.push(`${k}: 객체여야 합니다 — 예: { "poster": "/media/hero/${k}.avif" }`);
      continue;
    }
    for (const [f, p] of Object.entries(v)) {
      if (!(ENTRY_FIELDS as readonly string[]).includes(f)) {
        errors.push(`${k}.${f}: 모르는 칸입니다 — ${ENTRY_FIELDS.join(" · ")}만 쓸 수 있습니다`);
        continue;
      }
      if (p === null || p === "") continue;
      const kind = kindOf(f as HeroMediaField);
      if (!isHeroMediaPath(p, kind)) {
        errors.push(`${k}.${f}: ${HERO_MEDIA_DIR} 안의 ${kind === "video" ? ".mp4·.webm 영상" : ".avif·.webp·.jpg·.png 그림"} 파일 경로여야 합니다 (바깥 주소·하위 폴더·'..' 불가)`);
      }
    }
  }
  return errors;
}

/** 공개 읽기 — 틀린 칸만 비운다. 객체가 아니면 아무것도 없는 값(= 그라데이션), aiLabel은 false로 적었을 때만 끈다(기본 켜짐) */
export function parseHeroMedia(value: unknown): HeroMediaSettings {
  const entries: HeroMediaSettings["entries"] = {};
  if (!isObj(value)) return { entries, aiLabel: true };
  for (const key of HERO_MEDIA_KEYS) {
    const raw = value[key];
    if (!isObj(raw)) continue;
    const entry = Object.fromEntries(ENTRY_FIELDS.map((f) => [f, isHeroMediaPath(raw[f], kindOf(f)) ? raw[f] : null])) as HeroMediaEntry;
    if (ENTRY_FIELDS.some((f) => entry[f] !== null)) entries[key] = entry;
  }
  return { entries, aiLabel: value.aiLabel !== false };
}

/** 화면이 쓰는 한 곳의 미디어 — 모바일 칸이 비면 데스크톱 파일로 대신한다. 아무것도 없으면 null (그라데이션) */
export type ResolvedHeroMedia = {
  video: string | null;
  videoMobile: string | null;
  poster: string | null;
  posterMobile: string | null;
  card: string | null;
  aiLabel: boolean;
};

export function resolveHeroMedia(settings: HeroMediaSettings, key: HeroMediaKey): ResolvedHeroMedia | null {
  const e = settings.entries[key];
  if (!e) return null;
  return {
    video: e.video,
    videoMobile: e.videoMobile ?? e.video,
    poster: e.poster ?? e.posterMobile,
    posterMobile: e.posterMobile ?? e.poster,
    card: e.card ?? e.posterMobile ?? e.poster,
    aiLabel: settings.aiLabel,
  };
}

/** 화면 폭이 이 값 이하이면 모바일 파일 (px) — Tailwind sm 경계 아래 */
export const HERO_MOBILE_MAX_WIDTH = 767;

/**
 * 영상을 불러와도 되는가 — 영상 파일이 있고, 동작 줄이기(prefers-reduced-motion)·데이터 절약(Save-Data)이 아닐 때만.
 * 아니면 포스터 정지 그림만 (영상 요청 0). 사용자가 직접 멈춘 상태는 따로 다룬다(재생 단추)
 */
export function canPlayHeroVideo(input: { hasVideo: boolean; reducedMotion: boolean; saveData: boolean }): boolean {
  return input.hasVideo && !input.reducedMotion && !input.saveData;
}

/** 이 화면 폭에서 쓸 영상 파일 */
export function pickHeroVideo(media: Pick<ResolvedHeroMedia, "video" | "videoMobile">, viewportWidth: number): string | null {
  return viewportWidth <= HERO_MOBILE_MAX_WIDTH ? media.videoMobile ?? media.video : media.video ?? media.videoMobile;
}

/** 재생 단추 글자 (WCAG 2.2.2) — 지금 상태의 반대 동작을 알린다 */
export const HERO_PLAYBACK_LABELS = { pause: "배경 영상 일시정지", play: "배경 영상 재생" } as const;
/** 인공지능 생성물 표시 (인공지능 기본법 — 설정 aiLabel로 끈다) */
export const HERO_AI_LABEL = "AI 생성 영상";
