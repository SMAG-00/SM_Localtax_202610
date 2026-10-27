// 워크스페이스 순수 규칙 (W13-b, PRD-05 WS-01~05) - 서버 전용 코드가 부르는 판정·절단·직렬화. DB·네트워크 0, 시계는 인자로만 받는다.
// 이 파일에는 법률·세무 문장이 없다. AI 호출도 없다.

export const MODES = ["general", "expert"] as const;
export type Mode = (typeof MODES)[number];

/** 모드 값 읽기 - 모르는 값은 일반. 모드는 표현 밀도만 바꾸고 권한 판정에는 쓰지 않는다 (WS-01) */
export function parseMode(value: unknown): Mode {
  return value === "expert" ? "expert" : "general";
}

export const MODE_COOKIE = "ltr_ws_mode";

export const TARGET_KINDS = ["node", "issue", "issue_article", "column", "article", "law_article", "legal_doc", "agent_answer", "copilot_result"] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

export const TARGET_LABELS: Record<TargetKind, string> = {
  node: "지식창고 노드",
  issue: "권호",
  issue_article: "권호 기사",
  column: "칼럼",
  article: "기사",
  law_article: "법령 조문",
  legal_doc: "해석·결정례",
  agent_answer: "지방세봇 답변",
  copilot_result: "코파일럿 결과",
};

export const isTargetKind = (v: unknown): v is TargetKind => typeof v === "string" && (TARGET_KINDS as readonly string[]).includes(v);

const TEXT_ID_KINDS: readonly TargetKind[] = ["agent_answer", "copilot_result"];

/** 대상 번호 모양 - 대화·코파일럿은 영문·숫자·-_ 64자까지, 나머지는 숫자 1~18자리 */
export function isValidTargetId(kind: TargetKind, id: unknown): id is string {
  if (typeof id !== "string") return false;
  return TEXT_ID_KINDS.includes(kind) ? /^[A-Za-z0-9_-]{1,64}$/.test(id) : /^[0-9]{1,18}$/.test(id);
}

/** 서버가 원문 버전을 읽을 수 없는 종류(대화·코파일럿 결과)는 버전 표지를 고정 문자열로 둔다 */
export const UNVERSIONED = "unversioned";

// ── 접근 판정 ──────────────────────────────────────────────
export type WorkspaceView = "closed" | "login" | "browse" | "full";

/**
 * 대시보드 화면 판정. 입력에 모드 칸이 없다 - 요청의 모드 값을 위조해도 결과가 같다 (WS-01).
 * closed = 기능 키 꺼짐(404) · login = 로그인 안내 · browse = 둘러보기(권한 없음) · full = 권한 있음
 */
export function decideWorkspaceAccess(input: { featureOn: boolean; loggedIn: boolean; entitled: boolean }): WorkspaceView {
  if (!input.featureOn) return "closed";
  if (!input.loggedIn) return "login";
  return input.entitled ? "full" : "browse";
}

/** 새로 만들기(메모·스크랩·폴더·저장 검색)는 full에서만. 열람·삭제·내보내기는 로그인한 본인이면 browse에서도 남긴다 (구독 종료 후 보존, PO 결정 #10) */
export const canCreate = (view: WorkspaceView): boolean => view === "full";
export const canReadOwn = (view: WorkspaceView): boolean => view === "full" || view === "browse";

// ── 설정 값 읽기 (비어 있거나 틀리면 닫힘) ────────────────────
const isNonNegInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100_000_000;

/** saved_search_limit {"max": n} - 없거나 틀리면 0 (저장 닫힘). DB 함수 ws_saved_search_limit과 같은 규칙 */
export function parseSavedSearchLimit(value: unknown): number {
  const max = (value as { max?: unknown } | null | undefined)?.max;
  return isNonNegInt(max) ? Math.min(max, 100_000) : 0;
}

/** export_excerpt_limit {"chars": n} - null = 설정이 비어 있어 내보내기 전체가 닫힘, 0 = 발췌 없이 인용·본인 메모만 */
export function parseExcerptLimit(value: unknown): number | null {
  const chars = (value as { chars?: unknown } | null | undefined)?.chars;
  return isNonNegInt(chars) ? chars : null;
}

/** 글자(코드 포인트) 수 기준으로 처음 limit자까지 */
export function cutExcerpt(body: string, limit: number): string {
  if (!Number.isInteger(limit) || limit <= 0) return "";
  const chars = Array.from(body);
  return chars.length <= limit ? body : chars.slice(0, limit).join("");
}

/** 발췌는 권한이 있을 때만, 한도 안에서만. 권한이 끝났으면 0 */
export function excerptFor(body: string | null, limit: number, entitled: boolean): string {
  return entitled && body ? cutExcerpt(body, limit) : "";
}

/** library_read 결과에서 발췌 - full === true(전문)일 때만 한도까지. 미리보기(full false)·실패·모양이 다르면 0 */
export function excerptFromRead(result: unknown, limit: number, entitled: boolean): string {
  const r = result as { ok?: unknown; full?: unknown; text?: unknown } | null | undefined;
  if (!r || r.ok !== true || r.full !== true || typeof r.text !== "string") return "";
  return excerptFor(r.text, limit, entitled);
}

/** 스크랩 때 저장한 버전과 지금 버전이 다르면 개정됨. 지금 버전을 모르면(null) 표시하지 않는다 */
export function isRevised(stored: string, current: string | null): boolean {
  return current !== null && stored !== UNVERSIONED && stored !== current;
}

// ── 내보내기 모델 ──────────────────────────────────────────
export interface ExportItem {
  /** 대상이 없는 메모는 null */
  kind: TargetKind | null;
  id: string | null;
  title: string;
  version: string;
  checkedOn: string;
  memo: string;
  aiDraft: boolean;
  excerpt: string;
}

export const hasCitation = (i: ExportItem): boolean => i.kind !== null && i.id !== null;
export const countCitations = (items: readonly ExportItem[]): number => items.filter(hasCitation).length;
export const totalExcerptChars = (items: readonly ExportItem[]): number => items.reduce((n, i) => n + Array.from(i.excerpt).length, 0);

/** 인용 한 줄 - 종류·번호·원문 버전·확인일 (WS-05) */
export function citationLine(i: ExportItem): string {
  if (!hasCitation(i)) return "";
  return `${TARGET_LABELS[i.kind as TargetKind]} · 번호 ${i.id} · 원문 버전 ${i.version} · 확인일 ${i.checkedOn}`;
}

export const AI_DRAFT_LABEL = "AI 초안";

// ── CSV ────────────────────────────────────────────────────
export const CSV_HEADER = ["종류", "대상 번호", "제목", "원문 버전", "확인일", "메모", "AI 초안", "발췌", "내보낸 날짜"] as const;

/** 엑셀이 수식으로 읽을 수 있는 첫 글자는 앞에 작은따옴표를 붙인다 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** UTF-8 BOM + 머리 행 + CRLF (엑셀에서 한글이 깨지지 않게) */
export function toCsv(items: readonly ExportItem[], exportedOn: string): string {
  const rows = [CSV_HEADER.map(csvCell).join(",")];
  for (const i of items) {
    rows.push(
      [
        i.kind ? TARGET_LABELS[i.kind] : "메모",
        i.id ?? "",
        i.title,
        i.version,
        i.checkedOn,
        i.memo,
        i.aiDraft ? AI_DRAFT_LABEL : "",
        i.excerpt,
        exportedOn,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `﻿${rows.join("\r\n")}\r\n`;
}

/** 서울 기준 날짜(YYYY-MM-DD) - 내보낸 날짜 표기 */
export function seoulDate(now: Date): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}
