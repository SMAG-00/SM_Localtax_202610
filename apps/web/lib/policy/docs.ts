// 정책 문서 11종 표 (W2-e 설계 2.5 — 시험이 설계 문서의 표와 대조한다) + 본문 줄 표기 해석 (6.2). 순수 모듈.
import type { FeatureKey } from "@/lib/server/public/constants";

export const POLICY_DOC_KEYS = ["about", "editorial-policy", "ethics", "corrections", "ad-policy", "privacy", "terms", "no-email-collection", "youth-protection", "copyright-policy", "advertise"] as const;
export type PolicyDocKey = (typeof POLICY_DOC_KEYS)[number];
export const isPolicyDocKey = (v: unknown): v is PolicyDocKey => typeof v === "string" && (POLICY_DOC_KEYS as readonly string[]).includes(v);

export type PolicyEditors = "editorial" | "admin" | "ad";

export interface PolicyDoc {
  key: PolicyDocKey;
  href: string;
  feature: FeatureKey;
  /** 바닥글·관리 화면 이름 */
  label: string;
  /** 고치는 사람 — editorial: 편집 책임자·관리자, admin: 관리자, ad: 광고·협찬 담당·관리자 (게시 승인은 모두 관리자) */
  editors: PolicyEditors;
}

export const POLICY_DOCS: readonly PolicyDoc[] = [
  { key: "about", href: "/about", feature: "page_about", label: "회사 소개", editors: "editorial" },
  { key: "editorial-policy", href: "/about/editorial-policy", feature: "page_editorial_policy", label: "편집 원칙", editors: "editorial" },
  { key: "ethics", href: "/about/ethics", feature: "page_ethics", label: "윤리강령", editors: "editorial" },
  { key: "corrections", href: "/about/corrections", feature: "page_corrections", label: "정정·반론 창구", editors: "editorial" },
  { key: "ad-policy", href: "/about/ad-policy", feature: "page_ad_policy", label: "광고 정책", editors: "editorial" },
  { key: "privacy", href: "/about/privacy", feature: "page_privacy", label: "개인정보처리방침", editors: "admin" },
  { key: "terms", href: "/about/terms", feature: "page_terms", label: "이용약관", editors: "admin" },
  { key: "no-email-collection", href: "/about/no-email-collection", feature: "page_no_email", label: "이메일무단수집거부", editors: "admin" },
  { key: "youth-protection", href: "/about/youth-protection", feature: "page_youth_protection", label: "청소년보호정책", editors: "admin" },
  { key: "copyright-policy", href: "/about/copyright-policy", feature: "page_copyright_policy", label: "저작권보호정책", editors: "admin" },
  { key: "advertise", href: "/about/advertise", feature: "page_advertise", label: "광고·제휴 안내", editors: "ad" },
];

export const policyDoc = (key: PolicyDocKey): PolicyDoc => POLICY_DOCS.find((d) => d.key === key)!;

/** 문서를 고칠 수 있나 — 관리자는 전부, 편집 책임자는 편집 원칙류, 광고 담당은 광고·제휴 안내 */
export function canEditPolicy(docKey: PolicyDocKey, who: { isAdmin: boolean; roles: readonly string[] }): boolean {
  if (who.isAdmin) return true;
  const editors = policyDoc(docKey).editors;
  if (editors === "editorial") return who.roles.includes("editor");
  if (editors === "ad") return who.roles.includes("ad_ops");
  return false;
}

/** 편집 화면 뼈대에 보이는 항목 이름만 (PRD 3장 — 문장은 한 줄도 채워 두지 않는다). 설계 6.1에 적힌 문서만 있다 */
export const POLICY_SKELETON: Readonly<Partial<Record<PolicyDocKey, readonly string[]>>> = {
  "editorial-policy": ["편집 독립", "취재 기준", "기사 유형 구분", "정정/반론 원칙", "광고 분리", "AI 사용 원칙"],
};

// ── 본문 조각 ──
export type PolicyBlock = { type: "paragraph" | "callout"; text: string } | { type: "list"; items: string[] };
export interface PolicySection {
  heading: string;
  blocks: PolicyBlock[];
}

export const POLICY_BODY_MAX_CHARS = 200_000;

/** 줄 표기 → 조각: `## 절 제목` · `- 항목` · `> 강조 문단` · 빈 줄 = 문단 나눔. HTML은 해석하지 않는다(글자로만 그려진다) */
export function parsePolicyBody(text: string): PolicySection[] {
  const sections: PolicySection[] = [];
  let section: PolicySection | null = null;
  let para: string[] = [];
  let list: string[] = [];
  const cur = (): PolicySection => (section ??= (sections.push({ heading: "", blocks: [] }), sections[sections.length - 1]!));
  const flush = () => {
    if (para.length) cur().blocks.push({ type: "paragraph", text: para.join(" ") });
    if (list.length) cur().blocks.push({ type: "list", items: list });
    para = [];
    list = [];
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (line === "") {
      flush();
    } else if (line.startsWith("## ")) {
      flush();
      section = { heading: line.slice(3).trim(), blocks: [] };
      sections.push(section);
    } else if (line.startsWith("- ")) {
      if (para.length) flush();
      list.push(line.slice(2).trim());
    } else if (line.startsWith("> ")) {
      flush();
      cur().blocks.push({ type: "callout", text: line.slice(2).trim() });
    } else {
      if (list.length) flush();
      para.push(line);
    }
  }
  flush();
  return sections.filter((s) => s.heading !== "" || s.blocks.length > 0);
}

/** 저장된 조각 → 편집용 줄 표기 (parsePolicyBody의 거꾸로) */
export function policyBodyToText(body: readonly PolicySection[]): string {
  return body
    .map((s) => {
      const lines = s.heading ? [`## ${s.heading}`] : [];
      for (const b of s.blocks) lines.push(b.type === "list" ? b.items.map((i) => `- ${i}`).join("\n") : b.type === "callout" ? `> ${b.text}` : b.text);
      return lines.join("\n\n");
    })
    .join("\n\n");
}

/** 저장된 jsonb가 조각 모양인가 — 아니면 빈 목록(그리지 않는다) */
export function readPolicyBody(value: unknown): PolicySection[] {
  if (!Array.isArray(value)) return [];
  const out: PolicySection[] = [];
  for (const s of value) {
    if (typeof s !== "object" || s === null || typeof (s as PolicySection).heading !== "string" || !Array.isArray((s as PolicySection).blocks)) continue;
    const blocks: PolicyBlock[] = [];
    for (const b of (s as PolicySection).blocks as unknown[]) {
      const o = b as { type?: unknown; text?: unknown; items?: unknown };
      if ((o.type === "paragraph" || o.type === "callout") && typeof o.text === "string") blocks.push({ type: o.type, text: o.text });
      else if (o.type === "list" && Array.isArray(o.items) && o.items.every((i) => typeof i === "string")) blocks.push({ type: "list", items: o.items as string[] });
    }
    out.push({ heading: (s as PolicySection).heading, blocks });
  }
  return out;
}

/** 게시 점검(경고, 차단 아님 — 6.2): 비어 있나 · 금지 표현 · 이메일 모양. 문장을 고쳐 주지 않는다 */
export function publishWarnings(body: readonly PolicySection[], forbidden: readonly string[], emailShape: (s: string) => boolean): string[] {
  const texts = body.flatMap((s) => [s.heading, ...s.blocks.flatMap((b) => (b.type === "list" ? b.items : [b.text]))]);
  const warnings: string[] = [];
  if (texts.every((t) => t.trim() === "")) warnings.push("본문이 비어 있습니다");
  const all = texts.join("\n");
  const hits = forbidden.filter((p) => p.trim() !== "" && all.includes(p));
  if (hits.length) warnings.push(`금지 표현 사전에 걸리는 말이 있습니다: ${hits.join(", ")}`);
  if (texts.some(emailShape)) warnings.push("이메일 모양 문자열이 있습니다 — 화면에는 가림 표기로 나갑니다");
  return warnings;
}

// ── 바닥글 회사·매체 정보 (6.4 · 옛 사이트 바닥글 이전 — 값이 있는 칸만) ──
// settings.company_info 한 키에 모두 둔다. 칸 순서 = 화면 순서. 제호는 설정이 아니라 brand.mastheadName에서 온다
export type CompanyInfoGroup = "media" | "contact" | "notice";
export interface CompanyInfoField {
  key: string;
  label: string;
  group: CompanyInfoGroup;
  /** 글자 수 상한 (운영 설정 검사·DB 트리거와 같다) */
  max: number;
}

export const COMPANY_INFO_FIELDS: readonly CompanyInfoField[] = [
  { key: "registered_on", label: "등록일", group: "media", max: 40 },
  { key: "registration_no", label: "등록번호", group: "media", max: 80 },
  { key: "publisher_editor", label: "발행·편집인", group: "media", max: 80 },
  { key: "youth_officer", label: "청소년보호책임자", group: "media", max: 80 },
  { key: "corporation", label: "법인명", group: "media", max: 120 },
  { key: "name", label: "상호", group: "media", max: 120 },
  { key: "representative", label: "대표", group: "media", max: 80 },
  { key: "publisher", label: "발행인", group: "media", max: 80 },
  { key: "editor", label: "편집인", group: "media", max: 80 },
  { key: "address", label: "주소", group: "contact", max: 200 },
  { key: "phone", label: "전화", group: "contact", max: 60 },
  { key: "fax", label: "FAX", group: "contact", max: 60 },
  { key: "directions", label: "오시는 길", group: "contact", max: 300 },
  { key: "copyright_notice", label: "저작권 문구", group: "notice", max: 400 },
  { key: "open_reporting_notice", label: "열린보도원칙 문구", group: "notice", max: 400 },
];

/** 문구 안 `{제호}` 자리표시자 — 제호가 확정되면 brand.ts 한 줄만 바꾸면 문구도 따라간다 */
export const MASTHEAD_PLACEHOLDER = "{제호}";
export const fillMasthead = (text: string, masthead: string): string => text.replaceAll(MASTHEAD_PLACEHOLDER, masthead);

export interface CompanyFooter {
  /** 안내 문단 — 저작권 보호 문구 · 열린보도원칙 (이 순서) */
  notices: string[];
  /** 매체 정보 줄 — 제호가 맨 앞 */
  media: Array<{ label: string; value: string }>;
  contact: Array<{ label: string; value: string }>;
}

/** company_info 값 → 바닥글 칸 (글자 칸만, 빈 칸·공백·글자 아닌 값은 뺀다). 제호는 항상 매체 정보 맨 앞 */
export function companyFooter(value: unknown, masthead: string): CompanyFooter {
  const o = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const rows = (group: CompanyInfoGroup) =>
    COMPANY_INFO_FIELDS.filter((f) => f.group === group).flatMap((f) => {
      const v = o[f.key];
      return typeof v === "string" && v.trim() !== "" ? [{ label: f.label, value: fillMasthead(v.trim(), masthead) }] : [];
    });
  return {
    notices: rows("notice").map((r) => r.value),
    media: [{ label: "제호", value: masthead }, ...rows("media")],
    contact: rows("contact"),
  };
}

/** 운영 설정 company_info 저장 검사 — 객체 · 아는 칸만 · 글자만(한 줄, 상한 이내). 빈 글자는 그 줄을 숨기는 뜻이라 허용. DB 트리거(…103)와 같은 규칙 */
export function companyInfoErrors(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return ["값은 JSON 객체여야 합니다"];
  const errors: string[] = [];
  const known = new Map(COMPANY_INFO_FIELDS.map((f) => [f.key, f]));
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const f = known.get(k);
    if (!f) errors.push(`${k}: 모르는 칸입니다 (${COMPANY_INFO_FIELDS.map((x) => x.key).join(" · ")})`);
    else if (typeof v !== "string") errors.push(`${k}: 따옴표로 감싼 글자여야 합니다 (비우려면 "")`);
    else if (/[\r\n]/.test(v)) errors.push(`${k}: 한 줄이어야 합니다`);
    else if ([...v.trim()].length > f.max) errors.push(`${k}: ${f.max}자 이하여야 합니다 (지금 ${[...v.trim()].length}자)`);
  }
  return errors;
}
