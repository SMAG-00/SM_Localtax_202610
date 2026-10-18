// 기사 편집기 상태 — 저장된 기사(GET /api/admin/articles/[id]) ↔ 편집기 상태 ↔ PATCH 요청 본문. 순수 함수 (시험: editor-state.test.ts)
// 블록·핵심 주장은 화면 안에서 고유 key로 다룬다 — 블록 순서를 바꿔도 핵심 주장이 같은 블록을 가리킨다.
import {
  ACTION_TRIGGER_WORDS,
  RESERVED_SLUGS,
  ROSE_BOX_TITLE,
  headLengthProblem,
  infographicSaveProblems,
  parseYoutubeEmbed,
  type BlockType,
  type CalloutKind,
  type CoreClaim,
  type InfographicTemplate,
  type SolvedCase,
  type TaxLensLinkKind,
} from "@ltr/editorial";
import type { Checklists, StoredBlock, StoredBody, StoredTaxLens } from "@/lib/server/articles/content";
import { blank, idOrNull, isValidDate, splitLines, splitList, textOrNull, type FieldErrors } from "./form-utils";
import { INFOGRAPHIC_SKELETONS, durationFromText, infographicDataFromText, infographicDataToText, type InfographicDataKind } from "./media-blocks";
import { rowsToText, textToRows } from "./table-text";

/** 편집기가 받는 기사 — GET /api/admin/articles/[id]의 article 칸 */
export interface EditorArticle {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  status: string;
  version: number;
  firstPublishedAt: string | null;
  section: string;
  categoryId: number | null;
  contentType: string | null;
  reportingMethod: string | null;
  format: string;
  subtype: string;
  label: string;
  partnerId: number | null;
  leadMediaId: number | null;
  legalBasisDate: string | null;
  regionCodes: string[];
  editorialField: string | null;
  publicQuestion: string | null;
  /** 칼럼 연재 (ART-04) — 칼럼만 */
  seriesTitle: string | null;
  seriesEpisode: number | null;
  body: StoredBody;
  solvedCase: SolvedCase | null;
  taxLens: StoredTaxLens | null;
  checklists: Checklists;
}

/** 블록 한 개 — 모든 종류의 칸을 한 모양으로 둔다 (종류에 맞는 칸만 저장한다) */
export interface BlockDraft {
  key: string;
  type: BlockType;
  text: string;
  caption: string;
  rowsText: string;
  axis: string;
  unit: string;
  source: string;
  mediaId: string;
  alt: string;
  speaker: string;
  origin: "interview" | "document";
  refId: string;
  kind: CalloutKind;
  title: string;
  embedUrl: string;
  items: { question: string; answer: string }[];
  linesText: string;
  actionWritten: boolean;
  /** 인포그래픽 (ART-07) — 템플릿 · 같은 내용의 종류(표·목록)와 칸 글자(표는 첫 줄이 머리 칸, 칸은 | · 목록은 줄마다 한 항목) */
  template: InfographicTemplate;
  dataKind: InfographicDataKind;
  dataText: string;
  /** 동영상 (ART-08) — 요약 텍스트 · '자막 있음' 확인 · 썸네일 media 번호 · 재생 시간(초 글자) */
  summary: string;
  captions: boolean;
  thumbnailMediaId: string;
  durationText: string;
}

export interface ClaimDraft {
  key: string;
  id: string;
  text: string;
  kind: CoreClaim["kind"];
  evidenceIds: string[];
  /** 문장이 있는 블록의 key — 없으면 "" */
  blockKey: string;
}

export type TaxLensMode = "none" | "box" | "skip";

export interface EditorState {
  title: string;
  slug: string;
  summary: string;
  section: string;
  categoryId: string;
  contentType: string;
  reportingMethod: string;
  format: string;
  label: string;
  partnerId: string;
  leadMediaId: string;
  legalBasisDate: string;
  regionCodesText: string;
  editorialField: string;
  publicQuestion: string;
  /** 칼럼 연재 이름·회차 (ART-04) — 둘 다 적거나 둘 다 비운다 */
  seriesTitle: string;
  seriesEpisodeText: string;
  blocks: BlockDraft[];
  claims: ClaimDraft[];
  checklists: Checklists;
  taxLensMode: TaxLensMode;
  taxTopicsText: string;
  taxPointsText: string;
  taxLinks: { kind: TaxLensLinkKind; label: string; url: string }[];
  omissionReason: string;
  subtype: string;
  solvedCase: SolvedCase | null;
  /** 발행 뒤 수정 (ART-05) */
  updateKind: string;
  reason: string;
}

// ── 블록 ────────────────────────────────────────────────

const EMPTY_BLOCK: Omit<BlockDraft, "key" | "type"> = {
  text: "",
  caption: "",
  rowsText: "",
  axis: "",
  unit: "",
  source: "",
  mediaId: "",
  alt: "",
  speaker: "",
  origin: "interview",
  refId: "",
  kind: "info",
  title: "",
  embedUrl: "",
  items: [],
  linesText: "",
  actionWritten: false,
  template: "flow",
  dataKind: INFOGRAPHIC_SKELETONS.flow.kind,
  dataText: INFOGRAPHIC_SKELETONS.flow.text,
  summary: "",
  captions: false,
  thumbnailMediaId: "",
  durationText: "",
};

export { rowsToText, textToRows };

export function newBlock(type: BlockType, key: string): BlockDraft {
  const block: BlockDraft = { ...EMPTY_BLOCK, key, type, items: [] };
  if (type === "faq") block.items = [{ question: "", answer: "" }];
  return block;
}

export function blockFromStored(b: StoredBlock, key: string): BlockDraft {
  const d: BlockDraft = { ...newBlock(b.type, key), items: [], actionWritten: b.checklist?.actionWritten === true };
  switch (b.type) {
    case "paragraph":
      return { ...d, text: b.text };
    case "table":
      return { ...d, caption: b.caption, rowsText: rowsToText(b.rows), axis: b.chart?.axis ?? "", unit: b.chart?.unit ?? "", source: b.chart?.source ?? "" };
    case "image":
      return { ...d, mediaId: b.mediaId, alt: b.alt, caption: b.caption };
    case "infographic": {
      const data = infographicDataToText(b.data);
      return {
        ...d,
        mediaId: b.mediaId,
        alt: b.alt,
        caption: b.caption,
        axis: b.chart?.axis ?? "",
        unit: b.chart?.unit ?? "",
        source: b.chart?.source ?? "",
        template: b.template,
        dataKind: data.kind,
        dataText: data.text,
      };
    }
    case "quote":
      return { ...d, text: b.text, speaker: b.speaker, origin: b.origin, refId: b.refId ?? "" };
    case "callout":
      return { ...d, kind: b.kind, title: b.title, text: b.text };
    case "video":
      return {
        ...d,
        embedUrl: b.embedUrl,
        caption: b.caption,
        summary: b.summary,
        captions: b.captions,
        thumbnailMediaId: b.thumbnailMediaId ?? "",
        durationText: b.durationSeconds === null ? "" : String(b.durationSeconds),
      };
    case "faq":
      return { ...d, items: b.items.map((i) => ({ question: i.question, answer: i.answer })) };
    case "key_summary":
      return { ...d, linesText: b.lines.join("\n") };
    case "slide":
      return { ...d, title: b.title, text: b.text, alt: b.alt };
  }
}

function chartOf(d: BlockDraft): { axis: string; unit: string; source: string } | null {
  if (blank(d.axis) && blank(d.unit) && blank(d.source)) return null;
  return { axis: d.axis.trim(), unit: d.unit.trim(), source: d.source.trim() };
}

export function blockToStored(d: BlockDraft): StoredBlock {
  const checklist = d.actionWritten ? { checklist: { actionWritten: true } } : {};
  switch (d.type) {
    case "paragraph":
      return { type: "paragraph", text: d.text, ...checklist };
    case "table":
      return { type: "table", caption: d.caption, rows: textToRows(d.rowsText), chart: chartOf(d), ...checklist };
    case "image":
      return { type: "image", mediaId: d.mediaId.trim(), alt: d.alt, caption: d.caption, ...checklist };
    case "infographic":
      return {
        type: "infographic",
        mediaId: d.mediaId.trim(),
        alt: d.alt,
        caption: d.caption,
        chart: chartOf(d),
        template: d.template,
        data: infographicDataFromText(d.dataKind, d.dataText),
        ...checklist,
      };
    case "quote":
      return { type: "quote", text: d.text, speaker: d.speaker, origin: d.origin, refId: blank(d.refId) ? null : d.refId.trim(), ...checklist };
    case "callout":
      // rose 상자('자주 틀리는 점')는 제목이 고정이다 (UX-03)
      return { type: "callout", kind: d.kind, title: d.kind === "mistake" ? ROSE_BOX_TITLE : d.title, text: d.text, ...checklist };
    case "video": {
      const duration = durationFromText(d.durationText);
      return {
        type: "video",
        embedUrl: d.embedUrl.trim(),
        caption: d.caption,
        summary: d.summary,
        captions: d.captions,
        thumbnailMediaId: blank(d.thumbnailMediaId) ? null : d.thumbnailMediaId.trim(),
        // 잘못된 재생 시간은 저장 전 확인(validateEditor)이 막는다 — 여기서는 빈 값으로
        durationSeconds: duration === null || Number.isNaN(duration) ? null : duration,
        ...checklist,
      };
    }
    case "faq":
      return { type: "faq", items: d.items.map((i) => ({ question: i.question, answer: i.answer })), ...checklist };
    case "key_summary":
      return { type: "key_summary", lines: splitLines(d.linesText), ...checklist };
    case "slide":
      return { type: "slide", title: d.title, text: d.text, alt: d.alt, ...checklist };
  }
}

/** '기한'·'가산세'가 든 블록 — '할 일을 함께 썼다' 확인이 필요하다 (UX-03) */
export function needsActionCheck(d: BlockDraft): boolean {
  const text = [d.text, d.caption, d.title, d.linesText, d.rowsText, d.summary, d.dataText, ...d.items.flatMap((i) => [i.question, i.answer])].join("\n");
  return ACTION_TRIGGER_WORDS.some((w) => text.includes(w));
}

export function addBlock(blocks: readonly BlockDraft[], type: BlockType, makeKey: () => string): BlockDraft[] {
  return [...blocks, newBlock(type, makeKey())];
}

export function removeBlock(blocks: readonly BlockDraft[], index: number): BlockDraft[] {
  return blocks.filter((_, i) => i !== index);
}

/** 블록을 앞(-1)·뒤(+1)로 — 끝을 넘으면 그대로 */
export function moveBlock(blocks: readonly BlockDraft[], index: number, step: -1 | 1): BlockDraft[] {
  const to = index + step;
  if (index < 0 || index >= blocks.length || to < 0 || to >= blocks.length) return [...blocks];
  const next = [...blocks];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

export function updateBlock(blocks: readonly BlockDraft[], key: string, patch: Partial<BlockDraft>): BlockDraft[] {
  return blocks.map((b) => (b.key === key ? { ...b, ...patch } : b));
}

// ── 상태 만들기 ─────────────────────────────────────────

function textOf(v: string | null | undefined): string {
  return v ?? "";
}

/** 정량형·정성형 기사면 확인 목록 칸이 있게(빈 칸) 한다 — 화면이 칸을 그릴 수 있게 (취재 방식을 바꿀 때도 부른다) */
export function withMethodChecklists(c: Checklists, contentType: string | null, method: string | null): Checklists {
  const out = { ...c, perspectives: { ...c.perspectives } };
  const reported = contentType === "reported_news";
  if (reported && (method === "quantitative" || method === "mixed") && !out.quantitative) out.quantitative = { sourceCrossCheck: null, limitations: null, relatedPartyCheck: null };
  if (reported && (method === "qualitative" || method === "mixed") && !out.qualitative) {
    out.qualitative = { interviewQuestions: null, fieldRecord: null, counterPerspective: null, conflictsOfInterest: null };
  }
  return out;
}

export function editorStateFromArticle(a: EditorArticle, makeKey: () => string): EditorState {
  const blocks = a.body.blocks.map((b) => blockFromStored(b, makeKey()));
  const claims = a.body.claims.map((c) => ({
    key: makeKey(),
    id: c.id,
    text: c.text,
    kind: c.kind,
    evidenceIds: [...c.evidenceIds],
    blockKey: c.blockIndex !== null && blocks[c.blockIndex] ? blocks[c.blockIndex]!.key : "",
  }));
  const lens = a.taxLens;
  const mode: TaxLensMode = lens === null ? "none" : lens.skip_reason ? "skip" : "box";
  return {
    title: a.title,
    slug: a.slug,
    summary: textOf(a.summary),
    section: a.section,
    categoryId: a.categoryId === null ? "" : String(a.categoryId),
    contentType: textOf(a.contentType),
    reportingMethod: textOf(a.reportingMethod),
    format: a.format,
    label: a.label,
    partnerId: a.partnerId === null ? "" : String(a.partnerId),
    leadMediaId: a.leadMediaId === null ? "" : String(a.leadMediaId),
    legalBasisDate: textOf(a.legalBasisDate),
    regionCodesText: a.regionCodes.join(", "),
    editorialField: textOf(a.editorialField),
    publicQuestion: textOf(a.publicQuestion),
    seriesTitle: textOf(a.seriesTitle),
    seriesEpisodeText: a.seriesEpisode === null ? "" : String(a.seriesEpisode),
    blocks,
    claims,
    checklists: withMethodChecklists(a.checklists, a.contentType, a.reportingMethod),
    taxLensMode: mode,
    taxTopicsText: lens ? lens.topics.join(", ") : "",
    taxPointsText: lens ? lens.points.join("\n") : "",
    taxLinks: lens ? lens.links.map((l) => ({ ...l })) : [],
    omissionReason: lens?.skip_reason ?? "",
    subtype: a.subtype,
    solvedCase: a.solvedCase ? { ...a.solvedCase, resultEvidence: a.solvedCase.resultEvidence.map((e) => ({ ...e })) } : null,
    updateKind: "",
    reason: "",
  };
}

/** 다음 핵심 주장 id — claim-1, claim-2 … 쓰지 않은 번호 */
export function nextClaimId(claims: readonly ClaimDraft[]): string {
  const used = new Set(claims.map((c) => c.id));
  let i = claims.length + 1;
  while (used.has(`claim-${i}`)) i++;
  return `claim-${i}`;
}

// ── 요청 본문 ───────────────────────────────────────────

function cleanChecklists(c: Checklists): Checklists {
  const t = (v: string | null) => textOrNull(v);
  return {
    ...c,
    quantitative: c.quantitative
      ? { sourceCrossCheck: t(c.quantitative.sourceCrossCheck), limitations: t(c.quantitative.limitations), relatedPartyCheck: t(c.quantitative.relatedPartyCheck) }
      : null,
    qualitative: c.qualitative
      ? {
          interviewQuestions: t(c.qualitative.interviewQuestions),
          fieldRecord: t(c.qualitative.fieldRecord),
          counterPerspective: t(c.qualitative.counterPerspective),
          conflictsOfInterest: t(c.qualitative.conflictsOfInterest),
        }
      : null,
    perspectives: { ...c.perspectives },
    originalTextChecks: c.originalTextChecks.filter((x) => !blank(x.sourceId)).map((x) => ({ sourceId: x.sourceId, checkedAt: t(x.checkedAt) })),
  };
}

function taxLensPayload(s: EditorState): Record<string, unknown> | null {
  if (s.taxLensMode === "none") return null;
  if (s.taxLensMode === "skip") return { topics: [], points: [], links: [], omissionReason: s.omissionReason.trim() };
  return {
    topics: splitList(s.taxTopicsText),
    points: splitLines(s.taxPointsText),
    links: s.taxLinks.filter((l) => !blank(l.url) || !blank(l.label)).map((l) => ({ kind: l.kind, label: l.label.trim(), url: l.url.trim() })),
    omissionReason: null,
  };
}

/** PATCH /api/admin/articles/[id] 본문 — 편집기가 다루는 칸 전부 + 낙관적 잠금 버전. 발행 뒤에는 수정 종류·사유를 함께 */
export function editorPayload(s: EditorState, ctx: { published: boolean; version: number }): Record<string, unknown> {
  const blocks = s.blocks.map(blockToStored);
  const claims: CoreClaim[] = s.claims.map((c) => {
    const index = c.blockKey ? s.blocks.findIndex((b) => b.key === c.blockKey) : -1;
    return { id: c.id, text: c.text, kind: c.kind, evidenceIds: [...c.evidenceIds], blockIndex: index >= 0 ? index : null };
  });
  const payload: Record<string, unknown> = {
    title: s.title.trim(),
    slug: s.slug.trim(),
    summary: textOrNull(s.summary),
    section: s.section,
    categoryId: idOrNull(s.categoryId),
    contentType: s.contentType,
    // 취재 방식은 보도기사(reported_news)에만 — 다른 유형은 null (DB 규칙)
    reportingMethod: s.contentType === "reported_news" && !blank(s.reportingMethod) ? s.reportingMethod : null,
    format: s.format,
    label: s.label,
    partnerId: idOrNull(s.partnerId),
    leadMediaId: idOrNull(s.leadMediaId),
    legalBasisDate: textOrNull(s.legalBasisDate),
    regionCodes: splitList(s.regionCodesText),
    editorialField: blank(s.editorialField) ? null : s.editorialField,
    publicQuestion: textOrNull(s.publicQuestion),
    body: { blocks, claims },
    checklists: cleanChecklists(s.checklists),
    taxLens: taxLensPayload(s),
    expectedVersion: ctx.version,
  };
  if (s.subtype === "solved_case" && s.solvedCase) payload.solvedCase = s.solvedCase;
  // 칼럼 연재 (ART-04) — 칼럼만 보낸다. 다른 유형으로 바꾸면 비운다(DB 규칙: 연재는 칼럼만)
  const series = seriesOf(s);
  payload.seriesTitle = series ? series.title : null;
  payload.seriesEpisode = series ? series.episode : null;
  if (ctx.published) {
    payload.updateKind = blank(s.updateKind) ? null : s.updateKind;
    payload.reason = textOrNull(s.reason);
  }
  return payload;
}

/** 편집기의 연재 칸 → { 이름, 회차 } — 칼럼이 아니거나 둘 다 비면 null. 회차 글자가 정수가 아니면 NaN(저장 전 확인이 막는다) */
export function seriesOf(s: Pick<EditorState, "contentType" | "seriesTitle" | "seriesEpisodeText">): { title: string; episode: number } | null {
  if (s.contentType !== "opinion" || (blank(s.seriesTitle) && blank(s.seriesEpisodeText))) return null;
  const text = s.seriesEpisodeText.trim();
  return { title: s.seriesTitle.trim(), episode: /^\d+$/.test(text) ? Number(text) : Number.NaN };
}

// ── 저장 전 확인 ────────────────────────────────────────

const SLUG = /^[^\s/]+$/;

export interface ValidateContext {
  published: boolean;
  /** 「지방세로 읽기」 생략 사유 승인 권한 (article.tax_lens_skip — 편집 책임자) */
  canSkipTaxLens: boolean;
  /** 저장된 생략 사유 — 같은 사유를 그대로 두는 것은 누구나 된다 */
  storedOmissionReason: string | null;
}

export function validateEditor(s: EditorState, ctx: ValidateContext): FieldErrors {
  const e: FieldErrors = {};
  if (blank(s.title)) e["meta-title"] = "제목을 적어 주세요";
  const titleLong = headLengthProblem("title", s.title);
  if (titleLong) e["meta-title"] = titleLong;
  const summaryLong = headLengthProblem("summary", s.summary);
  if (summaryLong) e["meta-summary"] = summaryLong;
  const slug = s.slug.trim();
  if (slug === "") e["meta-slug"] = "주소(slug)를 적어 주세요";
  else if (!SLUG.test(slug)) e["meta-slug"] = "주소에는 공백과 '/'를 쓸 수 없습니다";
  else if (RESERVED_SLUGS.includes(slug)) e["meta-slug"] = "video·photo·popular는 목록 주소라 쓸 수 없습니다";
  if (blank(s.section)) e["meta-section"] = "분야를 골라 주세요";
  if (blank(s.contentType)) e["meta-content-type"] = "기사 유형을 골라 주세요";
  if (s.contentType === "reported_news" && blank(s.reportingMethod)) e["meta-reporting-method"] = "보도기사는 취재 방식을 골라야 합니다";
  if (s.contentType === "sponsored" && s.label === "none") e["meta-label"] = "광고·협찬은 공동 기획과 광고 중 표기 하나를 골라야 합니다 (ART-10)";
  if (s.contentType !== "sponsored" && s.label !== "none") e["meta-label"] = "표기(공동 기획·광고)는 광고·협찬 콘텐츠에만 씁니다 (ART-10)";
  if (s.label === "co_planned" && idOrNull(s.partnerId) === null) e["meta-partner"] = "공동 기획에는 제휴사가 필요합니다";
  if (!blank(s.legalBasisDate) && !isValidDate(s.legalBasisDate.trim())) e["meta-legal-basis-date"] = "법령 기준일은 YYYY-MM-DD 날짜로 적어 주세요";
  for (const b of s.blocks) {
    if ((b.type === "image" || b.type === "infographic") && idOrNull(b.mediaId) === null) e[`block-${b.key}-mediaId`] = "이미지를 골라 주세요";
    // 저장 불가 조건 (ART-07 · ART-08) — 기사 저장 API(content.ts)와 같은 함수·같은 문장
    if (b.type === "infographic") {
      for (const p of infographicSaveProblems({ alt: b.alt, data: infographicDataFromText(b.dataKind, b.dataText) })) e[`block-${b.key}-${p.field}`] = p.message;
    }
    if (b.type === "video") {
      const embed = parseYoutubeEmbed(b.embedUrl);
      if (!embed.ok) e[`block-${b.key}-embedUrl`] = embed.problem;
      if (Number.isNaN(durationFromText(b.durationText))) e[`block-${b.key}-durationSeconds`] = "재생 시간은 초 단위 숫자로 적어 주세요 (예: 95 — 비워도 됩니다)";
    }
  }
  const series = seriesOf(s);
  if (series) {
    if (series.title === "") e["meta-series-title"] = "연재 이름을 적어 주세요 — 단독 칼럼이면 회차도 비웁니다";
    if (!Number.isInteger(series.episode) || series.episode < 1) e["meta-series-episode"] = "회차는 1 이상의 숫자로 적어 주세요";
  }
  if (s.taxLensMode === "skip") {
    const reason = s.omissionReason.trim();
    if (reason === "") e["taxlens-omission"] = "생략 사유를 적어 주세요";
    else if (!ctx.canSkipTaxLens && reason !== (ctx.storedOmissionReason ?? "").trim()) {
      e["taxlens-omission"] = "생략 사유는 편집 책임자만 적습니다 (CORE-01) — 박스를 쓰거나 편집 책임자에게 요청하세요";
    }
  }
  if (ctx.published) {
    if (blank(s.updateKind)) e["save-update-kind"] = "발행된 기사는 수정 종류를 골라야 저장됩니다 (ART-05)";
    if (blank(s.reason)) e["save-reason"] = "발행된 기사는 수정 사유를 적어야 저장됩니다 (ART-05)";
  }
  return e;
}

// ── 서버 오류 → 칸 ──────────────────────────────────────

const FIELD_OF: Record<string, string> = {
  title: "meta-title",
  slug: "meta-slug",
  summary: "meta-summary",
  section: "meta-section",
  categoryId: "meta-category",
  contentType: "meta-content-type",
  reportingMethod: "meta-reporting-method",
  format: "meta-format",
  label: "meta-label",
  partnerId: "meta-partner",
  leadMediaId: "meta-lead-media",
  legalBasisDate: "meta-legal-basis-date",
  regionCodes: "meta-region-codes",
  editorialField: "meta-editorial-field",
  publicQuestion: "meta-public-question",
  seriesTitle: "meta-series-title",
  seriesEpisode: "meta-series-episode",
  updateKind: "save-update-kind",
  reason: "save-reason",
};

const FAILED_FIELD: Record<string, [string, string]> = {
  "art05.update-kind-required": ["save-update-kind", "수정 종류를 골라 주세요 (ART-05)"],
  "art05.reason-required": ["save-reason", "수정 사유를 적어 주세요 (ART-05)"],
};

function fieldOfPath(path: string, blockKeys: readonly string[]): string | null {
  const block = path.match(/^body\.blocks\[(\d+)\]\.([A-Za-z]+)/);
  if (block) {
    const key = blockKeys[Number(block[1])];
    return key ? `block-${key}-${block[2]}` : "blocks";
  }
  if (path.startsWith("body.claims")) return "claims";
  if (path.startsWith("body")) return "blocks";
  if (path.startsWith("taxLens")) return "taxlens";
  if (path.startsWith("checklists")) return "checklists";
  if (path.startsWith("solvedCase")) return "solved-case";
  return FIELD_OF[path] ?? null;
}

/** 422 응답의 errors("칸: 문장")·failed(규칙 ID) → { 칸 id: 문장 }. 모르는 칸은 form */
export function fieldErrorsFromServer(errors: readonly string[] | undefined, failed: readonly string[] | undefined, blockKeys: readonly string[]): FieldErrors {
  const out: FieldErrors = {};
  const add = (field: string, message: string) => {
    out[field] = out[field] ? `${out[field]} · ${message}` : message;
  };
  for (const raw of errors ?? []) {
    const at = raw.indexOf(": ");
    const field = at > 0 ? fieldOfPath(raw.slice(0, at), blockKeys) : null;
    if (field) add(field, raw.slice(at + 2));
    else add("form", raw);
  }
  for (const id of failed ?? []) {
    const known = FAILED_FIELD[id];
    if (known) add(known[0], known[1]);
  }
  return out;
}

// ── 정량형 7묶음 · 정성형 기록 안내 ─────────────────────

/** 재현 정보(article_datasets 행) — DB 칸 이름 */
export interface DatasetFields {
  source_url: string | null;
  provider: string | null;
  collected_at: string | null;
  license: string | null;
  definition: string | null;
  period: string | null;
  unit: string | null;
  region_unit: string | null;
  denominator: string | null;
  exclusions: string | null;
  transform: string | null;
  repro_file_hash: string | null;
}

export interface GroupStatus {
  id: string;
  name: string;
  filled: boolean;
  /** 어디서 채우는지 */
  where: string;
}

const DATASET_GROUPS: readonly [string, string, (keyof DatasetFields)[]][] = [
  ["nav10.source-data", "원자료(파일/URL·제공기관·수집일·이용권리)", ["source_url", "provider", "collected_at", "license"]],
  ["nav10.indicator-definition", "지표 정의(정의·기간·단위·지역 단위·분모·제외값)", ["definition", "period", "unit", "region_unit", "denominator", "exclusions"]],
  ["nav10.calculation", "계산 과정(수식·재현 파일 해시)", ["transform", "repro_file_hash"]],
];

/** 정량형 필수 7묶음 상태 (NAV-10) — 저장 전 화면 안내. 발행 판정은 서버 점검 패널이 한다 */
export function quantitativeGroups(s: EditorState, datasets: readonly DatasetFields[]): GroupStatus[] {
  const q = s.checklists.quantitative;
  const datasetGroup = ([id, name, fields]: (typeof DATASET_GROUPS)[number]): GroupStatus => ({
    id,
    name,
    filled: datasets.length > 0 && datasets.every((d) => fields.every((f) => !blank(d[f]))),
    where: "취재 근거 — 원자료(데이터) 재현 정보",
  });
  const charts = s.blocks.filter((b) => b.type === "table" || b.type === "infographic");
  return [
    datasetGroup(DATASET_GROUPS[0]!),
    datasetGroup(DATASET_GROUPS[1]!),
    datasetGroup(DATASET_GROUPS[2]!),
    { id: "nav10.source-cross-check", name: "원자료 대조 기록", filled: !blank(q?.sourceCrossCheck), where: "취재 확인 목록" },
    {
      id: "nav10.chart-labels",
      name: "그래프·표 표기(축·단위·출처)",
      filled: charts.length > 0 && charts.every((b) => !blank(b.axis) && !blank(b.unit) && !blank(b.source)),
      where: "본문 표·인포그래픽 블록",
    },
    { id: "nav10.limitations", name: "수치가 말하지 않는 한계", filled: !blank(q?.limitations), where: "취재 확인 목록" },
    { id: "nav10.related-party-check", name: "관련 기관·전문가 확인", filled: !blank(q?.relatedPartyCheck), where: "취재 확인 목록" },
  ];
}

export interface EvidenceBrief {
  id: number;
  evidence_type: string;
  verification_status: string;
}

const INDEPENDENT = new Set(["interview", "field", "document"]);

/** 정성형 필수 기록 상태 (NAV-11) — interviewEvidenceIds = 인터뷰 기록(article_interviews)이 있는 근거 번호 */
export function qualitativeRecords(s: EditorState, evidence: readonly EvidenceBrief[], interviewEvidenceIds: readonly number[]): GroupStatus[] {
  const q = s.checklists.qualitative;
  const verified = evidence.filter((e) => e.verification_status === "verified");
  const independent = verified.filter((e) => INDEPENDENT.has(e.evidence_type)).length;
  const interviewRefs = new Set(interviewEvidenceIds.map((id) => `ev:${id}`));
  const evidenceRefs = new Set(evidence.map((e) => `ev:${e.id}`));
  const quotes = s.blocks.filter((b) => b.type === "quote");
  const quotesOk = quotes.every((b) => (b.origin === "interview" ? interviewRefs.has(b.refId) : b.refId.startsWith("src:") || evidenceRefs.has(b.refId)));
  const where = "취재 확인 목록";
  return [
    { id: "nav11.interview-questions", name: "취재 질문", filled: !blank(q?.interviewQuestions), where },
    { id: "nav11.field-record", name: "현장 확인 기록", filled: !blank(q?.fieldRecord), where },
    { id: "nav11.counter-perspective", name: "반대·보완 관점", filled: !blank(q?.counterPerspective), where },
    { id: "nav11.conflicts-of-interest", name: "이해관계 확인", filled: !blank(q?.conflictsOfInterest), where },
    { id: "nav11.independent-sources", name: `서로 독립적인 근거 2건 이상 (지금 ${independent}건)`, filled: independent >= 2, where: "취재 근거 — 확인됨" },
    { id: "nav11.document-evidence", name: "문서 근거", filled: verified.some((e) => e.evidence_type === "document"), where: "취재 근거 — 문서, 확인됨" },
    { id: "nav11.quote-record", name: `인용마다 인터뷰 기록·문서 근거 (인용 ${quotes.length}개)`, filled: quotesOk, where: "본문 인용 블록" },
  ];
}
