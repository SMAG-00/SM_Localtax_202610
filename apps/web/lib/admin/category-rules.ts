// 분야 체계 편집 규칙 (CAT-01) — 순수 모듈. 서버(API 입력 검사)와 화면(폼 검사)이 같이 쓴다.
//  · 허브 = 4대 분야(section)로 고정. 하위 분야(categories 행)의 이름·주소(slug)·소개·순서·공개·면책 대상·「지방세로 읽기」 필수만 고친다.
//  · 고치기에서 분야(허브)는 바꿀 수 없다 — 기사·대응표가 (하위 분야, 분야) 짝으로 참조한다.
//  · 발행 판정이 주소로 찾는 하위 분야(지방세 > 개정 트래커 amendments — CAT-04)는 주소를 바꿀 수 없다.
import { AMENDMENT_CATEGORY_SLUG, SECTIONS } from "@ltr/editorial";
import { blank, type FieldErrors } from "./form-utils";

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };
type Obj = Record<string, unknown>;

/** DB check 제약과 같은 주소 모양 */
export const CATEGORY_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/**
 * 분야별로 하위 분야 주소로 쓸 수 없는 이름 — 같은 자리의 화면 경로와 겹친다 (realestate/weekly = /realestate/weekly 이번 주 재테크 포인트, W10-i).
 * 지자체뉴스(local)의 weekly(금주 핫뉴스)는 기존 하위 분야라 막지 않는다. DB 제약 categories_slug_not_reserved와 같다
 */
export const RESERVED_CATEGORY_SLUGS: readonly { section: string; slug: string }[] = [{ section: "realestate", slug: "weekly" }];

export function reservedSlugBlocked(section: string, slug: string): string | null {
  return RESERVED_CATEGORY_SLUGS.some((r) => r.section === section && r.slug === slug)
    ? `'${slug}'은 ${SECTION_PATHS[section] ?? section}/${slug} 화면 주소라 이 분야의 하위 분야 주소로 쓸 수 없습니다`
    : null;
}
const SECTION_PATHS: Record<string, string> = { tax: "/tax", realestate: "/realestate", finance: "/finance", local: "/local" };
export const CATEGORY_LIMITS = { name: 40, slug: 60, intro: 500, sort: 100_000 } as const;

/** 발행 판정이 주소로 찾는 하위 분야 — 주소를 바꾸면 판정이 조용히 빠진다 */
const RULE_BOUND: readonly { section: string; slug: string; reason: string }[] = [
  {
    section: "tax",
    slug: AMENDMENT_CATEGORY_SLUG,
    reason: "개정 브리핑 발행 판정(CAT-04 — 연결 트래커 필수)이 이 주소로 개정 트래커 분야를 찾습니다 — 주소는 바꿀 수 없고 이름·소개만 고칩니다",
  },
];

export function slugChangeBlocked(current: { section: string; slug: string }, nextSlug: string): string | null {
  if (nextSlug === current.slug) return null;
  return RULE_BOUND.find((r) => r.section === current.section && r.slug === current.slug)?.reason ?? null;
}

const SECTION_LIST = SECTIONS.join("·");
const isSection = (v: unknown): v is (typeof SECTIONS)[number] => typeof v === "string" && (SECTIONS as readonly string[]).includes(v);

const FIELDS = [
  ["section", "section"],
  ["slug", "slug"],
  ["name", "name"],
  ["intro", "intro"],
  ["sort", "sort"],
  ["visible", "visible"],
  ["needsDisclaimer", "needs_disclaimer"],
  ["needsTaxLens", "needs_tax_lens"],
] as const;

/** API 입력(camelCase) → categories 칸. create는 분야·주소·이름 필수, patch는 분야를 받지 않는다 */
export function parseCategoryInput(raw: Obj, mode: "create" | "patch"): Result<Obj> {
  const errors: string[] = [];
  const out: Obj = {};
  const known = new Set<string>(FIELDS.map(([k]) => k));
  for (const key of Object.keys(raw)) if (!known.has(key)) errors.push(`category.${key}: 모르는 칸입니다`);
  const required = mode === "create" ? ["section", "slug", "name"] : [];
  for (const [key, column] of FIELDS) {
    const v = raw[key];
    const at = `category.${key}`;
    if (v === undefined) {
      if (required.includes(key)) errors.push(`${at}: 필요합니다`);
      continue;
    }
    switch (key) {
      case "section":
        if (mode === "patch") errors.push(`${at}: 분야(허브)는 바꿀 수 없습니다 — 그 분야에 새 하위 분야를 만드세요`);
        else if (!isSection(v)) errors.push(`${at}: ${SECTION_LIST} 중 하나여야 합니다`);
        else out[column] = v;
        break;
      case "slug":
        if (typeof v !== "string" || !CATEGORY_SLUG.test(v) || v.length > CATEGORY_LIMITS.slug) {
          errors.push(`${at}: 영문 소문자·숫자·'-'로 된 ${CATEGORY_LIMITS.slug}자 이하 주소여야 합니다 (예: trust-pf)`);
        } else out[column] = v;
        break;
      case "name":
        if (typeof v !== "string") errors.push(`${at}: 글자여야 합니다`);
        else if (v.trim() === "") errors.push(`${at}: 비울 수 없습니다`);
        else if ([...v.trim()].length > CATEGORY_LIMITS.name) errors.push(`${at}: ${CATEGORY_LIMITS.name}자 이하여야 합니다`);
        else out[column] = v.trim();
        break;
      case "intro":
        if (v === null) out[column] = null;
        else if (typeof v !== "string" || [...v].length > CATEGORY_LIMITS.intro) errors.push(`${at}: ${CATEGORY_LIMITS.intro}자 이하 글자이거나 null이어야 합니다`);
        else out[column] = v.trim() === "" ? null : v.trim();
        break;
      case "sort":
        if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > CATEGORY_LIMITS.sort) errors.push(`${at}: 0~${CATEGORY_LIMITS.sort} 정수여야 합니다`);
        else out[column] = v;
        break;
      default:
        if (typeof v !== "boolean") errors.push(`${at}: true/false여야 합니다`);
        else out[column] = v;
    }
  }
  if (mode === "patch" && errors.length === 0 && Object.keys(out).length === 0) errors.push("category: 바꿀 칸이 없습니다");
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

/** 순서 바꾸기 입력 — { section, ids: 그 분야 하위 분야 번호를 새 순서대로 } */
export function parseCategoryOrder(raw: Obj): Result<{ section: string; ids: number[] }> {
  const errors: string[] = [];
  for (const key of Object.keys(raw)) if (key !== "section" && key !== "ids") errors.push(`order.${key}: 모르는 칸입니다`);
  if (!isSection(raw.section)) errors.push(`order.section: ${SECTION_LIST} 중 하나여야 합니다`);
  const ids = raw.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200 || !ids.every((x) => typeof x === "number" && Number.isSafeInteger(x) && x >= 1)) {
    errors.push("order.ids: 1개 이상 번호 목록이어야 합니다");
  } else if (new Set(ids).size !== ids.length) errors.push("order.ids: 같은 번호가 두 번 있습니다");
  return errors.length ? { ok: false, errors } : { ok: true, value: { section: raw.section as string, ids: ids as number[] } };
}

/** 새 순서(10 간격) — 그 분야의 하위 분야 전부를 받아야 한다. 돌려주는 것은 sort가 바뀌는 행만 */
export function orderPlan(rows: readonly { id: number; sort: number }[], ids: readonly number[]): Result<{ id: number; sort: number }[]> {
  const current = new Set(rows.map((r) => r.id));
  if (ids.length !== rows.length || !ids.every((id) => current.has(id))) {
    return { ok: false, errors: [`order.ids: 이 분야의 하위 분야 전부(${rows.length}개)를 순서대로 보내야 합니다`] };
  }
  const sortOf = new Map(rows.map((r) => [r.id, r.sort]));
  const changes = ids.map((id, i) => ({ id, sort: (i + 1) * 10 })).filter((c) => sortOf.get(c.id) !== c.sort);
  return { ok: true, value: changes };
}

/** 한 칸 위(-1)·아래(+1)로 — 끝에서는 그대로 */
export function moveInOrder(ids: readonly number[], id: number, direction: -1 | 1): number[] {
  const list = [...ids];
  const i = list.indexOf(id);
  const j = i + direction;
  if (i === -1 || j < 0 || j >= list.length) return list;
  [list[i], list[j]] = [list[j]!, list[i]!];
  return list;
}

export interface CategoryForm {
  section: string;
  name: string;
  slug: string;
  intro: string;
  visible: boolean;
  needsDisclaimer: boolean;
  needsTaxLens: boolean;
}

/** 화면 폼 → 요청 본문. 칸 오류의 키는 `${base}-name` 같은 칸 id */
export function categoryFormToBody(
  form: CategoryForm,
  mode: "create" | "patch",
  base = "cat",
): { ok: true; body: Record<string, unknown> } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  if (blank(form.name)) errors[`${base}-name`] = "이름을 적어 주세요";
  else if ([...form.name.trim()].length > CATEGORY_LIMITS.name) errors[`${base}-name`] = `이름은 ${CATEGORY_LIMITS.name}자 이하로 씁니다`;
  if (!CATEGORY_SLUG.test(form.slug.trim()) || form.slug.trim().length > CATEGORY_LIMITS.slug) errors[`${base}-slug`] = "주소는 영문 소문자·숫자·'-'만 씁니다 (예: trust-pf)";
  if ([...form.intro].length > CATEGORY_LIMITS.intro) errors[`${base}-intro`] = `소개는 ${CATEGORY_LIMITS.intro}자 이하로 씁니다`;
  if (mode === "create" && !isSection(form.section)) errors[`${base}-section`] = "분야를 골라 주세요";
  if (Object.keys(errors).length) return { ok: false, errors };
  const body: Record<string, unknown> = {
    ...(mode === "create" ? { section: form.section } : {}),
    name: form.name.trim(),
    slug: form.slug.trim(),
    intro: blank(form.intro) ? null : form.intro.trim(),
    visible: form.visible,
    needsDisclaimer: form.needsDisclaimer,
    needsTaxLens: form.needsTaxLens,
  };
  return { ok: true, body };
}
