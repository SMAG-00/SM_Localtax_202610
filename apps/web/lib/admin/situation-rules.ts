// 상황 카드(situations) 규칙 (UX-05 · FAM-02 · PRD-01A 1.3 감수 대상) — 순수 모듈. 상황 카드 API와 /admin/situations 화면이 같이 쓴다.
//  · '먼저 확인할 것'은 정확히 3개 — 2개·4개는 화면이 API를 부르기 전에 막고, 서버도 422로 막는다(DB는 공개 행만 정확히 3개, 3개 초과는 늘 거부).
//    백오피스는 초안도 3개로만 저장한다 — 공개 전에 감수할 문장이 정해져 있어야 감수 서명을 받는다 (설계 9장)
//  · 감수 대상 칸(먼저 확인할 것·일반적 체크리스트·자주 틀리는 점)을 고치면 DB가 감수 기록을 지운다 — 공개 중인 상황은 먼저 내려야 고칠 수 있다
//  · 허브 자리(hub_slot)는 1..허브 상한(settings.hub_situation_limit, 초기값 4), 분야 안에서 겹치지 않는다 — 상한이 찬 허브에 5번째 카드는 거부
//  · 주소(slug)는 만들 때 한 번 정하고 바꾸지 않는다 (영속 주소 /situations/[slug])
import { PICTOGRAM_NAMES, type PictogramName } from "@ltr/ui";
import { blank, splitLines, type FieldErrors } from "./form-utils";

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };
type Obj = Record<string, unknown>;

export const SITUATION_SECTIONS = ["tax", "realestate", "finance", "local"] as const;
export type SituationSection = (typeof SITUATION_SECTIONS)[number];
export const isSituationSection = (v: unknown): v is SituationSection => typeof v === "string" && (SITUATION_SECTIONS as readonly string[]).includes(v);

/** 먼저 확인할 것 — 정확히 이 수 (UX-05 '정확히 3개가 아니면 발행되지 않는다') */
export const CHECKS_COUNT = 3;
export const MISTAKES_MAX = 3;
export const CHECKLIST_ITEMS_MAX = 10;
export const LINKED_IDS_MAX = 20;
/** 화면 안내 문장 60자 이하 (PRD-00 8.2 R8) */
export const TEXT_MAX = 60;
export const NOTE_MAX = 180;
export const LONG_MAX = 120;
const SORT_MAX = 100_000;

/** 일반적 체크리스트 고지 (FAM-02 — 감수본 문구). 화면이 체크리스트를 쓰기 시작하면 이 문장을 채워 둔다 */
export const CHECKLIST_NOTICE = "일반적인 안내이며 개별 사건의 확정 안내가 아닙니다";

/** 연결 칸 — 다음 행동 버튼이 되는 기능 키 (기능이 열리면 상황 페이지에 붙는다, UX-05) */
export const TOOL_FEATURES = ["sm_calculator", "expert_finder", "self_calculator", "taxbot"] as const;
export type ToolFeature = (typeof TOOL_FEATURES)[number];
export const TOOL_FEATURE_LABELS: Readonly<Record<ToolFeature, string>> = {
  sm_calculator: "SM 계산기 카드",
  expert_finder: "전문가 찾기",
  self_calculator: "자체 계산기 (2단계)",
  taxbot: "지방세봇 (4단계)",
};

export interface CheckInput {
  title: string;
  when?: string;
  note?: string;
}

/** 저장 값 (DB 칸 이름) */
export interface SituationContent {
  section: SituationSection;
  title: string;
  subtitle: string | null;
  pictogram: PictogramName;
  checks: CheckInput[];
  checklist: { items: string[]; notice: string } | null;
  mistakes: string[];
  article_ids: number[];
  solved_case_ids: number[];
  glossary_ids: number[];
  tool_links: { feature: ToolFeature }[];
  region_select: boolean;
  sort: number;
}

export interface SituationCreate extends SituationContent {
  slug: string;
}

/** 고치기 — 내용 칸(situation.edit)과 공개·허브 칸(situation.publish)을 나눠 돌려준다 */
export interface SituationPatch {
  content: Partial<SituationContent>;
  placement: { visible?: boolean; hub_slot?: number | null };
}

/** 감수 대상 칸 — 고치면 감수 기록이 지워진다 (DB situations_guard) */
export const REVIEWED_FIELDS = ["checks", "checklist", "mistakes"] as const satisfies readonly (keyof SituationContent)[];

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const isId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function text(raw: Obj, key: string, errors: string[], { required = false, max = TEXT_MAX } = {}): string | null | undefined {
  const v = raw[key];
  if (v === undefined) {
    if (required) errors.push(`situation.${key}: 필요합니다`);
    return undefined;
  }
  if (v === null && !required) return null;
  if (typeof v !== "string") {
    errors.push(`situation.${key}: 글자여야 합니다`);
    return undefined;
  }
  const t = v.trim();
  if (t === "") {
    if (required) errors.push(`situation.${key}: 비어 있습니다`);
    return required ? undefined : null;
  }
  if ([...t].length > max) errors.push(`situation.${key}: ${max}자 이하로 줄이세요`);
  return t;
}

/** 먼저 확인할 것 — 정확히 3개, 항목마다 제목 필수 */
export function checksErrors(raw: unknown): string[] {
  if (!Array.isArray(raw)) return ["situation.checks: 먼저 확인할 것 목록이어야 합니다"];
  const errors: string[] = [];
  if (raw.length !== CHECKS_COUNT) errors.push(`situation.checks: 먼저 확인할 것은 정확히 ${CHECKS_COUNT}개여야 합니다 — 지금 ${raw.length}개 (UX-05)`);
  raw.forEach((c, i) => {
    if (!isObj(c)) return errors.push(`situation.checks[${i}]: 항목 모양이 틀립니다`);
    for (const key of Object.keys(c)) if (!["title", "when", "note"].includes(key)) errors.push(`situation.checks[${i}].${key}: 모르는 칸입니다`);
    if (typeof c.title !== "string" || c.title.trim() === "") errors.push(`situation.checks[${i}].title: 확인할 것 ${i + 1}의 제목이 비었습니다`);
    else if ([...c.title.trim()].length > TEXT_MAX) errors.push(`situation.checks[${i}].title: ${TEXT_MAX}자 이하로 줄이세요`);
    if (c.when !== undefined && (typeof c.when !== "string" || [...c.when.trim()].length > 20)) errors.push(`situation.checks[${i}].when: 20자 이하 글자여야 합니다`);
    if (c.note !== undefined && (typeof c.note !== "string" || [...c.note.trim()].length > NOTE_MAX)) errors.push(`situation.checks[${i}].note: ${NOTE_MAX}자 이하 글자여야 합니다`);
  });
  return errors;
}

function readChecks(raw: unknown[]): CheckInput[] {
  return raw.map((c) => {
    const o = c as Obj;
    const when = typeof o.when === "string" && o.when.trim() ? o.when.trim() : undefined;
    const note = typeof o.note === "string" && o.note.trim() ? o.note.trim() : undefined;
    return { title: (o.title as string).trim(), ...(when ? { when } : {}), ...(note ? { note } : {}) };
  });
}

function ids(raw: Obj, key: string, errors: string[]): number[] | undefined {
  const v = raw[key];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || !v.every(isId)) {
    errors.push(`situation.${key}: 번호 목록이어야 합니다`);
    return undefined;
  }
  if (v.length > LINKED_IDS_MAX) errors.push(`situation.${key}: ${LINKED_IDS_MAX}개까지입니다`);
  if (new Set(v).size !== v.length) errors.push(`situation.${key}: 같은 번호가 두 번 있습니다`);
  return v as number[];
}

const CONTENT_KEYS = ["section", "title", "subtitle", "pictogram", "checks", "checklist", "mistakes", "articleIds", "solvedCaseIds", "glossaryIds", "toolLinks", "regionSelect", "sort"] as const;
const PLACEMENT_KEYS = ["visible", "hubSlot"] as const;

function readContent(raw: Obj, errors: string[], mode: "create" | "patch"): Partial<SituationContent> {
  const out: Partial<SituationContent> = {};
  const req = mode === "create";
  if (raw.section !== undefined || req) {
    if (isSituationSection(raw.section)) out.section = raw.section;
    else errors.push("situation.section: 4대 분야(tax·realestate·finance·local) 중 하나여야 합니다 — 분야 없이 저장할 수 없습니다 (UX-05)");
  }
  const title = text(raw, "title", errors, { required: req || raw.title !== undefined });
  if (title) out.title = title;
  const subtitle = text(raw, "subtitle", errors);
  if (subtitle !== undefined) out.subtitle = subtitle;
  if (raw.pictogram !== undefined || req) {
    if (typeof raw.pictogram === "string" && (PICTOGRAM_NAMES as readonly string[]).includes(raw.pictogram)) out.pictogram = raw.pictogram as PictogramName;
    else errors.push("situation.pictogram: 픽토그램 목록(packages/ui)에서 골라야 합니다");
  }
  if (raw.checks !== undefined || req) {
    const problems = checksErrors(raw.checks);
    if (problems.length) errors.push(...problems);
    else out.checks = readChecks(raw.checks as unknown[]);
  }
  if (raw.checklist !== undefined) {
    if (raw.checklist === null) out.checklist = null;
    else if (!isObj(raw.checklist) || !Array.isArray(raw.checklist.items)) errors.push("situation.checklist: { items, notice } 모양이거나 null이어야 합니다");
    else {
      const items = raw.checklist.items.map((i) => (typeof i === "string" ? i.trim() : ""));
      const notice = typeof raw.checklist.notice === "string" ? raw.checklist.notice.trim() : "";
      if (items.length === 0 || items.some((i) => i === "")) errors.push("situation.checklist.items: 빈 항목 없이 1개 이상이어야 합니다");
      if (items.length > CHECKLIST_ITEMS_MAX) errors.push(`situation.checklist.items: ${CHECKLIST_ITEMS_MAX}개까지입니다`);
      if (items.some((i) => [...i].length > LONG_MAX)) errors.push(`situation.checklist.items: 항목마다 ${LONG_MAX}자 이하로 줄이세요`);
      if (notice === "") errors.push("situation.checklist.notice: 일반적 체크리스트에는 고지 문장이 필요합니다 (FAM-02)");
      else if ([...notice].length > LONG_MAX) errors.push(`situation.checklist.notice: ${LONG_MAX}자 이하로 줄이세요`);
      out.checklist = { items, notice };
    }
  }
  if (raw.mistakes !== undefined) {
    const m = raw.mistakes;
    if (!Array.isArray(m) || !m.every((x) => typeof x === "string" && x.trim() !== "")) errors.push("situation.mistakes: 빈 항목 없는 글자 목록이어야 합니다");
    else if (m.length > MISTAKES_MAX) errors.push(`situation.mistakes: 자주 틀리는 점은 ${MISTAKES_MAX}개까지입니다`);
    else if (m.some((x) => [...(x as string).trim()].length > LONG_MAX)) errors.push(`situation.mistakes: 항목마다 ${LONG_MAX}자 이하로 줄이세요`);
    else out.mistakes = (m as string[]).map((x) => x.trim());
  }
  const articles = ids(raw, "articleIds", errors);
  if (articles) out.article_ids = articles;
  const solved = ids(raw, "solvedCaseIds", errors);
  if (solved) out.solved_case_ids = solved;
  const glossary = ids(raw, "glossaryIds", errors);
  if (glossary) out.glossary_ids = glossary;
  if (raw.toolLinks !== undefined) {
    const t = raw.toolLinks;
    if (!Array.isArray(t) || !t.every((f) => (TOOL_FEATURES as readonly unknown[]).includes(f))) errors.push(`situation.toolLinks: ${TOOL_FEATURES.join("·")} 중에서 고릅니다`);
    else out.tool_links = [...new Set(t as ToolFeature[])].map((feature) => ({ feature }));
  }
  if (raw.regionSelect !== undefined) {
    if (typeof raw.regionSelect === "boolean") out.region_select = raw.regionSelect;
    else errors.push("situation.regionSelect: 참/거짓이어야 합니다");
  }
  if (raw.sort !== undefined) {
    if (typeof raw.sort === "number" && Number.isInteger(raw.sort) && raw.sort >= 0 && raw.sort <= SORT_MAX) out.sort = raw.sort;
    else errors.push(`situation.sort: 0~${SORT_MAX} 정수여야 합니다`);
  }
  return out;
}

/** 만들기 본문 → 저장 값. 공개·허브 자리는 만들 때 받지 않는다 (감수 서명 뒤 편집 책임자가 한다) */
export function parseSituationCreate(raw: Obj): Result<SituationCreate> {
  const errors: string[] = [];
  const known = new Set<string>(["slug", ...CONTENT_KEYS]);
  for (const key of Object.keys(raw)) {
    if (PLACEMENT_KEYS.includes(key as (typeof PLACEMENT_KEYS)[number])) errors.push(`situation.${key}: 공개·허브 자리는 만든 뒤 감수 서명을 받고 정합니다`);
    else if (!known.has(key)) errors.push(`situation.${key}: 모르는 칸입니다`);
  }
  if (typeof raw.slug !== "string" || !SLUG.test(raw.slug) || raw.slug.length > 80) errors.push("situation.slug: 영문 소문자·숫자·'-'로 된 주소가 필요합니다 (80자 이하)");
  const content = readContent(raw, errors, "create");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      slug: raw.slug as string,
      section: content.section!,
      title: content.title!,
      subtitle: content.subtitle ?? null,
      pictogram: content.pictogram!,
      checks: content.checks!,
      checklist: content.checklist ?? null,
      mistakes: content.mistakes ?? [],
      article_ids: content.article_ids ?? [],
      solved_case_ids: content.solved_case_ids ?? [],
      glossary_ids: content.glossary_ids ?? [],
      tool_links: content.tool_links ?? [],
      region_select: content.region_select ?? false,
      sort: content.sort ?? 0,
    },
  };
}

/** 고치기 본문 → 바꿀 값. 주소는 못 바꾼다 */
export function parseSituationPatch(raw: Obj): Result<SituationPatch> {
  const errors: string[] = [];
  const known = new Set<string>([...CONTENT_KEYS, ...PLACEMENT_KEYS]);
  for (const key of Object.keys(raw)) {
    if (key === "slug") errors.push("situation.slug: 주소는 만든 뒤 바꾸지 않습니다 (영속 주소)");
    else if (!known.has(key)) errors.push(`situation.${key}: 모르는 칸입니다`);
  }
  const content = readContent(raw, errors, "patch");
  const placement: SituationPatch["placement"] = {};
  if (raw.visible !== undefined) {
    if (typeof raw.visible === "boolean") placement.visible = raw.visible;
    else errors.push("situation.visible: 참/거짓이어야 합니다");
  }
  if (raw.hubSlot !== undefined) {
    if (raw.hubSlot === null || isId(raw.hubSlot)) placement.hub_slot = raw.hubSlot as number | null;
    else errors.push("situation.hubSlot: 1 이상 자리 번호이거나 null(허브에서 빼기)이어야 합니다");
  }
  if (errors.length) return { ok: false, errors };
  if (Object.keys(content).length === 0 && Object.keys(placement).length === 0) return { ok: false, errors: ["situation: 바꿀 칸이 없습니다"] };
  return { ok: true, value: { content, placement } };
}

/** 칸 순서와 상관없는 JSON 글자 — DB(jsonb)는 객체 칸 순서를 바꿔 저장하므로 값으로만 비교한다 (DB 트리거의 is distinct from과 같은 뜻) */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isObj(value)) {
    return `{${Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** 고친 칸 가운데 감수 대상이 바뀌었는가 (같은 값을 다시 보내면 바뀌지 않은 것) */
export function changesReviewedFields(before: Partial<Record<(typeof REVIEWED_FIELDS)[number], unknown>>, content: Partial<SituationContent>): boolean {
  return REVIEWED_FIELDS.some((k) => content[k] !== undefined && stableJson(content[k]) !== stableJson(before[k] ?? (k === "checklist" ? null : [])));
}

// ── 허브 자리 (UX-05 '허브 상한을 넘는 5번째 카드 지정은 CMS가 막는다') ─────────────

export interface HubSlotRow {
  id: number;
  section: string;
  hub_slot: number | null;
}

/** 그 분야 허브에 자리를 가진 상황 (자리 순) */
export function hubRows<T extends HubSlotRow>(rows: readonly T[], section: string): T[] {
  return rows.filter((r) => r.section === section && r.hub_slot !== null).sort((a, b) => (a.hub_slot ?? 0) - (b.hub_slot ?? 0));
}

/** 비어 있는 첫 자리 — 상한까지 다 찼으면 null */
export function nextFreeSlot(rows: readonly HubSlotRow[], section: string, limit: number): number | null {
  const taken = new Set(hubRows(rows, section).map((r) => r.hub_slot));
  for (let slot = 1; slot <= limit; slot++) if (!taken.has(slot)) return slot;
  return null;
}

/** 허브 자리 지정 검사 — 상한 초과(5번째 카드)·자리 겹침이면 문장, 괜찮으면 null. 자기 자신(id)은 세지 않는다 */
export function hubSlotError(rows: readonly HubSlotRow[], target: { id: number; section: string }, slot: number, limit: number): string | null {
  const others = hubRows(rows, target.section).filter((r) => r.id !== target.id);
  if (others.length >= limit) {
    return `허브 상황 카드는 분야마다 ${limit}장까지입니다 — 이 분야 허브에 이미 ${others.length}장이 있어 ${others.length + 1}번째 카드는 둘 수 없습니다. 다른 카드를 허브에서 뺀 뒤 넣으세요 (UX-05)`;
  }
  if (slot > limit) return `허브 자리는 1~${limit}번입니다 — ${slot}번 자리는 없습니다 (UX-05)`;
  if (others.some((r) => r.hub_slot === slot)) return `이 분야 허브의 ${slot}번 자리에 이미 다른 상황 카드가 있습니다 — 빈 자리를 고르거나 순서 바꾸기를 쓰세요`;
  return null;
}

/** 허브 순서 바꾸기 — 그 분야 허브 카드 전부를 새 순서대로 받아 자리 1..n */
export function parseHubOrder(raw: Obj): Result<{ section: SituationSection; ids: number[] }> {
  const errors: string[] = [];
  for (const key of Object.keys(raw)) if (key !== "section" && key !== "ids") errors.push(`order.${key}: 모르는 칸입니다`);
  if (!isSituationSection(raw.section)) errors.push("order.section: 4대 분야 중 하나여야 합니다");
  const list = raw.ids;
  if (!Array.isArray(list) || list.length === 0 || list.length > 20 || !list.every(isId)) errors.push("order.ids: 1개 이상 번호 목록이어야 합니다");
  else if (new Set(list).size !== list.length) errors.push("order.ids: 같은 번호가 두 번 있습니다");
  return errors.length ? { ok: false, errors } : { ok: true, value: { section: raw.section as SituationSection, ids: list as number[] } };
}

/** 순서 계획 — 보낸 번호가 그 분야 허브 카드 전부와 같아야 한다. 자리가 바뀌는 행만 */
export function hubOrderPlan(current: readonly HubSlotRow[], ids: readonly number[]): Result<{ id: number; slot: number }[]> {
  const set = new Set(current.map((r) => r.id));
  if (ids.length !== current.length || !ids.every((id) => set.has(id))) return { ok: false, errors: [`order.ids: 이 분야 허브 카드 전부(${current.length}장)를 순서대로 보내야 합니다`] };
  const slotOf = new Map(current.map((r) => [r.id, r.hub_slot]));
  return { ok: true, value: ids.map((id, i) => ({ id, slot: i + 1 })).filter((c) => slotOf.get(c.id) !== c.slot) };
}

// ── 화면 폼 ───────────────────────────────────────────────

export interface SituationForm {
  slug: string;
  section: string;
  title: string;
  subtitle: string;
  pictogram: string;
  checks: { title: string; when: string; note: string }[];
  /** 일반적 체크리스트 — 한 줄에 하나 */
  checklistItems: string;
  checklistNotice: string;
  /** 자주 틀리는 점 — 한 줄에 하나 */
  mistakes: string;
  /** 번호 — 쉼표나 줄바꿈으로 */
  articleIds: string;
  solvedCaseIds: string;
  glossaryIds: string;
  toolLinks: string[];
  regionSelect: boolean;
}

export const emptyCheck = () => ({ title: "", when: "", note: "" });

export function emptySituationForm(): SituationForm {
  return {
    slug: "",
    section: "",
    title: "",
    subtitle: "",
    pictogram: "",
    checks: [emptyCheck(), emptyCheck(), emptyCheck()],
    checklistItems: "",
    checklistNotice: CHECKLIST_NOTICE,
    mistakes: "",
    articleIds: "",
    solvedCaseIds: "",
    glossaryIds: "",
    toolLinks: [],
    regionSelect: false,
  };
}

/** 저장된 행 → 폼 */
export function situationToForm(row: {
  slug: string;
  section: string;
  title: string;
  subtitle: string | null;
  pictogram: string;
  checks: unknown;
  checklist: unknown;
  mistakes: string[];
  article_ids: number[];
  solved_case_ids: number[];
  glossary_ids: number[];
  tool_links: unknown;
  region_select: boolean;
}): SituationForm {
  const checks = Array.isArray(row.checks)
    ? row.checks.map((c) => ({ title: String((c as Obj)?.title ?? ""), when: String((c as Obj)?.when ?? ""), note: String((c as Obj)?.note ?? "") }))
    : [];
  const checklist = isObj(row.checklist) ? row.checklist : null;
  return {
    slug: row.slug,
    section: row.section,
    title: row.title,
    subtitle: row.subtitle ?? "",
    pictogram: row.pictogram,
    checks,
    checklistItems: Array.isArray(checklist?.items) ? checklist.items.join("\n") : "",
    checklistNotice: typeof checklist?.notice === "string" ? checklist.notice : CHECKLIST_NOTICE,
    mistakes: (row.mistakes ?? []).join("\n"),
    articleIds: (row.article_ids ?? []).join(", "),
    solvedCaseIds: (row.solved_case_ids ?? []).join(", "),
    glossaryIds: (row.glossary_ids ?? []).join(", "),
    toolLinks: Array.isArray(row.tool_links) ? row.tool_links.flatMap((t) => (isObj(t) && typeof t.feature === "string" ? [t.feature] : [])) : [],
    regionSelect: row.region_select,
  };
}

function idList(textValue: string, field: string, errors: FieldErrors): number[] {
  const parts = textValue.split(/[\s,]+/).filter(Boolean);
  const out: number[] = [];
  for (const p of parts) {
    if (!/^[1-9]\d{0,15}$/.test(p)) {
      errors[field] = `번호만 쉼표로 나눠 적으세요 — '${p}'는 번호가 아닙니다`;
      return [];
    }
    out.push(Number(p));
  }
  if (new Set(out).size !== out.length) errors[field] = "같은 번호가 두 번 있습니다";
  if (out.length > LINKED_IDS_MAX) errors[field] = `${LINKED_IDS_MAX}개까지입니다`;
  return out;
}

/** 칸 id — 화면과 시험이 같은 이름을 쓴다 */
export const FIELD = {
  slug: "situation-slug",
  section: "situation-section",
  title: "situation-title",
  subtitle: "situation-subtitle",
  pictogram: "situation-pictogram",
  checks: "situation-checks",
  check: (i: number, part: "title" | "when" | "note") => `situation-check-${i}-${part}`,
  checklistItems: "situation-checklist-items",
  checklistNotice: "situation-checklist-notice",
  mistakes: "situation-mistakes",
  articleIds: "situation-article-ids",
  solvedCaseIds: "situation-solved-ids",
  glossaryIds: "situation-glossary-ids",
} as const;

/**
 * 폼 → 요청 본문. 칸 오류의 키는 FIELD의 칸 id. 먼저 확인할 것이 2개·4개면 묶음 칸(situation-checks) 오류 — API를 부르지 않는다.
 * mode=patch는 주소를 보내지 않는다
 */
export function situationFormToBody(form: SituationForm, mode: "create" | "patch"): { ok: true; body: Obj } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  if (mode === "create" && (!SLUG.test(form.slug.trim()) || form.slug.trim().length > 80)) errors[FIELD.slug] = "영문 소문자·숫자·'-'로 된 주소를 적으세요 (예: car-sold)";
  if (!isSituationSection(form.section)) errors[FIELD.section] = "분야를 골라 주세요 — 분야 없이 저장할 수 없습니다";
  if (blank(form.title)) errors[FIELD.title] = "상황 한 문장을 적으세요 (예: 차를 팔았어요)";
  else if ([...form.title.trim()].length > TEXT_MAX) errors[FIELD.title] = `${TEXT_MAX}자 이하로 줄이세요`;
  if ([...form.subtitle.trim()].length > TEXT_MAX) errors[FIELD.subtitle] = `${TEXT_MAX}자 이하로 줄이세요`;
  if (!(PICTOGRAM_NAMES as readonly string[]).includes(form.pictogram)) errors[FIELD.pictogram] = "픽토그램을 골라 주세요";
  if (form.checks.length !== CHECKS_COUNT) errors[FIELD.checks] = `먼저 확인할 것은 정확히 ${CHECKS_COUNT}개여야 합니다 — 지금 ${form.checks.length}개입니다`;
  form.checks.forEach((c, i) => {
    if (blank(c.title)) errors[FIELD.check(i, "title")] = `확인할 것 ${i + 1}의 제목을 적으세요`;
    else if ([...c.title.trim()].length > TEXT_MAX) errors[FIELD.check(i, "title")] = `${TEXT_MAX}자 이하로 줄이세요`;
    if ([...c.when.trim()].length > 20) errors[FIELD.check(i, "when")] = "20자 이하로 줄이세요";
    if ([...c.note.trim()].length > NOTE_MAX) errors[FIELD.check(i, "note")] = `${NOTE_MAX}자 이하로 줄이세요`;
  });
  const checklistItems = splitLines(form.checklistItems);
  if (checklistItems.length > CHECKLIST_ITEMS_MAX) errors[FIELD.checklistItems] = `${CHECKLIST_ITEMS_MAX}개까지입니다`;
  if (checklistItems.length > 0 && blank(form.checklistNotice)) errors[FIELD.checklistNotice] = "일반적 체크리스트에는 고지 문장이 필요합니다";
  const mistakes = splitLines(form.mistakes);
  if (mistakes.length > MISTAKES_MAX) errors[FIELD.mistakes] = `자주 틀리는 점은 ${MISTAKES_MAX}개까지입니다 — 지금 ${mistakes.length}개`;
  const articleIds = idList(form.articleIds, FIELD.articleIds, errors);
  const solvedCaseIds = idList(form.solvedCaseIds, FIELD.solvedCaseIds, errors);
  const glossaryIds = idList(form.glossaryIds, FIELD.glossaryIds, errors);
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    body: {
      ...(mode === "create" ? { slug: form.slug.trim() } : {}),
      section: form.section,
      title: form.title.trim(),
      subtitle: blank(form.subtitle) ? null : form.subtitle.trim(),
      pictogram: form.pictogram,
      checks: form.checks.map((c) => ({ title: c.title.trim(), ...(blank(c.when) ? {} : { when: c.when.trim() }), ...(blank(c.note) ? {} : { note: c.note.trim() }) })),
      checklist: checklistItems.length ? { items: checklistItems, notice: form.checklistNotice.trim() } : null,
      mistakes,
      articleIds,
      solvedCaseIds,
      glossaryIds,
      toolLinks: form.toolLinks.filter((f) => (TOOL_FEATURES as readonly string[]).includes(f)),
      regionSelect: form.regionSelect,
    },
  };
}
