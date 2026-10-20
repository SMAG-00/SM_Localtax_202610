// 고객센터 폼 5종의 순수 규칙 (W2-e 설계 7.1 · 7.4 · 4.5) — DB·네트워크·시계를 쓰지 않는다.
//  · 폼 종류 → 문의 종류·필수 칸, 입력 검사(거부 문장은 CODE_MESSAGES 한 표), 본문 가림(W2-d 가림 규칙), 첨부 검사(확장자·크기·파일 앞부분 시그니처), 폼 열림 토큰
//  · '전문가 연락 요청'은 문의 종류에 없다 — 폼 5종은 tip·subscription·advertising·reader_submission·correction뿐
import { createHmac, timingSafeEqual } from "node:crypto";
import { maskBody } from "@/lib/analytics/query-terms";

export const HELP_SLUGS = ["report", "subscribe", "ad", "contribute", "corrections"] as const;
export type HelpSlug = (typeof HELP_SLUGS)[number];
export const isHelpSlug = (v: unknown): v is HelpSlug => typeof v === "string" && (HELP_SLUGS as readonly string[]).includes(v);

export interface HelpFormSpec {
  kind: "tip" | "subscription" | "advertising" | "reader_submission" | "correction";
  path: string;
  label: string;
  /** 연락 이메일 필수 여부 (기사 제보만 선택) */
  emailRequired: boolean;
  titleRequired: boolean;
  /** 기사 주소 칸: none 없음 · optional 선택 · required 필수 */
  article: "none" | "optional" | "required";
  requestType: boolean;
  organization: boolean;
  contactName: false | { label: string; optional: true };
  attachments: boolean;
}

export const HELP_FORMS: Readonly<Record<HelpSlug, HelpFormSpec>> = {
  report: { kind: "tip", path: "/help/report", label: "기사 제보", emailRequired: false, titleRequired: false, article: "optional", requestType: false, organization: false, contactName: false, attachments: true },
  subscribe: { kind: "subscription", path: "/help/subscribe", label: "구독 문의", emailRequired: true, titleRequired: false, article: "none", requestType: false, organization: false, contactName: { label: "이름", optional: true }, attachments: false },
  ad: { kind: "advertising", path: "/help/ad", label: "광고 문의", emailRequired: true, titleRequired: false, article: "none", requestType: false, organization: true, contactName: { label: "담당자 이름", optional: true }, attachments: true },
  contribute: { kind: "reader_submission", path: "/help/contribute", label: "독자 투고", emailRequired: true, titleRequired: true, article: "none", requestType: false, organization: false, contactName: { label: "필명", optional: true }, attachments: true },
  corrections: { kind: "correction", path: "/about/corrections", label: "정정·반론 요청", emailRequired: true, titleRequired: false, article: "required", requestType: true, organization: false, contactName: false, attachments: false },
};

export const CODE_MESSAGES = {
  sent: "접수했습니다",
  bot: "제출할 수 없습니다 — 페이지를 새로 열어 다시 시도해 주세요",
  too_many: "시도가 너무 많습니다. 잠시 뒤 다시 시도하세요",
  body: "내용은 설정된 글자 수 범위로 적어 주세요",
  title: "제목은 1글자 이상 100글자 이하로 적어 주세요",
  name: "이름·회사 이름은 100글자 이하로 적어 주세요",
  email: "연락 이메일 형식을 확인해 주세요",
  privacy: "개인정보 수집·이용에 동의해 주세요",
  request_type: "정정 요청인지 반론 요청인지 골라 주세요",
  article_url: "기사 주소를 적어 주세요",
  attachment_count: "첨부 파일 개수가 너무 많습니다",
  attachment_size: "첨부 파일 크기가 너무 큽니다",
  attachment_type: "허용되지 않는 첨부 파일입니다 — 허용 형식의 파일만 올려 주세요",
  unavailable: "지금은 접수할 수 없습니다 — 잠시 뒤 다시 시도해 주세요",
} as const;
export type HelpCode = keyof typeof CODE_MESSAGES;
export const isHelpCode = (v: unknown): v is HelpCode => typeof v === "string" && Object.hasOwn(CODE_MESSAGES, v);

// ── 설정 help (설계 2.2) ─────────────────────────────────────

export interface HelpSettings {
  maxFiles: number;
  maxTotalBytes: number;
  allowedExtensions: readonly string[];
  bodyMin: number;
  bodyMax: number;
  minFillSeconds: number;
  fillTokenHours: number;
}

const posInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** 설정 help 값 읽기 — 모양이 틀리면 null (서버는 닫는다) */
export function parseHelpSettings(raw: unknown): HelpSettings | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const a = o.attachments as Record<string, unknown> | undefined;
  const b = o.body_chars as Record<string, unknown> | undefined;
  if (!a || !b) return null;
  const ext = a.allowed_extensions;
  if (!posInt(a.max_files) || !posInt(a.max_total_bytes) || !Array.isArray(ext) || !ext.every((e) => typeof e === "string" && /^[a-z0-9]{1,6}$/.test(e))) return null;
  if (!posInt(b.min) || !posInt(b.max) || b.min > b.max || !posInt(o.min_fill_seconds) || !posInt(o.fill_token_hours) || o.fill_token_hours < 1) return null;
  return {
    maxFiles: a.max_files,
    maxTotalBytes: a.max_total_bytes,
    allowedExtensions: ext as string[],
    bodyMin: b.min,
    bodyMax: b.max,
    minFillSeconds: o.min_fill_seconds,
    fillTokenHours: o.fill_token_hours,
  };
}

// ── 폼 열림 토큰 ─────────────────────────────────────────────

const sign = (secret: string, openedMs: number) => createHmac("sha256", secret).update(`help_fill:${openedMs}`).digest("hex").slice(0, 32);

export function signHelpToken(secret: string, openedMs: number): string {
  if (secret === "") throw new Error("해시 열쇠가 비어 있습니다");
  return `${openedMs}.${sign(secret, openedMs)}`;
}

export type HelpFillCheck = "ok" | "bad" | "too_fast" | "expired";
export function checkHelpToken(secret: string, token: unknown, nowMs: number, rules: Pick<HelpSettings, "minFillSeconds" | "fillTokenHours">): HelpFillCheck {
  if (typeof token !== "string") return "bad";
  const m = /^(\d{10,15})\.([0-9a-f]{32})$/.exec(token);
  if (!m) return "bad";
  const given = Buffer.from(m[2]!);
  const expected = Buffer.from(sign(secret, Number(m[1])));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return "bad";
  const elapsed = (nowMs - Number(m[1])) / 1000;
  if (elapsed < rules.minFillSeconds) return "too_fast";
  if (elapsed > rules.fillTokenHours * 3600) return "expired";
  return "ok";
}

// ── 입력 검사 ────────────────────────────────────────────────

const EMAIL_SHAPE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;
export const charCount = (s: string) => Array.from(s).length;

export interface HelpValue {
  kind: HelpFormSpec["kind"];
  body: string;
  maskedKinds: string[];
  title: string | null;
  contactName: string | null;
  organization: string | null;
  contactEmail: string | null;
  requestType: "correction" | "rebuttal" | null;
  articleUrl: string | null;
}
export type HelpParse = { ok: true; value: HelpValue } | { ok: false; code: HelpCode; field: string };

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const truthy = (v: unknown) => v === true || v === "on" || v === "true";

export function parseHelpInput(slug: HelpSlug, raw: Record<string, unknown>, settings: HelpSettings): HelpParse {
  const spec = HELP_FORMS[slug];
  const masked = maskBody(text(raw.body));
  const bodyLen = charCount(masked.text);
  if (bodyLen < settings.bodyMin || bodyLen > settings.bodyMax) return { ok: false, code: "body", field: "body" };

  let title: string | null = null;
  if (spec.titleRequired || text(raw.title) !== "") {
    title = maskBody(text(raw.title)).text;
    if (title === "" || charCount(title) > 100) return { ok: false, code: "title", field: "title" };
  }
  const short = (v: unknown, allowed: boolean): string | null | undefined => {
    const t = text(v);
    if (t === "" || !allowed) return null;
    const m = maskBody(t).text;
    return m === "" || charCount(m) > 100 ? undefined : m;
  };
  const contactName = short(raw.contactName, spec.contactName !== false);
  const organization = short(raw.organization, spec.organization);
  if (contactName === undefined || organization === undefined) return { ok: false, code: "name", field: "contactName" };

  const email = text(raw.contactEmail).toLowerCase();
  if (email !== "" && (email.length > 254 || !EMAIL_SHAPE.test(email))) return { ok: false, code: "email", field: "contactEmail" };
  if (email === "" && spec.emailRequired) return { ok: false, code: "email", field: "contactEmail" };
  if (email !== "" && !truthy(raw.agreePrivacy)) return { ok: false, code: "privacy", field: "agreePrivacy" };

  let requestType: HelpValue["requestType"] = null;
  if (spec.requestType) {
    const t = text(raw.requestType);
    if (t !== "correction" && t !== "rebuttal") return { ok: false, code: "request_type", field: "requestType" };
    requestType = t;
  }
  const articleUrl = text(raw.articleUrl);
  if (spec.article === "required" && articleUrl === "") return { ok: false, code: "article_url", field: "articleUrl" };

  return {
    ok: true,
    value: {
      kind: spec.kind,
      body: masked.text,
      maskedKinds: masked.masked,
      title,
      contactName,
      organization,
      contactEmail: email === "" ? null : email,
      requestType,
      articleUrl: spec.article === "none" || articleUrl === "" ? null : articleUrl.slice(0, 300),
    },
  };
}

/** 기사 주소 → 사이트 안 /news/[slug]이면 slug, 아니면 null (설계 7.1 — 모르는 주소는 본문에 남기고 연결은 비운다) */
export function articleSlugOf(url: string | null, siteHosts: readonly string[]): string | null {
  if (!url) return null;
  let path: string;
  if (url.startsWith("/")) {
    path = url;
  } else {
    try {
      const u = new URL(url);
      if (!["http:", "https:"].includes(u.protocol) || !siteHosts.includes(u.host)) return null;
      path = u.pathname;
    } catch {
      return null;
    }
  }
  const m = /^\/news\/([^/?#]+)\/?(?:[?#].*)?$/.exec(path);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
}

// ── 첨부 검사 ────────────────────────────────────────────────

export interface AttachmentInput {
  name: string;
  size: number;
  /** 파일 앞부분 (최소 8바이트) */
  head: Uint8Array;
}
export interface AttachmentOk {
  ext: string;
  /** 보관하는 원래 이름 (글자 정리 후) */
  name: string;
  bytes: number;
}

const startsWith = (head: Uint8Array, sig: readonly number[]) => sig.every((b, i) => head[i] === b);
const ZIP = [0x50, 0x4b, 0x03, 0x04];
/** 확장자별 파일 앞부분 시그니처 — 이름만 바꾼 실행 파일(MZ)은 어느 것에도 맞지 않는다 */
const SIGNATURES: Readonly<Record<string, readonly (readonly number[])[]>> = {
  pdf: [[0x25, 0x50, 0x44, 0x46]],
  jpg: [[0xff, 0xd8, 0xff]],
  jpeg: [[0xff, 0xd8, 0xff]],
  png: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  docx: [ZIP],
  xlsx: [ZIP],
  hwpx: [ZIP],
  hwp: [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
};

export const MIME_OF: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  hwp: "application/x-hwp",
  hwpx: "application/hwp+zip",
};

/** 원래 이름을 글자 정리 — 경로 문자·제어 문자 제거, 100글자 이하 */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = Array.from(base.normalize("NFKC"))
    .filter((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f && !'<>:"|?*'.includes(ch))
    .join("")
    .replace(/^\.+/, "")
    .trim();
  return Array.from(cleaned).slice(-100).join("") || "file";
}

export type AttachmentCheck = { ok: true; files: AttachmentOk[] } | { ok: false; code: "attachment_count" | "attachment_size" | "attachment_type" };

export function checkAttachments(files: readonly AttachmentInput[], settings: Pick<HelpSettings, "maxFiles" | "maxTotalBytes" | "allowedExtensions">): AttachmentCheck {
  if (files.length > settings.maxFiles) return { ok: false, code: "attachment_count" };
  if (files.reduce((sum, f) => sum + f.size, 0) > settings.maxTotalBytes) return { ok: false, code: "attachment_size" };
  const out: AttachmentOk[] = [];
  for (const f of files) {
    const name = cleanFileName(f.name);
    const ext = (/\.([A-Za-z0-9]{1,6})$/.exec(name)?.[1] ?? "").toLowerCase();
    const sigs = SIGNATURES[ext];
    if (f.size <= 0 || !settings.allowedExtensions.includes(ext) || !sigs || !sigs.some((s) => startsWith(f.head, s))) return { ok: false, code: "attachment_type" };
    out.push({ ext, name, bytes: f.size });
  }
  return { ok: true, files: out };
}
