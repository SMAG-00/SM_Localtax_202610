// SM 전문가 관리 입력 검사 (W7c - docs/dev/W7c_설계.md 1장 3단계). 칸 모양만 본다 - 쓰면 안 되는 표현·분류 존재·공개 조건(본인 동의서 기록)은 DB 트리거가 정본이다.
// 오류 문장은 "칸: 문장" 모양 (화면이 칸 옆에 보인다). 채워 넣는 기본값은 없다 - 내용은 PO가 SM 소속 전문가 본인 자료로 적는다.
// 자격 검증 기록·등록번호·재검증 기한은 두지 않는다 (PO 결정 2026-10-24).

export const EXPERT_OPS = ["category", "profile", "publish", "unpublish", "withdraw", "notice", "policy", "request_status"] as const;
export type ExpertOp = (typeof EXPERT_OPS)[number];

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };
type Body = Record<string, unknown>;

const s = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const flag = (v: unknown): boolean => v === true || v === "true";
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function lines(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => s(x)).filter(Boolean);
  return s(v).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
}
function csv(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => s(x)).filter(Boolean);
  return s(v).split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
}
function posInt(v: unknown): number | null {
  const n = typeof v === "number" ? v : /^\d+$/.test(s(v)) ? Number(s(v)) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
const result = <T>(errors: string[], value: T): Parsed<T> => (errors.length ? { ok: false, errors } : { ok: true, value });

export function parseId(body: Body, key = "id"): Parsed<number> {
  const n = posInt(body[key]);
  return n === null ? { ok: false, errors: [`${key}: 번호가 필요합니다`] } : { ok: true, value: n };
}

export function parseCategory(body: Body): Parsed<{ code: string; name: string; sort_order: number; active: boolean }> {
  const e: string[] = [];
  const code = s(body.code);
  if (!SLUG.test(code) || code.length > 40) e.push("code: 영문 소문자·숫자·-로 40자 이하");
  const name = s(body.name);
  if (name === "" || name.length > 40) e.push("name: 1~40자");
  const order = s(body.sort_order) === "" ? 100 : Number(s(body.sort_order));
  if (!Number.isInteger(order) || order < 0 || order > 10000) e.push("sort_order: 0~10000 정수");
  return result(e, { code, name, sort_order: order, active: body.active === undefined ? true : flag(body.active) });
}

export interface ProfileInput {
  id: number | null;
  row: {
    slug: string;
    name: string;
    category_codes: string[];
    specialties: string[];
    office_name: string;
    regions: string[];
    contact_links: { label: string; url: string }[];
    interests: string;
    intro: string;
    house_relation: string;
    photo_media_id: number | null;
  };
}
export function parseProfile(body: Body): Parsed<ProfileInput> {
  const e: string[] = [];
  const slug = s(body.slug);
  if (!SLUG.test(slug) || slug.length > 60) e.push("slug: 영문 소문자·숫자·-로 60자 이하");
  const name = s(body.name);
  if (name === "" || name.length > 40) e.push("name: 실명 1~40자");
  const cats = csv(body.category_codes);
  if (cats.length < 1 || cats.length > 5 || cats.some((c) => !SLUG.test(c))) e.push("category_codes: 분류 1~5개 (쉼표로 구분)");
  const specialties = csv(body.specialties);
  if (specialties.length > 8 || specialties.some((x) => x.length > 30)) e.push("specialties: 전문 분야는 8개 이하, 각 30자 이하");
  const office = s(body.office_name);
  if (office === "" || office.length > 80) e.push("office_name: 소속(SM 법인·사무소) 1~80자");
  const regions = csv(body.regions);
  if (regions.length > 10) e.push("regions: 활동 지역은 10개 이하");
  const links: { label: string; url: string }[] = [];
  for (const line of lines(body.contact_links)) {
    const [label = "", url = ""] = line.split("|").map((x) => x.trim());
    if (label === "" || !/^https?:\/\/[^\s]+$/i.test(url)) e.push(`contact_links: '${line}' - 이름|http(s) 주소 모양이어야 합니다`);
    else links.push({ label, url });
  }
  if (links.length > 3) e.push("contact_links: 연락 링크는 3개 이하");
  const interests = s(body.interests);
  if (interests.length > 300) e.push("interests: 300자 이하");
  const intro = s(body.intro);
  if (intro.length > 400) e.push("intro: 400자 이하");
  const rel = s(body.house_relation);
  if (rel !== "employed" && rel !== "sm_corporation") e.push("house_relation: 고용 또는 SM 법인 소속만 소개합니다");
  let photo: number | null = null;
  if (s(body.photo_media_id) !== "") {
    photo = posInt(body.photo_media_id);
    if (photo === null) e.push("photo_media_id: 이미지 번호(숫자)");
  }
  let id: number | null = null;
  if (body.id !== undefined && s(body.id) !== "") {
    id = posInt(body.id);
    if (id === null) e.push("id: 번호");
  }
  return result(e, { id, row: { slug, name, category_codes: cats, specialties, office_name: office, regions, contact_links: links, interests, intro, house_relation: rel, photo_media_id: photo } });
}

/** 공개 - 본인 동의서 기록(버전·받은 날·보관 위치)이 있어야 한다 (EXPL-07) */
export function parsePublish(body: Body): Parsed<{ id: number; consent_version: string; consent_on: string; consent_doc_ref: string }> {
  const e: string[] = [];
  const id = parseId(body);
  if (!id.ok) e.push(...id.errors);
  const cv = s(body.consent_version);
  if (cv === "" || cv.length > 40) e.push("consent_version: 본인 동의서 버전 1~40자");
  const on = s(body.consent_on);
  if (!DATE.test(on) || Number.isNaN(Date.parse(on))) e.push("consent_on: 본인 동의서 받은 날 (YYYY-MM-DD)");
  const ref = s(body.consent_doc_ref);
  if (ref === "" || ref.length > 200) e.push("consent_doc_ref: 동의서 보관 위치 1~200자");
  return result(e, { id: id.ok ? id.value : 0, consent_version: cv, consent_on: on, consent_doc_ref: ref });
}

export function parseWithdraw(body: Body): Parsed<{ id: number; reason: string }> {
  const e: string[] = [];
  const id = parseId(body);
  if (!id.ok) e.push(...id.errors);
  const reason = s(body.reason);
  if (reason === "" || reason.length > 300) e.push("reason: 철회 사유 1~300자");
  return result(e, { id: id.ok ? id.value : 0, reason });
}

export function parseNotice(body: Body): Parsed<Record<string, unknown>> {
  const e: string[] = [];
  const text = s(body.text);
  if (text.length > 600) e.push("text: 600자 이하");
  const approved = flag(body.approved);
  if (approved && (s(body.version) === "" || text === "" || s(body.reviewed_by) === "" || !DATE.test(s(body.reviewed_on)))) e.push("approved: 승인에는 법률 검토본 버전·문구·검토자·검토일(YYYY-MM-DD)이 모두 필요합니다");
  return result(e, { version: s(body.version), text, approved, reviewed_by: s(body.reviewed_by) || null, reviewed_on: s(body.reviewed_on) || null });
}

export function parsePolicy(body: Body): Parsed<Record<string, unknown>> {
  const e: string[] = [];
  const num = (key: string, lo: number, hi: number): number => {
    const n = Number(s(body[key]));
    if (!Number.isInteger(n) || n < lo || n > hi) e.push(`${key}: ${lo}~${hi} 정수`);
    return n;
  };
  const retention = num("retention_days", 30, 1825);
  const target = num("target_business_days", 1, 10);
  const max = num("summary_max_chars", 100, 2000);
  const intro = lines(body.intro);
  const items = lines(body.consent_items);
  if (intro.length > 6 || items.length > 6) e.push("intro: 안내 문단·동의 항목은 6개 이하(줄마다 하나)");
  const approved = flag(body.approved);
  if (approved && (s(body.consent_version) === "" || intro.length === 0 || items.length === 0 || s(body.reviewed_by) === "" || !DATE.test(s(body.reviewed_on)) || s(body.due_diligence_ref) === "" || s(body.legal_review_ref) === "")) {
    e.push("approved: 승인에는 동의 버전·안내 문단·동의 항목·검토자·검토일과 실사(#12)·감수(#20) 기록 번호가 모두 필요합니다");
  }
  return result(e, {
    retention_days: retention,
    target_business_days: target,
    summary_max_chars: max,
    consent_version: s(body.consent_version),
    intro,
    consent_items: items,
    approved,
    reviewed_by: s(body.reviewed_by) || null,
    reviewed_on: s(body.reviewed_on) || null,
    due_diligence_ref: s(body.due_diligence_ref),
    legal_review_ref: s(body.legal_review_ref),
  });
}

export function parseRequestStatus(body: Body): Parsed<{ id: number; status: "contacted" | "closed"; scope_noted: boolean; performing_entity: string | null; close_reason: string | null }> {
  const e: string[] = [];
  const id = parseId(body);
  if (!id.ok) e.push(...id.errors);
  const status = s(body.status);
  if (status !== "contacted" && status !== "closed") e.push("status: 첫 연락(contacted) 또는 종결(closed)");
  const scope = flag(body.scope_noted);
  const entity = s(body.performing_entity);
  if (entity.length > 100) e.push("performing_entity: 100자 이하");
  if (status === "contacted") {
    if (entity === "") e.push("performing_entity: 상담·업무를 맡는 수행 주체(사무소·법인 이름과 자격)를 적으세요");
    if (!scope) e.push("scope_noted: 수행 주체·업무 범위·비용 기준을 먼저 안내했다는 확인이 필요합니다");
  }
  const reason = s(body.close_reason) || null;
  if (status === "closed" && !["contract", "guidance_end", "unreachable"].includes(reason ?? "")) e.push("close_reason: 계약 진행·안내 종료·연락 불가 중 하나");
  return result(e, { id: id.ok ? id.value : 0, status: status as "contacted" | "closed", scope_noted: scope, performing_entity: status === "contacted" ? entity : null, close_reason: status === "closed" ? reason : null });
}

/** 설정 API에서 experts·expert_requests를 켤 때의 사전 검사 - DB 트리거(…65 · …66)가 같은 조건을 다시 본다 */
export function expertEnableErrors(turningOn: { experts: boolean; expert_requests: boolean }, nextFlags: { experts: boolean }, notice: unknown, policy: unknown): string[] {
  const out: string[] = [];
  const approved = (v: unknown) => typeof v === "object" && v !== null && (v as { approved?: unknown }).approved === true;
  if (turningOn.experts && !approved(notice)) out.push("전문가 소개 고지문(expert_notice)이 법률 검토본으로 승인되어 있어야 합니다 (EXPL-05)");
  if (turningOn.expert_requests) {
    if (!nextFlags.experts) out.push("SM 전문가 연락 요청은 전문가 소개(experts)와 함께 켭니다");
    if (!approved(policy)) out.push("연락 요청 정책(expert_request_policy)에 실사(#12)·감수(#20) 기록이 있는 승인이 필요합니다 (EXPL-13)");
  }
  return out;
}
