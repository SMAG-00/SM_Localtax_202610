// 기사 JSON 칸의 저장 모양과 입력 검사 — 순수 함수 (시험: content.test.ts)
//  · articles.body (공개 칸)       = { blocks: 블록[], claims: 핵심 주장[] } — 블록 모양은 @ltr/editorial ArticleBlock.
//    이미지·인포그래픽 블록의 권리 상태는 저장하지 않는다 — 읽을 때 media 표에서 다시 읽는다(작성자가 '확인됨'을 적어 넣을 수 없다).
//  · articles.tax_lens (공개 칸)   = { topics, points, links, skip_reason, reviewed, reviewed_for_version } (01B CORE-01).
//    reviewed·reviewed_for_version은 서버만 쓴다 — 세무 감수 승인 때 켜고, 박스를 고치면 그 버전에서 멈춘다(재감수 필요).
//  · articles.solved_case          = @ltr/editorial SolvedCase (CAT-05)
//  · articles.check_log (비공개 칸) = { checklists: 취재 확인 목록, publish: 마지막 발행 기록 } — NAV-10·NAV-11 확인 목록은
//    공개 칸(body)에 두지 않는다(관계자 확인 기록·동의 여부 등). '인과 단정 없음'은 편집 승인(desk_edit) checklist에서 읽는다.
//  · 근거 참조 ID — 공개 출처는 "src:<article_sources.id>", 비공개 근거는 "ev:<article_evidence.id>" (두 표의 번호가 겹치지 않게)
import {
  CALLOUT_KINDS,
  PERSPECTIVE_KEYS,
  TAX_LENS_LINK_KINDS,
  type ArticleBlock,
  type ChartLabels,
  type CoreClaim,
  type PerspectiveKey,
  type PerspectiveRecord,
  type QualitativeChecklist,
  type SolvedCase,
  type TaxLensLinkKind,
} from "@ltr/editorial";

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** 저장하는 블록 — 이미지·인포그래픽의 rightsStatus는 빼고 저장한다 */
export type StoredBlock =
  | Exclude<ArticleBlock, { type: "image" } | { type: "infographic" }>
  | Omit<Extract<ArticleBlock, { type: "image" }>, "rightsStatus">
  | Omit<Extract<ArticleBlock, { type: "infographic" }>, "rightsStatus">;

export interface StoredBody {
  blocks: StoredBlock[];
  claims: CoreClaim[];
}

export interface TaxLensLink {
  kind: TaxLensLinkKind;
  label: string;
  url: string;
}

/** 편집 화면이 보내는 「지방세로 읽기」 — 감수 표시는 받지 않는다 */
export interface TaxLensInput {
  topics: string[];
  points: string[];
  links: TaxLensLink[];
  omissionReason: string | null;
}

/** DB에 저장하는 「지방세로 읽기」 */
export interface StoredTaxLens {
  topics: string[];
  points: string[];
  links: TaxLensLink[];
  skip_reason: string | null;
  reviewed: boolean;
  reviewed_for_version: number | null;
}

/** 취재 확인 목록 (check_log.checklists) */
export interface Checklists {
  hasTaxOrLegalClaims: boolean;
  isTaxIssue: boolean;
  isLocalPolicyIssue: boolean;
  isInheritanceGiftCase: boolean;
  quantitative: { sourceCrossCheck: string | null; limitations: string | null; relatedPartyCheck: string | null } | null;
  qualitative: QualitativeChecklist | null;
  perspectives: Record<PerspectiveKey, PerspectiveRecord | null>;
  originalTextChecks: { sourceId: string; checkedAt: string | null }[];
  inheritanceGift: { consent: boolean; deidentified: boolean };
}

export const EMPTY_CHECKLISTS: Checklists = {
  hasTaxOrLegalClaims: false,
  isTaxIssue: false,
  isLocalPolicyIssue: false,
  isInheritanceGiftCase: false,
  quantitative: null,
  qualitative: null,
  perspectives: { local_gov: null, residents_taxpayers: null, experts: null },
  originalTextChecks: [],
  inheritanceGift: { consent: false, deidentified: false },
};

/** 근거 참조 ID */
export const sourceRef = (id: number | string) => `src:${id}`;
export const evidenceRef = (id: number | string) => `ev:${id}`;
const REF = /^(src|ev):[1-9]\d*$/;

// ── 작은 검사 도구 ─────────────────────────────────────────

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

class Checker {
  readonly errors: string[] = [];
  fail(path: string, message: string): void {
    this.errors.push(`${path}: ${message}`);
  }
  text(o: Obj, key: string, path: string, { required = true, max = 20000 } = {}): string {
    const v = o[key];
    if (v === undefined || v === null) {
      if (required) this.fail(`${path}.${key}`, "글자가 필요합니다");
      return "";
    }
    if (typeof v !== "string") {
      this.fail(`${path}.${key}`, "글자여야 합니다");
      return "";
    }
    if (v.length > max) this.fail(`${path}.${key}`, `${max}자 이하여야 합니다`);
    return v;
  }
  optText(o: Obj, key: string, path: string, max = 20000): string | null {
    const v = o[key];
    if (v === undefined || v === null) return null;
    if (typeof v !== "string") {
      this.fail(`${path}.${key}`, "글자 또는 null이어야 합니다");
      return null;
    }
    if (v.length > max) this.fail(`${path}.${key}`, `${max}자 이하여야 합니다`);
    return v;
  }
  texts(o: Obj, key: string, path: string, { required = true, maxItems = 200 } = {}): string[] {
    const v = o[key];
    if (v === undefined || v === null) {
      if (required) this.fail(`${path}.${key}`, "글자 목록이 필요합니다");
      return [];
    }
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
      this.fail(`${path}.${key}`, "글자 목록이어야 합니다");
      return [];
    }
    if (v.length > maxItems) this.fail(`${path}.${key}`, `${maxItems}개 이하여야 합니다`);
    return v as string[];
  }
  bool(o: Obj, key: string, path: string): boolean {
    const v = o[key];
    if (v === undefined || v === null) return false;
    if (typeof v !== "boolean") this.fail(`${path}.${key}`, "true/false여야 합니다");
    return v === true;
  }
  oneOf<T extends string>(o: Obj, key: string, path: string, values: readonly T[]): T {
    const v = o[key];
    if (typeof v !== "string" || !(values as readonly string[]).includes(v)) {
      this.fail(`${path}.${key}`, `${values.join("·")} 중 하나여야 합니다`);
      return values[0]!;
    }
    return v as T;
  }
  object(v: unknown, path: string): Obj | null {
    if (!isObj(v)) {
      this.fail(path, "객체여야 합니다");
      return null;
    }
    return v;
  }
  done<T>(value: T): Result<T> {
    return this.errors.length ? { ok: false, errors: this.errors } : { ok: true, value };
  }
}

// ── 본문 (body) ────────────────────────────────────────────

const BLOCK_TYPES = ["paragraph", "table", "image", "quote", "callout", "infographic", "video", "faq", "key_summary"] as const;
const CLAIM_KINDS = ["fact", "tax_calculation", "legal"] as const;
const MEDIA_ID = /^[1-9]\d*$/;
const MAX_BLOCKS = 400;

function chart(c: Checker, o: Obj, path: string): ChartLabels | null {
  const v = o.chart;
  if (v === undefined || v === null) return null;
  const co = c.object(v, `${path}.chart`);
  if (!co) return null;
  return {
    axis: c.text(co, "axis", `${path}.chart`, { required: false }),
    unit: c.text(co, "unit", `${path}.chart`, { required: false }),
    source: c.text(co, "source", `${path}.chart`, { required: false }),
  };
}

function checklistOf(c: Checker, o: Obj, path: string): { checklist?: { actionWritten?: boolean } } {
  if (o.checklist === undefined || o.checklist === null) return {};
  const co = c.object(o.checklist, `${path}.checklist`);
  if (!co) return {};
  return { checklist: { actionWritten: c.bool(co, "actionWritten", `${path}.checklist`) } };
}

function mediaIdOf(c: Checker, o: Obj, path: string): string {
  const raw = o.mediaId;
  const id = typeof raw === "number" ? String(raw) : raw;
  if (typeof id !== "string" || !MEDIA_ID.test(id)) {
    c.fail(`${path}.mediaId`, "media 표의 번호여야 합니다");
    return "0";
  }
  return id;
}

function block(c: Checker, raw: unknown, path: string): StoredBlock | null {
  const o = c.object(raw, path);
  if (!o) return null;
  if (!(BLOCK_TYPES as readonly unknown[]).includes(o.type)) {
    c.fail(`${path}.type`, `${BLOCK_TYPES.join("·")} 중 하나여야 합니다`);
    return null;
  }
  const type = o.type as (typeof BLOCK_TYPES)[number];
  const extra = checklistOf(c, o, path);
  switch (type) {
    case "paragraph":
      return { type, text: c.text(o, "text", path), ...extra };
    case "table": {
      const rows = o.rows;
      const okRows = Array.isArray(rows) && rows.every((r) => Array.isArray(r) && r.every((x) => typeof x === "string"));
      if (!okRows) c.fail(`${path}.rows`, "글자 표(2차원 목록)여야 합니다");
      return { type, caption: c.text(o, "caption", path), rows: okRows ? (rows as string[][]) : [], chart: chart(c, o, path), ...extra };
    }
    case "image":
      return { type, mediaId: mediaIdOf(c, o, path), alt: c.text(o, "alt", path, { required: false }), caption: c.text(o, "caption", path, { required: false }), ...extra };
    case "infographic":
      return {
        type,
        mediaId: mediaIdOf(c, o, path),
        alt: c.text(o, "alt", path, { required: false }),
        caption: c.text(o, "caption", path, { required: false }),
        chart: chart(c, o, path),
        ...extra,
      };
    case "quote": {
      const refId = c.optText(o, "refId", path, 40);
      if (refId !== null && !REF.test(refId)) c.fail(`${path}.refId`, "근거 참조(src:<번호> 또는 ev:<번호>)여야 합니다");
      return {
        type,
        text: c.text(o, "text", path),
        speaker: c.text(o, "speaker", path, { required: false }),
        origin: c.oneOf(o, "origin", path, ["interview", "document"] as const),
        refId,
        ...extra,
      };
    }
    case "callout":
      return { type, kind: c.oneOf(o, "kind", path, CALLOUT_KINDS), title: c.text(o, "title", path, { required: false }), text: c.text(o, "text", path), ...extra };
    case "video":
      return { type, embedUrl: c.text(o, "embedUrl", path), caption: c.text(o, "caption", path, { required: false }), ...extra };
    case "faq": {
      const items = Array.isArray(o.items) ? o.items : null;
      if (!items) c.fail(`${path}.items`, "질문·답 목록이어야 합니다");
      const parsed = (items ?? []).map((it, i) => {
        const io = c.object(it, `${path}.items[${i}]`) ?? {};
        return { question: c.text(io, "question", `${path}.items[${i}]`), answer: c.text(io, "answer", `${path}.items[${i}]`) };
      });
      return { type, items: parsed, ...extra };
    }
    case "key_summary":
      return { type, lines: c.texts(o, "lines", path), ...extra };
  }
}

function claim(c: Checker, raw: unknown, path: string, blockCount: number): CoreClaim | null {
  const o = c.object(raw, path);
  if (!o) return null;
  const evidenceIds = c.texts(o, "evidenceIds", path, { required: false });
  for (const id of evidenceIds) if (!REF.test(id)) c.fail(`${path}.evidenceIds`, `근거 참조 형식이 아닙니다 (${id.slice(0, 40)})`);
  const bi = o.blockIndex;
  let blockIndex: number | null = null;
  if (bi !== undefined && bi !== null) {
    if (typeof bi !== "number" || !Number.isInteger(bi) || bi < 0 || bi >= blockCount) c.fail(`${path}.blockIndex`, "본문 블록 번호여야 합니다");
    else blockIndex = bi;
  }
  return {
    id: c.text(o, "id", path, { max: 80 }),
    text: c.text(o, "text", path),
    kind: c.oneOf(o, "kind", path, CLAIM_KINDS),
    evidenceIds,
    blockIndex,
  };
}

/** 편집 화면이 보낸 본문 검사 — { blocks, claims } (claims는 비울 수 있다) */
export function parseBodyInput(raw: unknown): Result<StoredBody> {
  const c = new Checker();
  const o = c.object(raw, "body");
  if (!o) return c.done({ blocks: [], claims: [] });
  if (!Array.isArray(o.blocks)) c.fail("body.blocks", "블록 목록이어야 합니다");
  const rawBlocks = Array.isArray(o.blocks) ? o.blocks : [];
  if (rawBlocks.length > MAX_BLOCKS) c.fail("body.blocks", `블록은 ${MAX_BLOCKS}개 이하여야 합니다`);
  const blocks = rawBlocks.map((b, i) => block(c, b, `body.blocks[${i}]`)).filter((b): b is StoredBlock => b !== null);
  if (o.claims !== undefined && o.claims !== null && !Array.isArray(o.claims)) c.fail("body.claims", "핵심 주장 목록이어야 합니다");
  const rawClaims = Array.isArray(o.claims) ? o.claims : [];
  const claims = rawClaims.map((x, i) => claim(c, x, `body.claims[${i}]`, rawBlocks.length)).filter((x): x is CoreClaim => x !== null);
  const ids = claims.map((x) => x.id);
  if (new Set(ids).size !== ids.length) c.fail("body.claims", "핵심 주장 id가 겹칩니다");
  return c.done({ blocks, claims });
}

/** DB에서 읽은 본문 — 배열(블록만)도 받는다. 모양이 틀린 블록은 뺀다 (쓰기는 parseBodyInput을 거친다) */
export function readStoredBody(json: unknown): StoredBody {
  const raw = Array.isArray(json) ? { blocks: json, claims: [] } : isObj(json) ? json : { blocks: [], claims: [] };
  const blocks = (Array.isArray(raw.blocks) ? raw.blocks : []).flatMap((b, i) => {
    const c = new Checker();
    const parsed = block(c, b, `blocks[${i}]`);
    return parsed && c.errors.length === 0 ? [parsed] : [];
  });
  const claims = (Array.isArray(raw.claims) ? raw.claims : []).flatMap((x, i) => {
    const c = new Checker();
    const parsed = claim(c, x, `claims[${i}]`, blocks.length);
    return parsed && c.errors.length === 0 ? [parsed] : [];
  });
  return { blocks, claims };
}

// ── 「지방세로 읽기」 ───────────────────────────────────────

export function parseTaxLensInput(raw: unknown): Result<TaxLensInput | null> {
  if (raw === null) return { ok: true, value: null };
  const c = new Checker();
  const o = c.object(raw, "taxLens");
  if (!o) return c.done(null);
  const linksRaw = o.links === undefined || o.links === null ? [] : o.links;
  if (!Array.isArray(linksRaw)) c.fail("taxLens.links", "링크 목록이어야 합니다");
  const links = (Array.isArray(linksRaw) ? linksRaw : []).map((l, i) => {
    const lo = c.object(l, `taxLens.links[${i}]`) ?? {};
    return {
      kind: c.oneOf(lo, "kind", `taxLens.links[${i}]`, TAX_LENS_LINK_KINDS),
      label: c.text(lo, "label", `taxLens.links[${i}]`, { max: 200 }),
      url: c.text(lo, "url", `taxLens.links[${i}]`, { max: 2000 }),
    };
  });
  const omission = c.optText(o, "omissionReason", "taxLens", 2000);
  return c.done({
    topics: c.texts(o, "topics", "taxLens", { required: false, maxItems: 20 }),
    points: c.texts(o, "points", "taxLens", { required: false, maxItems: 20 }),
    links,
    omissionReason: omission !== null && omission.trim() !== "" ? omission : null,
  });
}

export function readStoredTaxLens(json: unknown): StoredTaxLens | null {
  if (!isObj(json)) return null;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const links = (Array.isArray(json.links) ? json.links : []).flatMap((l) =>
    isObj(l) && typeof l.url === "string" && (TAX_LENS_LINK_KINDS as readonly string[]).includes(String(l.kind))
      ? [{ kind: l.kind as TaxLensLinkKind, label: typeof l.label === "string" ? l.label : "", url: l.url }]
      : [],
  );
  const skip = typeof json.skip_reason === "string" && json.skip_reason.trim() !== "" ? json.skip_reason : null;
  const version = json.reviewed_for_version;
  return {
    topics: strings(json.topics),
    points: strings(json.points),
    links,
    skip_reason: skip,
    reviewed: json.reviewed === true,
    reviewed_for_version: typeof version === "number" && Number.isInteger(version) ? version : null,
  };
}

/** 박스 내용(세목·포인트·링크·생략 사유)이 같은가 — 같으면 감수 표시를 새 버전으로 옮긴다 */
export function sameTaxLensContent(a: StoredTaxLens | null, b: StoredTaxLens | null): boolean {
  const key = (l: StoredTaxLens | null) => (l === null ? null : JSON.stringify([l.topics, l.points, l.links, l.skip_reason]));
  return key(a) === key(b);
}

// ── 해결 사례 ─────────────────────────────────────────────

export function parseSolvedCaseInput(raw: unknown): Result<SolvedCase | null> {
  if (raw === null) return { ok: true, value: null };
  const c = new Checker();
  const o = c.object(raw, "solvedCase");
  if (!o) return c.done(null);
  const evRaw = o.resultEvidence === undefined || o.resultEvidence === null ? [] : o.resultEvidence;
  if (!Array.isArray(evRaw)) c.fail("solvedCase.resultEvidence", "근거 목록이어야 합니다");
  const resultEvidence = (Array.isArray(evRaw) ? evRaw : []).map((e, i) => {
    const eo = c.object(e, `solvedCase.resultEvidence[${i}]`) ?? {};
    return {
      kind: c.oneOf(eo, "kind", `solvedCase.resultEvidence[${i}]`, ["decision", "interpretation"] as const),
      number: c.text(eo, "number", `solvedCase.resultEvidence[${i}]`, { max: 200 }),
      url: c.text(eo, "url", `solvedCase.resultEvidence[${i}]`, { max: 2000 }),
    };
  });
  return c.done({
    situation: c.text(o, "situation", "solvedCase", { required: false }),
    issue: c.text(o, "issue", "solvedCase", { required: false }),
    result: c.text(o, "result", "solvedCase", { required: false }),
    lesson: c.text(o, "lesson", "solvedCase", { required: false }),
    resultEvidence,
  });
}

export function readStoredSolvedCase(json: unknown): SolvedCase | null {
  if (!isObj(json)) return null;
  const parsed = parseSolvedCaseInput(json);
  return parsed.ok ? parsed.value : null;
}

// ── 취재 확인 목록 (check_log.checklists) ──────────────────

function perspective(c: Checker, raw: unknown, path: string): PerspectiveRecord | null {
  if (raw === undefined || raw === null) return null;
  const o = c.object(raw, path);
  if (!o) return null;
  const evidenceId = c.optText(o, "evidenceId", path, 40);
  // 관점 기록은 비공개 취재 근거(인터뷰·현장 기록)만 가리킨다
  if (evidenceId !== null && !/^ev:[1-9]\d*$/.test(evidenceId)) c.fail(`${path}.evidenceId`, "근거 참조(ev:<번호>)여야 합니다");
  return {
    status: c.oneOf(o, "status", path, ["interviewed", "no_response"] as const),
    evidenceId,
    contactedAt: c.optText(o, "contactedAt", path, 40),
  };
}

/** 편집 화면이 보낸 확인 목록 — base에 덮어쓴다(보낸 칸만 바뀐다) */
export function parseChecklistsInput(raw: unknown, base: Checklists): Result<Checklists> {
  const c = new Checker();
  const o = c.object(raw, "checklists");
  if (!o) return c.done(base);
  const out: Checklists = { ...base, perspectives: { ...base.perspectives } };
  for (const flag of ["hasTaxOrLegalClaims", "isTaxIssue", "isLocalPolicyIssue", "isInheritanceGiftCase"] as const) {
    if (o[flag] !== undefined) out[flag] = c.bool(o, flag, "checklists");
  }
  if (o.quantitative !== undefined) {
    const q = o.quantitative === null ? null : c.object(o.quantitative, "checklists.quantitative");
    out.quantitative = q
      ? {
          sourceCrossCheck: c.optText(q, "sourceCrossCheck", "checklists.quantitative"),
          limitations: c.optText(q, "limitations", "checklists.quantitative"),
          relatedPartyCheck: c.optText(q, "relatedPartyCheck", "checklists.quantitative"),
        }
      : null;
  }
  if (o.qualitative !== undefined) {
    const q = o.qualitative === null ? null : c.object(o.qualitative, "checklists.qualitative");
    out.qualitative = q
      ? {
          interviewQuestions: c.optText(q, "interviewQuestions", "checklists.qualitative"),
          fieldRecord: c.optText(q, "fieldRecord", "checklists.qualitative"),
          counterPerspective: c.optText(q, "counterPerspective", "checklists.qualitative"),
          conflictsOfInterest: c.optText(q, "conflictsOfInterest", "checklists.qualitative"),
        }
      : null;
  }
  if (o.perspectives !== undefined) {
    const p = c.object(o.perspectives, "checklists.perspectives");
    if (p) for (const key of PERSPECTIVE_KEYS) if (p[key] !== undefined) out.perspectives[key] = perspective(c, p[key], `checklists.perspectives.${key}`);
  }
  if (o.originalTextChecks !== undefined) {
    if (!Array.isArray(o.originalTextChecks)) c.fail("checklists.originalTextChecks", "목록이어야 합니다");
    out.originalTextChecks = (Array.isArray(o.originalTextChecks) ? o.originalTextChecks : []).map((x, i) => {
      const xo = c.object(x, `checklists.originalTextChecks[${i}]`) ?? {};
      const sourceId = c.text(xo, "sourceId", `checklists.originalTextChecks[${i}]`, { max: 40 });
      if (!/^src:[1-9]\d*$/.test(sourceId)) c.fail(`checklists.originalTextChecks[${i}].sourceId`, "출처 참조(src:<번호>)여야 합니다");
      return { sourceId, checkedAt: c.optText(xo, "checkedAt", `checklists.originalTextChecks[${i}]`, 40) };
    });
  }
  if (o.inheritanceGift !== undefined) {
    const g = c.object(o.inheritanceGift, "checklists.inheritanceGift");
    if (g) out.inheritanceGift = { consent: c.bool(g, "consent", "checklists.inheritanceGift"), deidentified: c.bool(g, "deidentified", "checklists.inheritanceGift") };
  }
  return c.done(out);
}

export function readChecklists(checkLog: unknown): Checklists {
  const raw = isObj(checkLog) ? checkLog.checklists : undefined;
  if (!isObj(raw)) return EMPTY_CHECKLISTS;
  const parsed = parseChecklistsInput(raw, EMPTY_CHECKLISTS);
  return parsed.ok ? parsed.value : EMPTY_CHECKLISTS;
}

/** check_log에 확인 목록을 넣는다 (다른 칸은 그대로) */
export function withChecklists(checkLog: unknown, checklists: Checklists): Record<string, unknown> {
  return { ...(isObj(checkLog) ? checkLog : {}), checklists };
}

/** check_log에 마지막 발행 기록을 넣는다 */
export function withPublishRecord(checkLog: unknown, record: Record<string, unknown>): Record<string, unknown> {
  return { ...(isObj(checkLog) ? checkLog : {}), publish: record };
}
