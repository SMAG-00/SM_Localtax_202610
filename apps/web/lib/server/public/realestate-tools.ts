import "server-only";
import { cache } from "react";
import type { OfficialLink } from "@ltr/ui";
import { groupOpen } from "@/lib/accuracy/gate";
import { buildLifecycleView, type LifecycleView } from "@/lib/realestate/tax-lifecycle";
import { openCauses } from "@/lib/realestate/house-count";
import { parseTotalCostPolicy, type TotalCostPolicy } from "@/lib/realestate/total-cost";
import { getCalcView, type OfficialLinkCard } from "./calc";
import { getCalcTools } from "./calc-tools";
import { publicDb, rowsOf } from "./db";
import { readPublicSettings } from "./reads";
import type { Ruleset } from "@ltr/tax-engine";
import { familyNextCards, type FamilyCause, type FamilyNextCard } from "@/lib/realestate/family-next";
import type { ToolContext } from "@/lib/calc/tool-link";
import { parseSituationSlugs } from "./inheritance-gift-logic";

// 부동산 세금 전 주기·주택 수 판정·총비용 화면 데이터 (W11-b) - 공개 읽기 뷰만 읽는다(public_guides · public_determination_tables · public_total_cost_policy · official_links).
//  · 서명 전 가이드·판정표는 뷰가 주지 않는다. 기능 키가 꺼져 있으면 null -> 화면 404.
//  · 입력값은 이 모듈이 받지 않는다. 판정·계산은 브라우저에서만 한다.

const toLink = (c: OfficialLinkCard): OfficialLink => ({ url: c.url, status: c.status, checkedAt: c.checkedOn ?? "" });
const NO_LINK: OfficialLink = { url: "", status: "broken", checkedAt: "" };

export interface SmTransferPair {
  link: OfficialLink;
  fallback: OfficialLink;
  usageNote: string;
}

/** SM 부동산 세금 플랫폼 양도세 메뉴 카드 (RE-02) - 끊기면 공식 안내(국세청), 기능이 꺼져 있거나 주소가 없으면 null(카드 0) */
export async function smTransferPair(smOn: boolean): Promise<SmTransferPair | null> {
  if (!smOn) return null;
  const view = await getCalcView();
  const sm = view?.sm.find((c) => c.key === "transfer");
  if (!view || !sm) return null;
  const nts = view.fallbacks.find((c) => c.key === "nts");
  return { link: toLink(sm), fallback: nts ? toLink(nts) : NO_LINK, usageNote: sm.termsNote ?? "" };
}

export interface LifecyclePage {
  title: string;
  view: LifecycleView;
  lastReviewedAt: string | null;
  asOf: string | null;
  sm: SmTransferPair | null;
}

export const getLifecyclePage = cache(async (): Promise<LifecyclePage | null> => {
  const settings = await readPublicSettings();
  if (!settings.features.tax_lifecycle) return null;
  const rows = await rowsOf<{ title: string; sections: unknown; facts: unknown; as_of: string | null; last_reviewed_at: string | null }>(
    publicDb().from("public_guides").select("title, sections, facts, as_of, last_reviewed_at").eq("hub", "realestate_tax").eq("topic", "tax_lifecycle").order("published_at", { ascending: false }).limit(1),
    "세금 전 주기 가이드",
  );
  const g = rows[0];
  if (!g) return null;
  return { title: g.title, view: buildLifecycleView(g), lastReviewedAt: g.last_reviewed_at, asOf: g.as_of, sm: await smTransferPair(settings.features.sm_calculator) };
});

export interface HouseCountPage {
  /** 서명(활성)된 주택 수 판정표 - 렌더 때 함께 내려보내 브라우저가 판정한다(판정 중 요청 0) */
  tables: { kind: string; body: unknown }[];
}

export const getHouseCountPage = cache(async (): Promise<HouseCountPage | null> => {
  const settings = await readPublicSettings();
  if (!settings.features.house_count) return null;
  const rows = await rowsOf<{ kind: string; body: unknown }>(
    publicDb().from("public_determination_tables").select("kind, body").in("kind", ["house_count", "house_count_inheritance", "house_count_gift"]),
    "주택 수 판정표",
  );
  // 열린 원인이 하나도 없으면(서명 전) 화면도 열리지 않는다
  return openCauses(rows).length > 0 ? { tables: rows } : null;
});

export interface TotalCostPage {
  ruleset: Ruleset;
  policy: TotalCostPolicy;
  open: { acquisition: boolean; property: boolean; comprehensive: boolean };
  sm: SmTransferPair | null;
}

export const getTotalCostPage = cache(async (): Promise<TotalCostPage | null> => {
  const tools = await getCalcTools();
  if (!tools || !tools.ruleset) return null;
  const settings = await readPublicSettings();
  const f = settings.features;
  if (!f.total_cost || !f.calc || !f.self_calculator || !f.calc_acquisition || !f.calc_holding) return null;
  const rows = await rowsOf<{ policy: unknown }>(publicDb().from("public_total_cost_policy").select("policy").limit(1), "총비용 정책");
  const policy = rows[0] ? parseTotalCostPolicy(rows[0].policy) : null;
  if (!policy) return null;
  const open = {
    acquisition: groupOpen(tools.gateRows, "acquisition", "OTHER", tools.engineHash),
    property: groupOpen(tools.gateRows, "property", "ALL", tools.engineHash),
    comprehensive: groupOpen(tools.gateRows, "comprehensive", "ALL", tools.engineHash),
  };
  if (!open.acquisition) return null;
  return { ruleset: tools.ruleset, policy, open, sm: await smTransferPair(f.sm_calculator) };
});

export interface FamilyNextData {
  cards: FamilyNextCard[];
  sm: SmTransferPair | null;
}

const CLOSED_TOOLS: ToolContext = { features: { calc: false, sm_calculator: false, self_calculator: false, calc_acquisition: false, calc_holding: false, calc_refund: false }, gateRows: [], engineHash: "", refundTableActive: false };

/** 상속·증여 후 다음에 확인할 것 링크 묶음 (FAM-05) - 공개된 도구만. 카드가 하나도 없으면 null(상자째 없음) */
export async function getFamilyNext(cause: FamilyCause | null): Promise<FamilyNextData | null> {
  const [settings, tools, tables] = await Promise.all([
    readPublicSettings(),
    getCalcTools(),
    rowsOf<{ kind: string }>(publicDb().from("public_determination_tables").select("kind").in("kind", ["house_count_inheritance", "house_count_gift"]), "상속·증여 주택 수 판정표"),
  ]);
  const cards = familyNextCards(cause, { houseCountOn: settings.features.house_count, activeTableKinds: tables.map((t) => t.kind), tool: tools?.context ?? CLOSED_TOOLS });
  if (cards.length === 0) return null;
  return { cards, sm: cards.some((c) => c.id === "transfer") ? await smTransferPair(settings.features.sm_calculator) : null };
}

/** 상황 페이지가 상속·증여 상황인가 (설정 inheritance_gift_situations 목록, FAM-02) - 아니면 null */
export async function getFamilyNextForSituation(slug: string): Promise<FamilyNextData | null> {
  const rows = await rowsOf<{ key: string; value: unknown }>(publicDb().from("settings").select("key, value").eq("key", "inheritance_gift_situations"), "상속·증여 상황 목록");
  const listed = rows[0] ? parseSituationSlugs(rows[0].value) : [];
  return Array.isArray(listed) && listed.includes(slug) ? getFamilyNext(null) : null;
}
