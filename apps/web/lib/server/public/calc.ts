import "server-only";
import { isoToKstDate } from "@/lib/admin/form-utils";
import type { LinkKind, LinkStatus } from "@/lib/links/rules";
import { publicDb, rowsOf } from "./db";
import { readPublicSettings } from "./reads";

// /calc 공개 화면 데이터 (TX-01·FAM-08 · W3 1단계) — official_links 공개 칸(RLS: 활성 행만)을 읽는다.
// 주소·이용 조건 문구는 설정값이다 — 주소가 비면 그 카드는 목록에 없다('준비 중' 카드 0). 이 함수는 계산을 하지 않고 입력값도 받지 않는다.
// 기능 키 calc가 꺼져 있으면 null → 화면 404.

export interface OfficialLinkCard {
  id: number;
  kind: LinkKind;
  key: string;
  label: string;
  url: string;
  termsNote: string | null;
  status: LinkStatus;
  /** 마지막 점검일 (KST, YYYY-MM-DD) — 점검 전이면 null */
  checkedOn: string | null;
}

export interface CalcView {
  sm: OfficialLinkCard[];
  external: OfficialLinkCard[];
  /** 끊김 확인 시 안내할 대체 안내(위택스·국세청 등) */
  fallbacks: OfficialLinkCard[];
}

interface Row {
  id: number;
  kind: LinkKind;
  key: string;
  label: string;
  url: string | null;
  terms_note: string | null;
  status: LinkStatus;
  checked_at: string | null;
}

export const OFFICIAL_LINK_COLUMNS = "id, kind, key, label, url, terms_note, status, checked_at";
export const SM_CARD_LIMIT = 5;

export function toLinkCard(r: Row): OfficialLinkCard | null {
  if (!r.url) return null;
  return {
    id: Number(r.id),
    kind: r.kind,
    key: r.key,
    label: r.label,
    url: r.url,
    termsNote: r.terms_note ?? null,
    status: r.status,
    checkedOn: r.checked_at ? isoToKstDate(r.checked_at) : null,
  };
}

/**
 * 상황 페이지 등에 붙는 바깥 연결 카드 하나 (FAM-08 · TX-06 — W3 9단계). 주소가 빈 행·꺼진 행은 공개 읽기에서 0행 → null(카드 숨김).
 * SM 계산기 행은 기능 키 sm_calculator가 켜졌을 때만. 끊김이면 같은 자리에 대체 안내(위택스·국세청)
 */
export async function getOfficialLinkCard(id: number, features: { sm_calculator: boolean }): Promise<{ card: OfficialLinkCard; fallbacks: OfficialLinkCard[] } | null> {
  const rows = await rowsOf<Row>(
    publicDb().from("official_links").select(OFFICIAL_LINK_COLUMNS).not("url", "is", null).or(`id.eq.${Math.trunc(id)},kind.eq.fallback`).order("sort").order("id"),
    "바깥 연결 카드",
  );
  const cards = rows.flatMap((r) => {
    const c = toLinkCard(r);
    return c ? [c] : [];
  });
  const card = cards.find((c) => c.id === Math.trunc(id));
  if (!card || (card.kind === "sm_calculator" && !features.sm_calculator)) return null;
  return { card, fallbacks: cards.filter((c) => c.kind === "fallback" && c.id !== card.id) };
}

export async function getCalcView(): Promise<CalcView | null> {
  const settings = await readPublicSettings();
  if (!settings.features.calc) return null;
  const rows = await rowsOf<Row>(publicDb().from("official_links").select(OFFICIAL_LINK_COLUMNS).not("url", "is", null).order("sort").order("id"), "바깥 연결");
  const cards = rows.flatMap((r) => {
    const c = toLinkCard(r);
    return c ? [c] : [];
  });
  return {
    sm: cards.filter((c) => c.kind === "sm_calculator").slice(0, SM_CARD_LIMIT),
    external: cards.filter((c) => c.kind === "external_calculator"),
    fallbacks: cards.filter((c) => c.kind === "fallback"),
  };
}
