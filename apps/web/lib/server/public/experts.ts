import "server-only";
import type { PersonView } from "@ltr/structured-data";
import { parseContactLinks, sortProfiles } from "@/lib/experts/logic";
import { absolute } from "../articles/mapping";
import { siteUrl } from "../env";
import { publicDb, rowsOf } from "./db";
import { readPublicSettings } from "./reads";

// SM 전문가 소개 W7c 공개 읽기 (EXPL-01·02·04·05·07·12). 공개 뷰 public_expert_* 만 anon 키로 읽는다 - 공개 조건(관리자 공개 + 본인 동의서 기록 + 철회 없음 +
// 고지문 승인 + 기능 키)은 뷰 한 곳에 있다. 기능 키 experts가 꺼져 있으면 화면은 404. 정렬은 lib/experts/logic.ts 한 곳(분류 순서 -> 이름 가나다).

export interface ExpertCardView {
  slug: string;
  name: string;
  href: string;
  categories: { code: string; name: string }[];
  specialties: string[];
  officeName: string;
  regions: string[];
  contactLinks: { label: string; url: string }[];
  interests: string;
  intro: string;
  photo: { path: string; alt: string | null; credit: string | null } | null;
}

interface ProfileRow {
  id: number;
  slug: string;
  name: string;
  category_codes: string[];
  category_names: string[];
  specialties: string[];
  office_name: string;
  regions: string[];
  contact_links: unknown;
  interests: string;
  intro: string;
  photo_path: string | null;
  photo_alt: string | null;
  photo_credit: string | null;
}
const COLUMNS = "id, slug, name, category_codes, category_names, specialties, office_name, regions, contact_links, interests, intro, photo_path, photo_alt, photo_credit";

export const expertHref = (slug: string) => `/experts/profile/${encodeURIComponent(slug)}`;

function card(r: ProfileRow): ExpertCardView {
  return {
    slug: r.slug,
    name: r.name,
    href: expertHref(r.slug),
    categories: r.category_codes.map((code, i) => ({ code, name: r.category_names[i] ?? code })),
    specialties: r.specialties,
    officeName: r.office_name,
    regions: r.regions,
    contactLinks: parseContactLinks(r.contact_links),
    interests: r.interests,
    intro: r.intro,
    photo: r.photo_path ? { path: r.photo_path, alt: r.photo_alt, credit: r.photo_credit } : null,
  };
}

async function readNotice(): Promise<{ version: string; text: string } | null> {
  const rows = await rowsOf<{ version: string; text: string }>(publicDb().from("public_expert_notice").select("version, text"), "전문가 소개 고지문");
  return rows[0] ?? null;
}

export interface ExpertListView {
  open: boolean;
  /** 연락 요청 양식이 열려 있다 (기능 키 expert_requests) */
  requestsOpen: boolean;
  /** 라운지(/qna)가 열려 있다 - 기능 키 qna ∧ 중립성 고지 승인 (W13-g) */
  qnaOpen: boolean;
  notice: { version: string; text: string } | null;
  categories: { code: string; name: string; count: number }[];
  /** 고른 분류 - 목록 밖 값은 null(필터 없이 전체 + 안내) */
  selected: { code: string; name: string } | null;
  badCategory: boolean;
  profiles: ExpertCardView[];
}

/** 목록 (EXPL-01) - 분류 필터는 쿼리 하나(?category=), 지역 쿼리는 읽지 않는다 (지역 필터·정렬 0) */
export async function getExpertList(params: { category?: string | null } = {}): Promise<ExpertListView> {
  const closed: ExpertListView = { open: false, requestsOpen: false, qnaOpen: false, notice: null, categories: [], selected: null, badCategory: false, profiles: [] };
  const features = (await readPublicSettings()).features;
  if (!features.experts) return closed;
  const [notice, cats, rows, qna] = await Promise.all([
    readNotice(),
    rowsOf<{ code: string; name: string; sort_order: number; profile_count: number }>(publicDb().from("public_expert_categories").select("code, name, sort_order, profile_count").order("sort_order"), "전문가 분류"),
    rowsOf<ProfileRow>(publicDb().from("public_expert_profiles").select(COLUMNS).limit(500), "전문가 프로필"),
    rowsOf<{ version: string }>(publicDb().from("public_qna_notice").select("version"), "라운지 열림"),
  ]);
  const order = new Map(cats.map((c) => [c.code, c.sort_order]));
  const wanted = (params.category ?? "").trim();
  const selected = cats.find((c) => c.code === wanted) ?? null;
  const filtered = selected ? rows.filter((r) => r.category_codes.includes(selected.code)) : rows;
  const sorted = sortProfiles(filtered, order);
  return {
    open: true,
    requestsOpen: features.expert_requests,
    qnaOpen: qna.length > 0,
    notice,
    categories: cats.map((c) => ({ code: c.code, name: c.name, count: c.profile_count })),
    selected: selected ? { code: selected.code, name: selected.name } : null,
    badCategory: wanted !== "" && !selected,
    profiles: sorted.map(card),
  };
}

export interface ExpertProfileView {
  open: boolean;
  requestsOpen: boolean;
  notice: { version: string; text: string } | null;
  profile: ExpertCardView | null;
  /** ProfilePage(Person) 구조화 데이터 입력 - 화면과 같은 값 (EXPL-12) */
  view: PersonView | null;
}

export async function getExpertProfile(slug: string): Promise<ExpertProfileView> {
  const features = (await readPublicSettings()).features;
  if (!features.experts) return { open: false, requestsOpen: false, notice: null, profile: null, view: null };
  const [notice, rows] = await Promise.all([
    readNotice(),
    rowsOf<ProfileRow>(publicDb().from("public_expert_profiles").select(COLUMNS).eq("slug", slug).limit(1), "전문가 프로필"),
  ]);
  const row = rows[0];
  const base = { open: true, requestsOpen: features.expert_requests, notice };
  if (!row) return { ...base, profile: null, view: null };
  const profile = card(row);
  const evidenceId = `expert-profile:${row.id}`;
  const view: PersonView = {
    url: absolute(siteUrl(), profile.href),
    name: profile.name,
    affiliation: { text: profile.officeName, evidenceId },
    credentials: profile.categories.map((c) => ({ text: c.name, evidenceId })),
    ...(profile.specialties.length ? { knowsAbout: profile.specialties } : {}),
    ...(profile.intro ? { description: profile.intro } : {}),
  };
  return { ...base, profile, view };
}

export interface ExpertRequestFormView {
  open: boolean;
  notice: { version: string; text: string } | null;
  options: { code: string; name: string }[];
  policy: { consentVersion: string; intro: string[]; consentItems: string[]; retentionDays: number; targetBusinessDays: number; summaryMaxChars: number } | null;
}

/** 연락 요청 양식 (EXPL-13) - 기능 키 expert_requests가 꺼져 있거나 정책이 승인 전이면 열리지 않는다 */
export async function getExpertRequestForm(): Promise<ExpertRequestFormView> {
  const closed: ExpertRequestFormView = { open: false, notice: null, options: [], policy: null };
  const features = (await readPublicSettings()).features;
  if (!features.experts || !features.expert_requests) return closed;
  const [notice, options, policies] = await Promise.all([
    readNotice(),
    rowsOf<{ code: string; name: string }>(publicDb().from("public_expert_request_options").select("code, name").order("sort_order"), "전문가 요청 분야"),
    rowsOf<{ consent_version: string; intro: string[]; consent_items: string[]; retention_days: number; target_business_days: number; summary_max_chars: number }>(
      publicDb().from("public_expert_request_notice").select("consent_version, intro, consent_items, retention_days, target_business_days, summary_max_chars"),
      "전문가 요청 안내",
    ),
  ]);
  const p = policies[0];
  if (!p) return closed;
  return {
    open: true,
    notice,
    options,
    policy: { consentVersion: p.consent_version, intro: p.intro, consentItems: p.consent_items, retentionDays: p.retention_days, targetBusinessDays: p.target_business_days, summaryMaxChars: p.summary_max_chars },
  };
}
