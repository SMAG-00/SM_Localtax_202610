// 감수 가이드 관리 입력 규칙 (W11-a a6 - PRD-03 5장·7장 guides, docs/dev/W11-a_설계.md 5장). 순수 모듈 - DB 트리거·함수(마이그레이션 111)가 같은 규칙을 한 번 더 건다.
// 오류 문장은 "칸: 문장" 모양이라 폼이 칸 옆에 보인다. 이 모듈에는 가이드 글도 세율·한도 값도 없다 - 붙여 넣은 값을 검사만 한다.
import { detectPii } from "@ltr/editorial";

export const GUIDE_HUBS = ["realestate_tax", "trust", "redevelopment", "finance_tax"] as const;
export type GuideHub = (typeof GUIDE_HUBS)[number];
export const TAX_SCOPES = ["local", "national", "both"] as const;
export const GUIDE_OPS = ["create", "sign", "publish"] as const;
export const HUB_LABEL: Record<GuideHub, string> = { realestate_tax: "부동산 세금 전 주기", trust: "신탁", redevelopment: "재개발·재건축", finance_tax: "금융 구조별 세금" };
export const SCOPE_LABEL: Record<(typeof TAX_SCOPES)[number], string> = { local: "지방세", national: "국세", both: "국세·지방세" };
export const GUIDE_STATUS_LABEL: Record<string, string> = { draft: "초안", reviewed: "서명됨(공개 대기)", published: "공개", retired: "내려감" };

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };
const fail = (errors: string[]): { ok: false; errors: string[] } => ({ ok: false, errors });
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const int = (v: unknown): number | null => {
  const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
};

const TOPIC = /^[a-z][a-z0-9_]{1,39}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const REGION = /^[0-9]{10}$/;
const MAX_SECTIONS = 50;
const MAX_SECTION_BODY = 20_000;
const MAX_FACTS_CHARS = 65_536;

export interface GuideSection {
  heading: string;
  body: string;
}
export interface GuideDraftInput {
  hub: GuideHub;
  topic: string;
  /** 새 주제일 때만 쓴다 (이미 있는 주제면 무시) */
  slug: string | null;
  version: {
    title: string;
    sections: GuideSection[];
    facts: Record<string, unknown>;
    tax_scope: (typeof TAX_SCOPES)[number];
    as_of: string | null;
    region_codes: string[];
    sources: { label: string; url?: string }[];
    import_origin: string | null;
  };
}

/** 글자로 붙여 넣은 JSON이거나 이미 값이다 - 틀린 JSON은 null과 오류 */
function jsonValue(v: unknown, field: string, errors: string[]): unknown {
  if (typeof v !== "string") return v;
  if (v.trim() === "") return undefined;
  try {
    return JSON.parse(v);
  } catch {
    errors.push(`${field}: JSON 모양이 아닙니다`);
    return undefined;
  }
}

const isDate = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

export function parseGuideDraft(body: Record<string, unknown>): Parsed<GuideDraftInput> {
  const errors: string[] = [];
  const hub = str(body.hub);
  if (!(GUIDE_HUBS as readonly string[]).includes(hub)) errors.push(`hub: ${GUIDE_HUBS.join("·")} 중 하나입니다`);
  const topic = str(body.topic);
  if (!TOPIC.test(topic)) errors.push("topic: 영문 소문자로 시작하는 소문자·숫자·'_' 2~40자입니다");
  const slugRaw = str(body.slug);
  if (slugRaw !== "" && (!SLUG.test(slugRaw) || slugRaw.length > 100)) errors.push("slug: 영문 소문자·숫자·'-' 100자 이하입니다");
  const title = str(body.title);
  if (title.length < 1 || title.length > 200) errors.push("title: 1~200자입니다");
  const scope = str(body.tax_scope);
  if (!(TAX_SCOPES as readonly string[]).includes(scope)) errors.push(`tax_scope: ${TAX_SCOPES.join("·")} 중 하나입니다`);

  const rawSections = jsonValue(body.sections, "sections", errors);
  const sections: GuideSection[] = [];
  if (rawSections !== undefined) {
    if (!Array.isArray(rawSections) || rawSections.length > MAX_SECTIONS) errors.push(`sections: 절 목록(최대 ${MAX_SECTIONS}개)입니다`);
    else {
      rawSections.forEach((s, i) => {
        const o = s as { heading?: unknown; body?: unknown } | null;
        const heading = typeof o?.heading === "string" ? o.heading.trim() : "";
        const text = typeof o?.body === "string" ? o.body.trim() : "";
        if (!o || typeof o !== "object" || Object.keys(o).some((k) => k !== "heading" && k !== "body")) errors.push(`sections[${i}]: heading·body만 받습니다`);
        else if (heading.length < 1 || heading.length > 200) errors.push(`sections[${i}].heading: 1~200자입니다`);
        else if (text.length < 1 || text.length > MAX_SECTION_BODY) errors.push(`sections[${i}].body: 1~${MAX_SECTION_BODY}자입니다`);
        else {
          if (detectPii(`${heading}\n${text}`).length > 0) errors.push(`sections[${i}]: 개인정보로 보이는 글자가 있습니다`);
          sections.push({ heading, body: text });
        }
      });
    }
  }

  const rawFacts = jsonValue(body.facts, "facts", errors);
  let facts: Record<string, unknown> = {};
  if (rawFacts !== undefined) {
    if (rawFacts === null || typeof rawFacts !== "object" || Array.isArray(rawFacts)) errors.push("facts: JSON 객체입니다");
    else if (JSON.stringify(rawFacts).length > MAX_FACTS_CHARS) errors.push(`facts: ${MAX_FACTS_CHARS}자 이하입니다`);
    else facts = rawFacts as Record<string, unknown>;
  }

  const asOfRaw = str(body.as_of);
  if (asOfRaw !== "" && !isDate(asOfRaw)) errors.push("as_of: 실제 있는 날짜(YYYY-MM-DD)입니다");

  const regionsRaw = Array.isArray(body.region_codes) ? body.region_codes.map(String) : str(body.region_codes).split(/[\s,]+/).filter(Boolean);
  const regionCodes = regionsRaw.map((r) => r.trim());
  if (regionCodes.length > 300 || regionCodes.some((r) => !REGION.test(r))) errors.push("region_codes: 지역 코드(숫자 10자리)를 쉼표로 나눕니다 (최대 300개)");

  const rawSources = jsonValue(body.sources, "sources", errors);
  const sources: { label: string; url?: string }[] = [];
  if (rawSources !== undefined) {
    if (!Array.isArray(rawSources) || rawSources.length > 100) errors.push("sources: 출처 목록(최대 100개)입니다");
    else {
      rawSources.forEach((s, i) => {
        const o = s as { label?: unknown; url?: unknown } | null;
        const label = typeof o?.label === "string" ? o.label.trim() : "";
        const url = typeof o?.url === "string" ? o.url.trim() : "";
        if (!o || Object.keys(o).some((k) => k !== "label" && k !== "url") || label.length < 1 || label.length > 200) errors.push(`sources[${i}]: label(1~200자)와 선택 url만 받습니다`);
        else if (url !== "" && (!/^https:\/\/[^\s]+$/.test(url) || url.length > 500)) errors.push(`sources[${i}].url: https 주소(500자 이하)입니다`);
        else sources.push(url === "" ? { label } : { label, url });
      });
    }
  }
  const origin = str(body.import_origin);
  if (origin.length > 200) errors.push("import_origin: 200자 이하입니다");
  if (errors.length) return fail(errors);
  return {
    ok: true,
    value: {
      hub: hub as GuideHub,
      topic,
      slug: slugRaw === "" ? null : slugRaw,
      version: { title, sections, facts, tax_scope: scope as GuideDraftInput["version"]["tax_scope"], as_of: asOfRaw === "" ? null : asOfRaw, region_codes: regionCodes, sources, import_origin: origin === "" ? null : origin },
    },
  };
}

export function parseGuideSign(body: Record<string, unknown>): Parsed<{ id: number; sheetRef: string }> {
  const errors: string[] = [];
  const id = int(body.id);
  if (id === null) errors.push("id: 가이드 버전 번호(1 이상 정수)입니다");
  const sheetRef = str(body.sheet_ref);
  if (sheetRef.length < 1 || sheetRef.length > 200) errors.push("sheet_ref: 감수 시트 위치를 1~200자로 적습니다");
  return errors.length ? fail(errors) : { ok: true, value: { id: id as number, sheetRef } };
}

export function parseGuidePublish(body: Record<string, unknown>): Parsed<{ id: number }> {
  const id = int(body.id);
  return id === null ? fail(["id: 가이드 버전 번호(1 이상 정수)입니다"]) : { ok: true, value: { id } };
}
