// 캠페인 태그 처리 (GROW-05, W10-i 설계 4장 #7) - 순수 함수 (시험 utm.test.ts)
//  · utm_source · utm_medium 은 설정 campaign_utm_values에 등록된 값만 그대로 쓰고 그 밖은 `other`로 바꾼다 (자유 글자에는 개인정보·검색어가 섞일 수 있다)
//  · utm_campaign 은 읽지 않는다 - 캠페인은 주소의 키를 쓴다. utm_term · utm_content(이벤트에 칸 없음) · gclid · fbclid 등 클릭 ID는 읽지도 저장하지도 않는다
//  · 도착 버튼 주소에는 태그를 싣지 않는다 (stripTrackingParams)
export interface UtmRegistry {
  source: readonly string[];
  medium: readonly string[];
  content: readonly string[];
}
export const EMPTY_UTM_REGISTRY: UtmRegistry = { source: [], medium: [], content: [] };

export type SearchParamsLike = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const MAX = 20;

/** 설정 값 -> 등록 목록 (모양이 틀리면 빈 목록 = 모든 값이 other) */
export function parseUtmRegistry(value: unknown): UtmRegistry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return EMPTY_UTM_REGISTRY;
  const v = value as Record<string, unknown>;
  const list = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && /^[a-z0-9][a-z0-9_-]{0,19}$/.test(s) && s !== "other") : []);
  return { source: list(v.source), medium: list(v.medium), content: list(v.content) };
}

/** 등록 값이면 그대로(소문자 비교), 아니면 other */
export function registeredOrOther(raw: string | undefined, allowed: readonly string[]): string {
  if (raw === undefined) return "other";
  const v = raw.trim().toLowerCase();
  return v.length > 0 && v.length <= MAX && allowed.includes(v) ? v : "other";
}

export function captureCampaignTags(params: SearchParamsLike, registry: UtmRegistry): { source: string; medium: string } {
  return { source: registeredOrOther(first(params.utm_source), registry.source), medium: registeredOrOther(first(params.utm_medium), registry.medium) };
}

const TRACKING = /^(utm_[a-z_]+|gclid|gbraid|wbraid|fbclid|msclkid|ttclid|twclid|li_fat_id|n_media|n_query|n_rank|n_ad_group|n_ad|n_keyword_id|n_keyword|n_campaign_type|n_ad_group_type|NaPm)$/i;

/** 주소에서 태그·클릭 ID 쿼리를 뺀다 (그 밖의 쿼리·해시는 그대로) */
export function stripTrackingParams(href: string): string {
  const hash = href.indexOf("#");
  const base = hash >= 0 ? href.slice(0, hash) : href;
  const frag = hash >= 0 ? href.slice(hash) : "";
  const q = base.indexOf("?");
  if (q < 0) return href;
  const kept = [...new URLSearchParams(base.slice(q + 1)).entries()].filter(([k]) => !TRACKING.test(k));
  const qs = new URLSearchParams(kept).toString();
  return `${base.slice(0, q)}${qs ? `?${qs}` : ""}${frag}`;
}
