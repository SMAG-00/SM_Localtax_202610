// 기자·기고자 등록부 입력 규칙 (F2 · NAV-19) — people 표의 등록부 칸만 받는다. 순수 함수 (시험: people-rules.test.ts)
//  · 약력(bio_items)·동의서(consent_doc_version)는 받지 않는다 — 증빙 규칙(BR-01)은 /admin/brand가 맡는다
//  · registered_at은 서버(DB 기본값)가 정한다 — 입력으로 받지 않는다
export const PERSON_ROLES = ["reporter", "editor", "writer", "reviewer", "expert"] as const;
export type PersonRole = (typeof PERSON_ROLES)[number];
export const PERSON_ROLE_LABELS: Readonly<Record<PersonRole, string>> = { reporter: "기자", editor: "편집자", writer: "필자", reviewer: "감수자", expert: "전문가" };
export const EMPLOYMENTS = ["staff", "external"] as const;
export const EMPLOYMENT_LABELS = { staff: "편집국 소속", external: "외부 기고자" } as const;
export const PERSON_VISIBILITIES = ["public", "hidden"] as const;
export const PERSON_VISIBILITY_LABELS = { public: "공개", hidden: "비공개" } as const;

export const NAME_MAX = 60;
export const SLUG_MAX = 60;
export const TEXT_MAX = 200;
export const CONFLICTS_MAX = 1000;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PersonInput {
  name?: string;
  slug?: string;
  roles?: PersonRole[];
  employment?: "staff" | "external" | null;
  affiliation?: string | null;
  beat?: string | null;
  conflicts?: string | null;
  visibility?: "public" | "hidden";
  staff_user_id?: string | null;
}

export type PersonResult = { ok: true; value: PersonInput } | { ok: false; errors: string[] };

const KNOWN = new Set(["name", "slug", "roles", "employment", "affiliation", "beat", "conflicts", "visibility", "staff_user_id"]);

export function parsePersonInput(raw: Record<string, unknown>, mode: "create" | "patch"): PersonResult {
  const errors: string[] = [];
  const out: PersonInput = {};
  for (const k of Object.keys(raw)) if (!KNOWN.has(k)) errors.push(`${k}: 받지 않는 칸입니다${k === "bio_items" || k === "consent_doc_version" ? " — 약력·동의서는 브랜드 관리 화면에서 다룹니다" : ""}`);

  if (raw.name !== undefined) {
    const v = typeof raw.name === "string" ? raw.name.trim() : "";
    if (v === "") errors.push("name: 이름이 필요합니다");
    else if ([...v].length > NAME_MAX) errors.push(`name: ${NAME_MAX}자 이하여야 합니다`);
    else out.name = v;
  } else if (mode === "create") errors.push("name: 이름이 필요합니다");

  if (raw.slug !== undefined) {
    const v = typeof raw.slug === "string" ? raw.slug.trim() : "";
    if (!SLUG_RE.test(v) || v.length > SLUG_MAX) errors.push(`slug: 영문 소문자·숫자와 '-'만, ${SLUG_MAX}자 이하여야 합니다 (예: kim-reporter)`);
    else out.slug = v;
  } else if (mode === "create") errors.push("slug: 주소용 영문 이름이 필요합니다 (예: kim-reporter)");

  if (raw.roles !== undefined) {
    const v = raw.roles;
    if (!Array.isArray(v) || v.length === 0) errors.push(`roles: ${PERSON_ROLES.join("·")} 중 1개 이상 골라야 합니다`);
    else if (!v.every((x) => typeof x === "string" && (PERSON_ROLES as readonly string[]).includes(x))) errors.push(`roles: ${PERSON_ROLES.join("·")} 중에서만 고를 수 있습니다`);
    else out.roles = [...new Set(v as PersonRole[])];
  } else if (mode === "create") errors.push(`roles: ${PERSON_ROLES.join("·")} 중 1개 이상 골라야 합니다`);

  if (raw.employment !== undefined) {
    const v = raw.employment;
    if (v === null || v === "") out.employment = null;
    else if (typeof v === "string" && (EMPLOYMENTS as readonly string[]).includes(v)) out.employment = v as "staff" | "external";
    else errors.push("employment: staff(편집국 소속) 또는 external(외부 기고자)이어야 합니다");
  }

  for (const [key, max] of [["affiliation", TEXT_MAX], ["beat", TEXT_MAX], ["conflicts", CONFLICTS_MAX]] as const) {
    const v = raw[key];
    if (v === undefined) continue;
    if (v !== null && typeof v !== "string") {
      errors.push(`${key}: 글자여야 합니다`);
      continue;
    }
    const t = (v ?? "").trim();
    if ([...t].length > max) errors.push(`${key}: ${max}자 이하여야 합니다`);
    else out[key] = t === "" ? null : t;
  }

  if (raw.visibility !== undefined) {
    if (typeof raw.visibility === "string" && (PERSON_VISIBILITIES as readonly string[]).includes(raw.visibility)) out.visibility = raw.visibility as "public" | "hidden";
    else errors.push("visibility: public(공개) 또는 hidden(비공개)이어야 합니다");
  }

  if (raw.staff_user_id !== undefined) {
    const v = raw.staff_user_id;
    if (v === null || v === "") out.staff_user_id = null;
    else if (typeof v === "string" && UUID_RE.test(v.trim())) out.staff_user_id = v.trim().toLowerCase();
    else errors.push("staff_user_id: 계정 ID(UUID)이거나 연결을 풀려면 null이어야 합니다");
  }

  if (mode === "patch" && errors.length === 0 && Object.keys(out).length === 0) errors.push("body: 고칠 칸이 없습니다");
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}
