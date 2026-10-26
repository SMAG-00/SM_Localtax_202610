// 부동산 세금 전 주기 해설 화면 규칙 (RE-01·RE-02 · b1·b2) - 순수 함수만. 글은 서명·공개된 가이드 버전(public_guides)에서만 오고 이 파일에는 법·세무 문장이 없다.
//  · 절 약속: sections[]는 { heading, body }(가이드 관리 화면 형식 그대로), 탭·원인·세목 배지는 facts.section_map에 둔다 - 모양이 틀린 절은 렌더하지 않는다.
//  · 한 절은 국세 또는 지방세 중 하나만 갖는다(배지 하나). 둘이 섞인 절·모르는 값은 버린다.
//  · 양도 탭은 해설만: 원 단위 금액 표현이 들어 있는 절은 버린다(양도 금액 0). 계산 칸·매도가 입력은 이 화면에 없다.
//  · 확인 목록(RE-02)은 가이드 facts.transfer_checklist의 label 문장만 쓴다. 기준 금액·기간은 코드에 없다. 단정 표현이 든 항목은 버린다.

export const LIFECYCLE_TABS = ["acquire", "hold", "transfer"] as const;
export type LifecycleTab = (typeof LIFECYCLE_TABS)[number];
export const LIFECYCLE_TAB_LABEL: Readonly<Record<LifecycleTab, string>> = { acquire: "취득", hold: "보유", transfer: "양도" };

export const LIFECYCLE_CAUSES = ["PAID", "INHERITANCE", "GIFT"] as const;
export type LifecycleCause = (typeof LIFECYCLE_CAUSES)[number];
export const LIFECYCLE_CAUSE_LABEL: Readonly<Record<LifecycleCause, string>> = { PAID: "매매", INHERITANCE: "상속", GIFT: "증여" };

/** 상속·증여 칸이 잇는 1단계 안내 페이지 (FAM-01) */
export const INHERITANCE_GIFT_HREF = "/realestate/inheritance-gift";

export interface LifecycleSection {
  tab: LifecycleTab;
  cause: LifecycleCause | null;
  title: string;
  body: string;
  taxKind: "local" | "national";
  sources: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
/** 원 단위 금액 표현 (예: 1,000원 / 3000 원) */
const WON_AMOUNT = /\d[\d,]*\s*원/;
/** 단정 표현 (PRD-00 8.8) - 확인 목록은 요건을 알리기만 한다 */
const ASSERTIVE = /비과세(됩니다|입니다)|대상입니다|해당합니다|면제됩니다|감면됩니다/;

/**
 * 가이드 절 읽기. 가이드 관리 화면은 절을 { heading, body }로만 저장하므로(strict), 절의 탭·원인·세목 배지는 facts.section_map에 둔다:
 * [{ index, tab, cause?, tax_kind, sources? }]. 지도에 없는 절·모양이 틀린 절은 렌더하지 않는다.
 */
export function readSections(sections: unknown, facts: unknown): LifecycleSection[] {
  if (!Array.isArray(sections) || !isObj(facts) || !Array.isArray(facts.section_map)) return [];
  const out: LifecycleSection[] = [];
  const seen = new Set<number>();
  for (const raw of facts.section_map) {
    if (!isObj(raw) || typeof raw.index !== "number" || !Number.isSafeInteger(raw.index) || seen.has(raw.index)) continue;
    const sec = sections[raw.index];
    if (!isObj(sec)) continue;
    const tab = raw.tab;
    if (!(LIFECYCLE_TABS as readonly unknown[]).includes(tab)) continue;
    const title = text(sec.heading);
    const body = text(sec.body);
    const taxKind = raw.tax_kind;
    if (!title || !body || (taxKind !== "local" && taxKind !== "national")) continue;
    const cause = raw.cause === undefined || raw.cause === null ? null : (LIFECYCLE_CAUSES as readonly unknown[]).includes(raw.cause) ? (raw.cause as LifecycleCause) : undefined;
    if (cause === undefined) continue;
    if (tab === "transfer" && (WON_AMOUNT.test(title) || WON_AMOUNT.test(body))) continue;
    seen.add(raw.index);
    const src = Array.isArray(raw.sources) ? raw.sources.flatMap((x) => (text(x) ? [text(x)!] : [])) : [];
    out.push({ tab: tab as LifecycleTab, cause, title, body, taxKind, sources: src });
  }
  return out;
}

export interface TransferChecklistItem {
  id: string;
  label: string;
}

export function readTransferChecklist(facts: unknown): TransferChecklistItem[] {
  if (!isObj(facts) || !Array.isArray(facts.transfer_checklist)) return [];
  const seen = new Set<string>();
  const out: TransferChecklistItem[] = [];
  for (const raw of facts.transfer_checklist) {
    if (!isObj(raw)) continue;
    const id = text(raw.id);
    const label = text(raw.label);
    if (!id || !label || seen.has(id) || ASSERTIVE.test(label)) continue;
    seen.add(id);
    out.push({ id, label });
  }
  return out;
}

export interface CauseSlot {
  cause: LifecycleCause;
  label: string;
  sections: LifecycleSection[];
  /** 상속·증여 칸은 1단계 안내 페이지로 잇는다. 매매는 null */
  guideHref: string | null;
}

export interface LifecycleTabView {
  tab: LifecycleTab;
  label: string;
  /** 취득 탭은 원인 3칸, 다른 탭은 빈 배열 */
  causes: CauseSlot[];
  sections: LifecycleSection[];
}

export interface LifecycleView {
  tabs: LifecycleTabView[];
  checklist: TransferChecklistItem[];
}

/** 공개된 가이드 버전(sections·facts) -> 탭 화면. 가이드가 없으면 호출하는 쪽이 화면을 열지 않는다 */
export function buildLifecycleView(guide: { sections: unknown; facts: unknown }): LifecycleView {
  const all = readSections(guide.sections, guide.facts);
  const tabs = LIFECYCLE_TABS.map((tab): LifecycleTabView => {
    const inTab = all.filter((s) => s.tab === tab);
    if (tab !== "acquire") return { tab, label: LIFECYCLE_TAB_LABEL[tab], causes: [], sections: inTab };
    return {
      tab,
      label: LIFECYCLE_TAB_LABEL[tab],
      causes: LIFECYCLE_CAUSES.map((cause) => ({ cause, label: LIFECYCLE_CAUSE_LABEL[cause], sections: inTab.filter((s) => s.cause === cause), guideHref: cause === "PAID" ? null : INHERITANCE_GIFT_HREF })),
      sections: inTab.filter((s) => s.cause === null),
    };
  });
  return { tabs, checklist: readTransferChecklist(guide.facts) };
}
