import type { PictogramName } from "./pictograms";

/** 4대 분야 — 값은 DB `section`(tax·realestate·finance·local)과 같다 (PRD-01A CAT-01). 순서·경로는 HOME-01·HOME-02 고정 */
export const FIELD_ORDER = ["tax", "realestate", "finance", "local"] as const;

export type FieldSection = (typeof FIELD_ORDER)[number];

export const FIELDS: Record<FieldSection, { name: string; href: string; pictogram: PictogramName }> = {
  tax: { name: "지방세", href: "/tax", pictogram: "field-local-tax" },
  realestate: { name: "부동산", href: "/realestate", pictogram: "field-real-estate" },
  finance: { name: "부동산개발금융", href: "/finance", pictogram: "field-development-finance" },
  local: { name: "지자체뉴스", href: "/local", pictogram: "field-local-news" },
};
