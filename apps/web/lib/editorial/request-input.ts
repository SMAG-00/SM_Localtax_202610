// 편집위원 데스크 — 기사 제작 요청 입력 (PO 2026-11-18). 순수 모듈이다 — 브라우저 양식과 서버 API가 같이 쓴다.
// 항목은 프로젝트 지침 통합본 v4 2장 '접수 인터뷰' ①~⑫를 양식으로 옮긴 것이다. 고르지 않은 항목은 지침의 기본값으로 진행한다
// ('알아서 써' — 기사 맨 위에 어떤 가정으로 썼는지 밝힌다). 결과물 형식(⑪)은 지침대로 고정이라 받지 않는다.

export const ARTICLE_TYPES = { auto: "소재를 보고 판단", quantitative: "정량기사 (수치·데이터 보도·분석)", qualitative: "정성기사 (전문가 칼럼)", explainer: "해설기사 (판례·유권해석·상담사례)" } as const;
export type ArticleType = keyof typeof ARTICLE_TYPES;

export const SECTIONS = ["자동", "지자체소식", "법령개정", "부동산 정보", "전문가 칼럼", "판례소개", "유권해석", "상담사례"] as const;
export type Section = (typeof SECTIONS)[number];

export const READERS = ["세무 실무자 전반", "세무 공무원", "세무대리인", "업계 실무자", "일반 납세자"] as const;
export type Reader = (typeof READERS)[number];

export const DERIVATIVES = { cardnews: "인스타그램 카드뉴스", threads: "쓰레드 5부작", youtube: "유튜브 나레이션(쇼츠·롱폼)" } as const;
export type Derivative = keyof typeof DERIVATIVES;

export interface EditorialRequestInput {
  /** 주제 한 줄 (필수) */
  topic: string;
  articleType: ArticleType;
  /** 소재 — 뉴스·보도자료·법령·통계 링크 (한 줄에 하나, https만) */
  links: string[];
  /** 소재 설명·붙여 넣은 자료 글 */
  sourceNote: string;
  section: Section;
  /** 관점·핵심 메시지 (비우면 취재 뒤 제안) */
  message: string;
  reader: Reader;
  /** 필자 정보 (비우면 [기자명] 자리 표시) */
  byline: string;
  /** 실제로 받은 코멘트 (비우면 공개 출처에서 확인된 발언만) */
  comments: string;
  /** 분량 (비우면 지침 기본값) */
  length: string;
  /** 기준일 YYYY-MM-DD (비우면 작업일) */
  baseDate: string;
  summaryTable: boolean;
  /** OpenAI 이미지 생성 요금 승인 — 지침 13-2를 요청 시 체크로 대신한다. 끄면 이미지 계획만 남기고 생성하지 않는다 */
  imagesApproved: boolean;
  derivatives: Derivative[];
  /** 그 밖에 전할 말 */
  memo: string;
}

export const LIMITS = { topic: 200, text: 4000, line: 300, links: 20, link: 2000 } as const;

/** 첨부 — 파일당 4MB(서버 함수 본문 한도 안), 요청당 5개. 큰 자료는 링크로 */
export const ATTACHMENT_MAX_BYTES = 4_000_000;
export const ATTACHMENT_MAX_COUNT = 5;
export const ATTACHMENT_EXTENSIONS = ["pdf", "hwp", "hwpx", "docx", "xlsx", "csv", "txt", "md", "png", "jpg", "jpeg"] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

type Result = { ok: true; value: EditorialRequestInput } | { ok: false; errors: string[] };

function text(raw: unknown, name: string, max: number, errors: string[], required = false): string {
  if (raw === undefined || raw === null) raw = "";
  if (typeof raw !== "string") {
    errors.push(`${name}: 글자로 적어 주세요`);
    return "";
  }
  const v = raw.trim();
  if (required && v === "") errors.push(`${name}: 꼭 적어 주세요`);
  if (v.length > max) errors.push(`${name}: ${max.toLocaleString("ko-KR")}자 이내로 줄여 주세요 (지금 ${v.length.toLocaleString("ko-KR")}자)`);
  if (CONTROL.test(v)) errors.push(`${name}: 보이지 않는 제어 문자는 넣을 수 없습니다`);
  return v;
}

function pick<T extends string>(raw: unknown, allowed: readonly T[], fallback: T, name: string, errors: string[]): T {
  if (raw === undefined || raw === null || raw === "") return fallback;
  if (typeof raw === "string" && (allowed as readonly string[]).includes(raw)) return raw as T;
  errors.push(`${name}: ${allowed.join("·")} 중에서 골라 주세요`);
  return fallback;
}

/** 실제 달력 날짜인가 (2026-02-30 같은 값 거부) */
function isRealDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** 링크 칸 — 줄바꿈으로 나눈 https 주소만, 같은 주소는 한 번 */
export function parseLinks(raw: unknown, errors: string[]): string[] {
  const lines = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/\r?\n/) : raw === undefined || raw === null ? [] : null;
  if (lines === null) {
    errors.push("소재 링크: 한 줄에 주소 하나씩 적어 주세요");
    return [];
  }
  const out: string[] = [];
  for (const line of lines) {
    if (typeof line !== "string") {
      errors.push("소재 링크: 글자로 적어 주세요");
      continue;
    }
    const v = line.trim();
    if (v === "") continue;
    let url: URL | null = null;
    try {
      url = new URL(v);
    } catch {
      url = null;
    }
    if (!url || url.protocol !== "https:" || v.length > LIMITS.link || CONTROL.test(v)) {
      errors.push(`소재 링크: https://로 시작하는 주소만 받습니다 — ${v.slice(0, 60)}`);
      continue;
    }
    if (!out.includes(url.href)) out.push(url.href);
  }
  if (out.length > LIMITS.links) errors.push(`소재 링크: ${LIMITS.links}개까지 받습니다 (지금 ${out.length}개)`);
  return out;
}

/** 요청 입력 검사 — 모르는 칸은 거부한다(오타로 값이 사라지지 않게) */
export function parseRequestInput(raw: unknown): Result {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, errors: ["요청 내용을 읽지 못했습니다"] };
  const r = raw as Record<string, unknown>;
  const errors: string[] = [];
  const known = new Set(["topic", "articleType", "links", "sourceNote", "section", "message", "reader", "byline", "comments", "length", "baseDate", "summaryTable", "imagesApproved", "derivatives", "memo"]);
  for (const k of Object.keys(r)) if (!known.has(k)) errors.push(`모르는 칸입니다: ${k}`);

  const baseDate = text(r.baseDate, "기준일", 10, errors);
  if (baseDate !== "" && !isRealDate(baseDate)) errors.push("기준일: YYYY-MM-DD 형식의 실제 날짜로 적어 주세요");

  let derivatives: Derivative[] = Object.keys(DERIVATIVES) as Derivative[];
  if (r.derivatives !== undefined) {
    if (!Array.isArray(r.derivatives) || !r.derivatives.every((d) => typeof d === "string" && Object.hasOwn(DERIVATIVES, d))) {
      errors.push(`파생물: ${Object.keys(DERIVATIVES).join("·")} 중에서 골라 주세요`);
    } else derivatives = (Object.keys(DERIVATIVES) as Derivative[]).filter((d) => (r.derivatives as string[]).includes(d));
  }
  const bool = (v: unknown, name: string, fallback: boolean) => {
    if (v === undefined) return fallback;
    if (typeof v === "boolean") return v;
    errors.push(`${name}: 예/아니오로 골라 주세요`);
    return fallback;
  };

  const value: EditorialRequestInput = {
    topic: text(r.topic, "주제", LIMITS.topic, errors, true),
    articleType: pick(r.articleType, Object.keys(ARTICLE_TYPES) as ArticleType[], "auto", "기사 유형", errors),
    links: parseLinks(r.links, errors),
    sourceNote: text(r.sourceNote, "소재 설명", LIMITS.text, errors),
    section: pick(r.section, SECTIONS, "자동", "게재 섹션", errors),
    message: text(r.message, "핵심 메시지", LIMITS.line * 2, errors),
    reader: pick(r.reader, READERS, "세무 실무자 전반", "주 독자", errors),
    byline: text(r.byline, "필자 정보", LIMITS.line, errors),
    comments: text(r.comments, "확보된 코멘트", LIMITS.text, errors),
    length: text(r.length, "분량", 100, errors),
    baseDate,
    summaryTable: bool(r.summaryTable, "요약표", true),
    imagesApproved: bool(r.imagesApproved, "이미지 생성 승인", false),
    derivatives,
    memo: text(r.memo, "전할 말", LIMITS.text, errors),
  };
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

/** 첨부 파일 이름 검사 — 허용 확장자·길이. 통과하면 저장용 안전한 이름(경로 문자 제거)을 돌려준다 */
export function attachmentName(name: unknown): { ok: true; safe: string; ext: string } | { ok: false; error: string } {
  if (typeof name !== "string" || name.trim() === "") return { ok: false, error: "파일 이름이 없습니다" };
  const base = name.split(/[\\/]/).pop()!.trim();
  const m = base.match(/\.([A-Za-z0-9]+)$/);
  const ext = m ? m[1]!.toLowerCase() : "";
  if (!(ATTACHMENT_EXTENSIONS as readonly string[]).includes(ext)) return { ok: false, error: `이 형식은 첨부할 수 없습니다 (.${ext || "없음"}) — ${ATTACHMENT_EXTENSIONS.join("·")}만 받습니다` };
  const safe = base.replace(/[\u0000-\u001f\u007f<>:"|?*#%]/g, "_").slice(-120);
  if (safe === `.${ext}` || safe.startsWith(".")) return { ok: false, error: "파일 이름을 확인해 주세요" };
  return { ok: true, safe, ext };
}

/** 요청 상태 표시 */
export const REQUEST_STATUS_LABELS = { draft: "작성 중", queued: "대기", running: "제작 중", done: "완료", failed: "실패", canceled: "취소" } as const;
export type RequestStatus = keyof typeof REQUEST_STATUS_LABELS;
