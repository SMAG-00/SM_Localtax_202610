// 단계별 「지방세로 읽기」 템플릿 입력 검사·상태 (W4 16단계 — PRD-01B PR-08 · CORE-01, docs/dev/W4_설계.md 1장 16단계 · 2.1 · 2.3 · 12장 #129~) — 순수 모듈.
// DB 트리거 project_stage_lenses_guard(마이그레이션 …50)와 같은 한도다: 사업 유형 × 단계 하나 · 세목 1~5개(1~20자) · 포인트 1~3줄(줄 1~120자 — 0줄·4줄 거부) ·
// 링크 1~3개(해설 explainer · 도서 book · 전문가 expert 한 번씩, 사이트 안 주소) · 법령 기준일. 세액 표현(숫자 + 원)·금지 표현(감면 단정)은 CORE-01 박스 검사
// (@ltr/editorial pointLineProblems)를 그대로 쓴다. 숫자 + %는 저장하고 경고(PR-05). 계산기 링크는 받지 않는다 — SM 취득세 카드(official_links)가 박스 옆에 붙는다.
// 문구는 편집국이 쓰고 세무 감수위원이 서명한다 — 이 모듈은 문구를 만들지 않는다. 내용을 고치면 서명은 지워진다(DB 트리거 — 재감수 필요).
import { pointLineProblems } from "@ltr/editorial";
import { NOTE_AMOUNT_RE, priceKeyErrors, stageKeysOf, type ProjectTypes, type StageLists } from "./project-rules";

/** 2.1 project_stage_lens.review_status */
export const LENS_REVIEW_STATUSES = ["draft", "reviewed", "rereview_needed"] as const;
export type LensReviewStatus = (typeof LENS_REVIEW_STATUSES)[number];
export const LENS_STATUS_LABELS: Record<LensReviewStatus | "none", string> = { none: "템플릿 없음", draft: "감수 전 초안", reviewed: "감수 서명됨", rereview_needed: "재감수 필요" };

/** 2.1 project_stage_lens.link_kind — 사이트 안 주소, 종류마다 하나 */
export const LENS_LINK_KINDS = ["explainer", "book", "expert"] as const;
export type LensLinkKind = (typeof LENS_LINK_KINDS)[number];
export const LENS_LINK_LABELS: Record<LensLinkKind, string> = { explainer: "해설", book: "도서", expert: "전문가" };

/** 2.3 단계별 「지방세로 읽기」 한도 (DB 트리거와 같다) */
export const LENS_LIMITS = { topics: 5, topicChars: 20, pointsMin: 1, pointsMax: 3, pointChars: 120, links: 3, labelChars: 40, urlChars: 300 } as const;
/** 사이트 안 주소 — /로 시작, //·공백·조각(#) 0 (쿼리는 받는다 — 전문가 /experts?field=) */
export const LENS_URL_RE = /^\/[^/\s#][^\s#]*$/;

export const LENS_OPS = ["draft", "review"] as const;
export type LensOp = (typeof LENS_OPS)[number];

export interface LensLink {
  kind: LensLinkKind;
  label: string;
  url: string;
}
/** project_stage_lenses.lens 저장 모양 — 기사 tax_lens(CORE-01)의 박스 칸과 같은 이름 + 법령 기준일 */
export interface StageLensContent {
  topics: string[];
  points: string[];
  links: LensLink[];
  base_date: string;
}
export interface StageLensRow {
  project_type: string;
  stage: string;
  lens: StageLensContent;
  drafted_by: string;
  drafted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_status: LensReviewStatus;
}
export const LENS_COLUMNS = "project_type, stage, lens, drafted_by, drafted_at, reviewed_by, reviewed_at, review_status";

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const chars = (s: string) => [...s].length;
const isIsoDate = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
/** 편집 칸 글(한 줄에 하나) → 줄 목록 — 앞뒤 공백을 지우고 빈 줄은 뺀다 (화면과 서버가 같은 함수로 4번째 줄을 센다) */
export function splitLensLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
}
const lines = (v: unknown): unknown[] | null => (Array.isArray(v) ? v : typeof v === "string" ? splitLensLines(v) : null);

export interface LensDraft {
  projectType: string;
  stage: string;
  lens: StageLensContent;
}

/**
 * 초안 입력 검사 — errors는 "칸: 문장" (칸 = project_type · stage · topics · points · links · base_date, 줄·링크는 [i]).
 * types·lists = 지금 설정(사업 유형·단계 목록). forbiddenPhrases = 금지 표현 사전(감면 단정 — CORE-01)
 */
export function parseLensDraft(body: Record<string, unknown>, ctx: { types: ProjectTypes | null; lists: StageLists | null; forbiddenPhrases: readonly string[] }): Parsed<LensDraft> {
  const errors: string[] = [...priceKeyErrors(body)];
  const type = typeof body.project_type === "string" ? body.project_type.trim() : "";
  const stage = typeof body.stage === "string" ? body.stage.trim() : "";
  if (!type || !ctx.types?.[type] || stageKeysOf(ctx.lists, type).length === 0) errors.push("project_type: 단계 목록이 있는 사업 유형이어야 합니다 (운영 설정 project_types·project_stage_lists)");
  else if (!stageKeysOf(ctx.lists, type).includes(stage)) errors.push(`stage: 사업 유형 ${type}의 단계 목록에 있는 단계여야 합니다`);

  const topicsRaw = lines(body.topics);
  const topics: string[] = [];
  if (!topicsRaw) errors.push("topics: 관련 세목 목록이어야 합니다");
  else {
    topicsRaw.forEach((t, i) => {
      if (typeof t !== "string" || t.trim() === "") return errors.push(`topics[${i}]: 빈 세목은 저장하지 않습니다`);
      const v = t.trim();
      if (chars(v) > LENS_LIMITS.topicChars) errors.push(`topics[${i}]: 관련 세목은 ${LENS_LIMITS.topicChars}자 이하입니다 (지금 ${chars(v)}자)`);
      if (topics.includes(v)) errors.push(`topics[${i}]: 관련 세목 ‘${v}’가 두 번 있습니다`);
      topics.push(v);
    });
    if (topicsRaw.length === 0) errors.push("topics: 관련 세목을 1개 이상 적어 주세요 (CORE-01)");
    if (topicsRaw.length > LENS_LIMITS.topics) errors.push(`topics: 관련 세목은 ${LENS_LIMITS.topics}개까지입니다 (지금 ${topicsRaw.length}개)`);
  }

  const pointsRaw = lines(body.points);
  const points: string[] = [];
  if (!pointsRaw) errors.push("points: 핵심 포인트 줄 목록이어야 합니다");
  else {
    pointsRaw.forEach((p, i) => {
      if (typeof p !== "string" || p.trim() === "") return errors.push(`points[${i}]: 빈 줄은 저장하지 않습니다`);
      const v = p.trim();
      if (chars(v) > LENS_LIMITS.pointChars) errors.push(`points[${i}]: 줄은 ${LENS_LIMITS.pointChars}자 이하입니다 (지금 ${chars(v)}자)`);
      points.push(v);
    });
    if (pointsRaw.length < LENS_LIMITS.pointsMin || pointsRaw.length > LENS_LIMITS.pointsMax) {
      errors.push(`points: 핵심 포인트는 ${LENS_LIMITS.pointsMin}~${LENS_LIMITS.pointsMax}줄입니다 (지금 ${pointsRaw.length}줄 — CORE-01)`);
    }
  }

  const links: LensLink[] = [];
  if (!Array.isArray(body.links) || body.links.length === 0) errors.push("links: 해설·도서·전문가 링크를 1개 이상 넣어 주세요 (CORE-01)");
  else {
    if (body.links.length > LENS_LIMITS.links) errors.push(`links: 링크는 ${LENS_LIMITS.links}개까지입니다 (종류마다 하나)`);
    body.links.forEach((l, i) => {
      const o = (typeof l === "object" && l !== null ? l : {}) as Record<string, unknown>;
      const kind = typeof o.kind === "string" ? o.kind : "";
      const label = typeof o.label === "string" ? o.label.trim() : "";
      const url = typeof o.url === "string" ? o.url.trim() : "";
      if (kind === "calculator") errors.push(`links[${i}]: 계산기 링크는 적지 않습니다 — SM 취득세 카드(바깥 연결 설정)가 박스 옆에 붙습니다 (TX-01)`);
      else if (!(LENS_LINK_KINDS as readonly string[]).includes(kind)) errors.push(`links[${i}]: 종류는 ${LENS_LINK_KINDS.join("·")} 중 하나입니다`);
      else if (links.some((x) => x.kind === kind)) errors.push(`links[${i}]: ${LENS_LINK_LABELS[kind as LensLinkKind]} 링크가 두 번 있습니다 (종류마다 하나)`);
      if (label === "" || chars(label) > LENS_LIMITS.labelChars) errors.push(`links[${i}]: 링크 이름은 1~${LENS_LIMITS.labelChars}자입니다`);
      if (!LENS_URL_RE.test(url) || url.length > LENS_LIMITS.urlChars) errors.push(`links[${i}]: 사이트 안 주소(/로 시작 — 바깥 주소·//·#·공백 0, ${LENS_LIMITS.urlChars}자까지)여야 합니다`);
      links.push({ kind: kind as LensLinkKind, label, url });
    });
  }

  if (!isIsoDate(body.base_date)) errors.push("base_date: 법령 기준일(YYYY-MM-DD)이 필요합니다");

  // 세액 표현(숫자 + 원)·금지 표현(감면 단정) — CORE-01 박스 검사와 같은 함수 (세목·포인트·링크 이름 모두)
  for (const p of pointLineProblems(topics, ctx.forbiddenPhrases)) errors.push(`topics[${p.index}]: ${p.message}`);
  for (const p of pointLineProblems(points, ctx.forbiddenPhrases)) errors.push(`points[${p.index}]: ${p.message}`);
  for (const p of pointLineProblems(
    links.map((l) => l.label),
    ctx.forbiddenPhrases,
  ))
    errors.push(`links[${p.index}]: ${p.message}`);

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { projectType: type, stage, lens: { topics, points, links, base_date: body.base_date as string } } };
}

/** 저장 경고 — 숫자 + % (막지 않는다 — PR-05, DB raise warning과 같은 식) */
export function lensWarnings(lens: StageLensContent): string[] {
  const texts = [...lens.topics, ...lens.points, ...lens.links.map((l) => l.label)];
  return texts.some((t) => NOTE_AMOUNT_RE.test(t))
    ? ["lens: 숫자와 % 표현이 있습니다 — 저장은 됩니다. 세율·비율은 감수된 기사에서만 씁니다 (PR-05 저장 경고)"]
    : [];
}

/** 같은 내용인가 — 세목·포인트·링크·기준일 (서명 칸은 보지 않는다) */
export function sameLensContent(a: StageLensContent | null | undefined, b: StageLensContent): boolean {
  if (!a) return false;
  const key = (x: StageLensContent) => JSON.stringify([x.topics, x.points, x.links.map((l) => [l.kind, l.label, l.url]), x.base_date]);
  return key(a) === key(b);
}

/** 서명 요청 — 사업 유형·단계 + 화면이 읽은 초안 시각(그 사이 고쳐졌으면 409 — 읽은 문구에만 서명) */
export function parseLensReview(body: Record<string, unknown>): Parsed<{ projectType: string; stage: string; draftedAt: string }> {
  const errors: string[] = [];
  const type = typeof body.project_type === "string" ? body.project_type.trim() : "";
  const stage = typeof body.stage === "string" ? body.stage.trim() : "";
  if (!type) errors.push("project_type: 사업 유형이 필요합니다");
  if (!stage) errors.push("stage: 단계가 필요합니다");
  const at = typeof body.drafted_at === "string" ? body.drafted_at : "";
  if (!at || Number.isNaN(Date.parse(at))) errors.push("drafted_at: 화면이 읽은 초안 시각이 필요합니다 — 새로 불러온 뒤 서명하세요");
  return errors.length ? { ok: false, errors } : { ok: true, value: { projectType: type, stage, draftedAt: at } };
}

export type LensState = LensReviewStatus | "none";
export const lensState = (row: StageLensRow | null | undefined): LensState => (row ? row.review_status : "none");

/** 관리 화면 판 — 사업 유형마다 단계 목록 차례대로 템플릿(없으면 null) */
export interface LensBoardStage {
  key: string;
  label: string;
  state: LensState;
  row: StageLensRow | null;
}
export interface LensBoardType {
  key: string;
  label: string;
  stages: LensBoardStage[];
}
export function lensBoard(types: ProjectTypes | null, lists: StageLists | null, rows: readonly StageLensRow[], only?: string): LensBoardType[] {
  if (!types || !lists) return [];
  return Object.entries(types)
    .filter(([k]) => (only ? k === only : true) && Array.isArray(lists[k]) && lists[k]!.length > 0)
    .map(([key, v]) => ({
      key,
      label: v.label,
      stages: lists[key]!.map((s) => {
        const row = rows.find((r) => r.project_type === key && r.stage === s.key) ?? null;
        return { key: s.key, label: s.label, state: lensState(row), row };
      }),
    }));
}

/** 편집 폼 칸 글 — 저장된 내용(없으면 빈 칸) */
export function lensFormValues(row: StageLensRow | null): { topics: string; points: string; base_date: string; links: Record<LensLinkKind, { label: string; url: string }> } {
  const links = Object.fromEntries(LENS_LINK_KINDS.map((k) => [k, { label: "", url: "" }])) as Record<LensLinkKind, { label: string; url: string }>;
  for (const l of row?.lens.links ?? []) if ((LENS_LINK_KINDS as readonly string[]).includes(l.kind)) links[l.kind] = { label: l.label, url: l.url };
  return { topics: (row?.lens.topics ?? []).join("\n"), points: (row?.lens.points ?? []).join("\n"), base_date: row?.lens.base_date ?? "", links };
}

/** 폼 칸 글 → 요청 본문 (이름·주소가 둘 다 빈 링크 줄은 보내지 않는다) */
export function lensRequestBody(projectType: string, stage: string, f: ReturnType<typeof lensFormValues>): Record<string, unknown> {
  return {
    op: "draft",
    project_type: projectType,
    stage,
    topics: splitLensLines(f.topics),
    points: splitLensLines(f.points),
    links: LENS_LINK_KINDS.filter((k) => f.links[k].label.trim() !== "" || f.links[k].url.trim() !== "").map((k) => ({ kind: k, label: f.links[k].label.trim(), url: f.links[k].url.trim() })),
    base_date: f.base_date.trim(),
  };
}
