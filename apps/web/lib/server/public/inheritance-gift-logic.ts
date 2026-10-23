// 상속·증여 안내 규칙 (W4 23단계 — FAM-01 · FAM-02 · FAM-08, 설계 1장 23단계 · 2.2). 순수 함수 — DB 트리거 …56 inheritance_gift_settings_guard와 같은 규칙.
// 상속세·증여세는 이 사이트에서 계산하지 않는다 — 외부 「안심 상속증여계산기」로 연결만 한다(입력값 0·금액 합산 0). 내용 문장은 코드에 두지 않고 설정·감수 기사에서 온다.
import type { OfficialLinkCard } from "./calc";

/** 세 경로 (FAM-01 — 하위 /inheritance·/gift도 같은 규칙) */
export const IG_PATHS = ["inheritance-gift", "inheritance", "gift"] as const;
export type IgPath = (typeof IG_PATHS)[number];
export const IG_HREF: Readonly<Record<IgPath, string>> = {
  "inheritance-gift": "/realestate/inheritance-gift",
  inheritance: "/realestate/inheritance-gift/inheritance",
  gift: "/realestate/inheritance-gift/gift",
};
/** 화면 제목 — 글자 이름뿐(내용 문장 아님) */
export const IG_TITLE: Readonly<Record<IgPath, string>> = { "inheritance-gift": "상속·증여 안내", inheritance: "상속 안내", gift: "증여 안내" };

/** 고지 문구 씨앗 (PRD-01B FAM-01 문장) — 설정이 비었을 때의 대신 값이자 마이그레이션 씨앗과 같은 글자 */
export const IG_NOTICE_SEED = "상속세·증여세는 이 사이트에서 계산하지 않습니다";
export const IG_LIMITS = { noticeMax: 100, situations: 4 } as const;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function inheritanceNoticeErrors(value: unknown): string[] {
  if (typeof value !== "string") return ["상속·증여 고지 문구는 글자여야 합니다"];
  const t = value.trim();
  if (t.length < 1 || t.length > IG_LIMITS.noticeMax) return [`상속·증여 고지 문구는 1~${IG_LIMITS.noticeMax}자입니다`];
  if (/[0-9]/.test(t)) return ["상속·증여 고지 문구에는 숫자를 넣을 수 없습니다 — 기한·공제·세율 숫자는 고정 문구에 두지 않습니다"];
  return [];
}

export function inheritanceSituationsErrors(value: unknown): string[] {
  if (!Array.isArray(value)) return ["상속·증여 상황 목록은 상황 slug 목록이어야 합니다"];
  const errors: string[] = [];
  if (value.length > IG_LIMITS.situations) errors.push(`상속·증여 상황은 ${IG_LIMITS.situations}개까지입니다`);
  const seen = new Set<string>();
  for (const v of value) {
    if (typeof v !== "string" || !SLUG.test(v)) {
      errors.push(`상속·증여 상황 slug는 영문 소문자·숫자·하이픈 글자입니다 (지금 ${JSON.stringify(v)})`);
      continue;
    }
    if (seen.has(v)) errors.push(`상속·증여 상황 ${v}가 목록에 두 번 있습니다`);
    seen.add(v);
  }
  return errors;
}

export interface SituationFacts {
  slug: string;
  section: string;
  checklist: unknown;
  /** 연결된 official_links 행의 kind·key — 연결이 없으면 null */
  link: { kind: string; key: string } | null;
}

/** 목록에 든 상황이 갖춰야 할 것 중 빠진 것 (DB inheritance_situation_missing_for와 같은 규칙) — 없으면 null */
export function situationMissing(s: SituationFacts | undefined): string | null {
  if (!s) return "상황이 없습니다";
  const missing: string[] = [];
  if (s.section !== "realestate") missing.push("부동산 분야 상황");
  if (!s.link || s.link.kind !== "external_calculator" || s.link.key !== "inheritance_gift") missing.push("외부 계산기 연결");
  const c = s.checklist;
  const notice = typeof c === "object" && c !== null && !Array.isArray(c) ? (c as Record<string, unknown>).notice : undefined;
  if (typeof notice !== "string" || notice.trim() === "") missing.push("체크리스트 고지");
  return missing.length ? `${missing.join("·")}이(가) 필요합니다` : null;
}

/** 목록의 상황마다 갖춰졌는지 — 설정 API가 목록을 저장하기 전에 본다 */
export function inheritanceSituationsCrossErrors(slugs: readonly string[], facts: readonly SituationFacts[]): string[] {
  const out: string[] = [];
  for (const slug of slugs) {
    const m = situationMissing(facts.find((f) => f.slug === slug));
    if (m) out.push(`상속·증여 상황 ${slug}: ${m}`);
  }
  return out;
}

export function parseNotice(value: unknown): string {
  return inheritanceNoticeErrors(value).length === 0 ? (value as string).trim() : IG_NOTICE_SEED;
}
export function parseSituationSlugs(value: unknown): string[] {
  return inheritanceSituationsErrors(value).length === 0 ? (value as string[]) : [];
}

export interface LinkPair {
  card: OfficialLinkCard;
  fallbacks: OfficialLinkCard[];
}

/**
 * FAM-08 카드 — 설정 주소가 있는 외부 계산기 행. 끊김(broken)이면 국세청 안내로 바꾸고, 국세청도 끊겼거나 없으면 카드째 숨긴다(빈 링크 0).
 * 대체 안내는 국세청(nts)만 — 위택스는 지방세 안내라 이 카드의 대체가 아니다
 */
export function fam08Card(cards: readonly OfficialLinkCard[]): LinkPair | null {
  const card = cards.find((c) => c.kind === "external_calculator" && c.key === "inheritance_gift");
  if (!card) return null;
  const nts = cards.filter((c) => c.kind === "fallback" && c.key === "nts" && c.status !== "broken");
  if (card.status === "broken") return nts.length ? { card, fallbacks: nts } : null;
  return { card, fallbacks: [] };
}

/** SM 취득세 카드 — 기능 키 sm_calculator가 켜졌고 주소가 있을 때만. 끊김이면 위택스·국세청 대체 안내 */
export function smAcquisitionCard(cards: readonly OfficialLinkCard[], smOpen: boolean): LinkPair | null {
  if (!smOpen) return null;
  const card = cards.find((c) => c.kind === "sm_calculator" && c.key === "acquisition");
  return card ? { card, fallbacks: cards.filter((c) => c.kind === "fallback") } : null;
}

/** 「지방세로 읽기」 박스의 세목에 상속세·증여세가 있나 - 있으면 박스 옆에 국세 연결 카드(FAM-08)를 둔다 (W3에서 넘어온 일). 세목 이름만 본다 */
export const lensNeedsNationalCard = (topics: readonly string[]): boolean => topics.some((t) => /상속세|증여세/.test(t));

/** [취득세 계산하기] 버튼 — 기능 키 self_calculator가 켜졌을 때만 (FAM-01 2단계 플래그). 꺼짐 → null = 요소 0 */
export const SELF_CALCULATOR_HREF = "/calc/acquisition";
export const selfCalculatorHref = (open: boolean): string | null => (open ? SELF_CALCULATOR_HREF : null);
