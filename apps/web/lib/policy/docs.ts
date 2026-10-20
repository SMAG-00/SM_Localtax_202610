// 정책 문서 9종 표 (W2-e 설계 2.5 — 시험이 설계 문서의 표와 대조한다) + 본문 줄 표기 해석 (6.2). 순수 모듈.
import type { FeatureKey } from "@/lib/server/public/constants";

export const POLICY_DOC_KEYS = ["about", "editorial-policy", "ethics", "corrections", "ad-policy", "privacy", "terms", "no-email-collection", "advertise"] as const;
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

// ── 회사 정보 줄 (6.4 — 값이 있는 칸만) ──
export const COMPANY_INFO_FIELDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "name", label: "상호" },
  { key: "representative", label: "대표" },
  { key: "publisher", label: "발행인" },
  { key: "editor", label: "편집인" },
  { key: "registration_no", label: "등록번호" },
  { key: "address", label: "주소" },
  { key: "phone", label: "대표전화" },
  { key: "directions", label: "오시는 길" },
];

export function companyInfoRows(value: unknown): Array<{ label: string; value: string }> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const o = value as Record<string, unknown>;
  return COMPANY_INFO_FIELDS.flatMap((f) => (typeof o[f.key] === "string" && (o[f.key] as string).trim() !== "" ? [{ label: f.label, value: (o[f.key] as string).trim() }] : []));
}
