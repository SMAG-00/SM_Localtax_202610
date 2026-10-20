// 기능 키 의존 판정 (W2-e 설계 2.3 · 6.3) — 키 값 · 의존하는 게시본 · 메일 설정 유무를 한 곳에서 판정한다.
// 공개 틀의 정책 링크·바닥글·기사 하단 링크·isOpenPath가 모두 여기서 나온 '실제로 열린 기능'을 쓴다 → 링크가 있는데 404인 불일치가 구조적으로 생기지 않는다. 순수 모듈.
import { FEATURE_KEYS, type FeatureKey, type Features } from "@/lib/server/public/constants";
import { POLICY_DOCS, policyDoc, type PolicyDocKey } from "./docs";

export interface FeatureNeeds {
  /** 게시본이 있어야 하는 문서 */
  docs: readonly PolicyDocKey[];
  /** 같이 열려 있어야 하는 기능 */
  features: readonly FeatureKey[];
  /** 메일 설정이 있어야 하나 */
  mail: boolean;
}

/** 의존이 있는 키만 — 나머지(유틸 메뉴 기능 등)는 키 값만 본다 */
export function featureNeeds(key: FeatureKey): FeatureNeeds | null {
  const own = POLICY_DOCS.find((d) => d.feature === key);
  if (own) {
    if (key === "page_advertise") return { docs: ["advertise", "privacy", "ad-policy"], features: ["page_privacy", "page_ad_policy"], mail: false };
    return { docs: [own.key], features: [], mail: false };
  }
  switch (key) {
    case "page_help":
      return { docs: ["privacy"], features: [], mail: false };
    case "members":
      return { docs: ["terms", "privacy"], features: [], mail: true };
    case "brief":
      return { docs: ["privacy"], features: [], mail: true };
    default:
      return null;
  }
}

const docsMet = (needs: FeatureNeeds, published: ReadonlySet<string>) => needs.docs.every((d) => published.has(d));

/** 켜진 값에 의존까지 더한 '실제로 열린' 기능 목록 */
export function effectiveFeatures(raw: Features, published: ReadonlySet<string>, mailReady: boolean): Features {
  const base = { ...raw } as Record<FeatureKey, boolean>;
  for (const k of FEATURE_KEYS) {
    const n = featureNeeds(k);
    if (n && base[k]) base[k] = docsMet(n, published) && (!n.mail || mailReady);
  }
  const out = { ...base };
  for (const k of FEATURE_KEYS) {
    const n = featureNeeds(k);
    if (n && out[k]) out[k] = n.features.every((f) => base[f]);
  }
  return out;
}

export const featureOpen = (key: FeatureKey, raw: Features, published: ReadonlySet<string>, mailReady: boolean): boolean => effectiveFeatures(raw, published, mailReady)[key];

/** 새로 켜는 키가 의존을 채우지 못하면 사유 목록 (운영 설정 화면 · 6.3) — 이미 켜져 있던 키는 건드리지 않는다 */
export function featureEnableErrors(previous: Features, next: Features, published: ReadonlySet<string>, mailReady: boolean): string[] {
  const errors: string[] = [];
  for (const k of FEATURE_KEYS) {
    if (!next[k] || previous[k]) continue;
    const n = featureNeeds(k);
    if (!n) continue;
    const missing = n.docs.filter((d) => !published.has(d));
    if (missing.length) errors.push(`feature_flags.${k}: 게시본이 없는 정책 페이지는 켤 수 없습니다 — ${missing.map((d) => policyDoc(d).label).join(" · ")}`);
    const off = n.features.filter((f) => !next[f]);
    if (off.length) errors.push(`feature_flags.${k}: 먼저 켜야 하는 기능이 있습니다 — ${off.join(" · ")}`);
    if (n.mail && !mailReady) errors.push(`feature_flags.${k}: 메일 설정이 없어 켤 수 없습니다`);
  }
  return errors;
}
