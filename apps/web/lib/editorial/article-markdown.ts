// 편집위원 데스크 → 기사 초안 옮기기: 지침 v4 11장 출고 형식 md를 읽어 머리 칸·본문 블록·편집 메모로 나눈다 (순수 함수, 화면·DB 없음).
// 두 형식을 다 읽는다.
//  ① 대괄호 형식 (2026-11-15 이후): "[섹션] 값" 줄, "## 본문" 아래 본문, "◇ 소제목", 끝에 [바이라인]·[키워드]·[요약]
//  ② 머리말 형식 (2026-10-31·11-01 코워크): "--- title: … ---", "**[섹션]** 값", "# 제목", "## 1. 소제목", "### ※ 표 제목"
// "## 편집 메모" 아래는 본문에 넣지 않고 memo로만 돌려준다(출처·확인 필요·썸네일).

export type ArticleBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "image"; path: string; alt: string; caption: string; aiGenerated: boolean }
  | { type: "table"; rows: string[][] };

export interface ParsedArticle {
  section: string;
  title: string;
  titleAlternatives: string[];
  subtitle: string;
  leadCaption: string;
  byline: string;
  keywords: string[];
  summary: string;
  blocks: ArticleBlock[];
  memo: { text: string; sources: { label: string; url: string }[]; needsCheck: string[]; thumbnail: string };
  warnings: string[];
}

const FIELD_NAMES = ["섹션", "제목", "제목 대안", "부제", "이미지 캡션", "필자", "바이라인", "키워드", "요약"] as const;
type FieldName = (typeof FIELD_NAMES)[number];
const FIELD_RE = new RegExp(`^\\*{0,2}\\[(${FIELD_NAMES.join("|")})\\]\\*{0,2}\\s*(.*)$`);
// 메모 시작 줄 — 지침 v4 11장은 "구분선 아래 [편집 메모]"(대괄호)를 정하고, 출고 파일은 "## 편집 메모"(제목)나 굵은 글씨로도 온다.
// 줄 전체가 표시일 때만 잘라 낸다(문장 속 '편집 메모'는 본문). 모양: [제목 기호 #~###] [굵게 **] [대괄호 []] 편집 메모 [닫는 기호] [콜론]
const MEMO_RE = /^(?:#{1,3}\s*)?\*{0,2}\[?\s*편집 메모\s*\]?\*{0,2}\s*[:：]?\s*\*{0,2}$/;
/** 본문 맨 끝에 남는 구분선 줄(---·***·___) */
const RULE_RE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const EMAIL_RE = /\s*[\w.+-]+@[\w-]+(\.[\w-]+)+\s*/g;
const AI_RE = /AI\s*생성/;

/** 인라인 md 기호를 글자로: **굵게**·*기울임*·`코드`·[글](주소) → 글 */
function plain(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isTableRule = (l: string) => /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(l);
const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => plain(c));

/** 그림 경로 — 묶음 안 상대 경로만 (../·절대·주소 차단) */
function safeImagePath(p: string): string | null {
  const v = p.trim().replace(/\\/g, "/");
  if (!v || v.startsWith("/") || /^[a-z]+:/i.test(v) || v.split("/").some((seg) => seg === ".." || seg === ".")) return null;
  return v;
}

function splitList(v: string): string[] {
  return v.split(/\s+\/\s+/).map((x) => plain(x)).filter(Boolean);
}

export function parseArticleMarkdown(source: string): ParsedArticle {
  const warnings: string[] = [];
  let lines = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");

  // 머리말(--- title: … ---)
  let frontTitle = "";
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (end > 0) {
      for (const l of lines.slice(1, end)) {
        const m = /^title:\s*(.+)$/.exec(l.trim());
        if (m) frontTitle = m[1]!.replace(/^["']|["']$/g, "").trim();
      }
      lines = lines.slice(end + 1);
    }
  }

  // 편집 메모 떼기
  const memoAt = lines.findIndex((l) => MEMO_RE.test(l.trim()));
  const memoLines = memoAt >= 0 ? lines.slice(memoAt + 1) : [];
  if (memoAt >= 0) {
    lines = lines.slice(0, memoAt);
    // 메모 바로 앞의 구분선·빈 줄은 본문이 아니다 ("본문 아래에 구분선을 긋고 [편집 메모]를 붙인다")
    while (lines.length && (lines[lines.length - 1]!.trim() === "" || RULE_RE.test(lines[lines.length - 1]!.trim()))) lines.pop();
  }

  // 머리 칸 — 값이 같은 줄에 없으면 다음 빈 줄 뒤 이어지는 줄들(번호 목록 포함)
  const fields = new Map<FieldName, string[]>();
  const used = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const m = FIELD_RE.exec(lines[i]!.trim());
    if (!m) continue;
    const name = m[1] as FieldName;
    used.add(i);
    const values: string[] = [];
    if (m[2]!.trim()) values.push(m[2]!.trim());
    else {
      let j = i + 1;
      while (j < lines.length && !lines[j]!.trim()) j++;
      for (; j < lines.length; j++) {
        const t = lines[j]!.trim();
        if (!t) {
          // 빈 줄 다음이 다른 칸·제목·그림·표·구분선이면 끝, 아니면 같은 칸의 다음 줄(부제 3줄 등 — 최대 5줄)
          const next = lines.slice(j + 1).find((x) => x.trim())?.trim() ?? "";
          if (!next || values.length >= 5 || FIELD_RE.test(next) || /^(#|◇|!\[|\||-{3,}|\*{3,})/.test(next)) break;
          continue;
        }
        if (FIELD_RE.test(t) || /^#/.test(t)) break;
        values.push(t.replace(/^(\d+[.)]|[-*])\s+/, ""));
        used.add(j);
      }
    }
    if (!fields.has(name)) fields.set(name, values);
  }
  const one = (n: FieldName) => plain((fields.get(n) ?? []).join(" "));

  const h1 = lines.find((l) => /^#\s+/.test(l.trim()))?.trim().replace(/^#\s+/, "") ?? "";
  const title = one("제목") || frontTitle || plain(h1);
  if (!title) warnings.push("제목을 찾지 못했습니다");

  const altRaw = fields.get("제목 대안") ?? [];
  const titleAlternatives = altRaw.length === 1 ? splitList(altRaw[0]!) : altRaw.map(plain).filter(Boolean);
  const byline = plain((one("바이라인") || one("필자").split(" · ")[0] || "").replace(EMAIL_RE, " "));
  const keywords = one("키워드")
    .split(/[\s,]+/)
    .map((k) => k.replace(/^#/, "").trim())
    .filter(Boolean);

  // 본문 — 머리 칸 줄·구분선·H1·"## 본문"을 빼고 블록으로
  const blocks: ArticleBlock[] = [];
  const bylineKey = byline.replace(/\s/g, "");
  let para: string[] = [];
  let firstParagraph = true;
  const flush = () => {
    if (!para.length) return;
    const text = plain(para.join(" "));
    para = [];
    if (!text) return;
    // 본문 첫 줄의 필자 표시(바이라인과 같은 글)는 뺀다
    if (firstParagraph && bylineKey && text.length <= 60 && (bylineKey.includes(text.replace(/\s/g, "")) || text.replace(/\s/g, "").includes(bylineKey))) {
      firstParagraph = false;
      return;
    }
    firstParagraph = false;
    blocks.push({ type: "paragraph", text });
  };

  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) {
      flush();
      continue;
    }
    const raw = lines[i]!;
    const t = raw.trim();
    if (!t) {
      flush();
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      flush();
      continue;
    }
    if (/^#\s+/.test(t)) {
      flush();
      continue;
    }
    const h = /^(#{2,3})\s+(.+)$/.exec(t);
    if (h) {
      flush();
      const text = plain(h[2]!);
      if (text === "본문") continue;
      blocks.push({ type: "heading", level: h[1]!.length === 3 || text.startsWith("※") ? 3 : 2, text });
      firstParagraph = false;
      continue;
    }
    if (t.startsWith("◇")) {
      flush();
      blocks.push({ type: "heading", level: 2, text: plain(t.replace(/^◇\s*/, "")) });
      firstParagraph = false;
      continue;
    }
    const boldOnly = /^\*\*(※[^*]+)\*\*$/.exec(t);
    if (boldOnly) {
      flush();
      blocks.push({ type: "heading", level: 3, text: plain(boldOnly[1]!) });
      firstParagraph = false;
      continue;
    }
    const img = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/.exec(t);
    if (img) {
      flush();
      firstParagraph = false;
      const path = safeImagePath(img[2]!);
      if (!path) {
        warnings.push(`그림 ${img[2]}은 결과물 묶음 안 경로가 아니라 뺐습니다`);
        continue;
      }
      let caption = "";
      let j = i + 1;
      while (j < lines.length && !lines[j]!.trim()) j++;
      if (j < lines.length && lines[j]!.trim().startsWith("▲")) {
        caption = plain(lines[j]!.trim());
        used.add(j);
      } else warnings.push(`그림 ${path}에 ▲ 캡션이 없습니다`);
      blocks.push({ type: "image", path, alt: plain(img[1]!), caption, aiGenerated: AI_RE.test(caption) });
      continue;
    }
    if (isTableRow(t)) {
      flush();
      firstParagraph = false;
      const rows: string[][] = [];
      for (; i < lines.length && isTableRow(lines[i]!.trim()); i++) {
        if (!isTableRule(lines[i]!)) rows.push(cells(lines[i]!));
      }
      i--;
      if (rows.length) blocks.push({ type: "table", rows });
      continue;
    }
    para.push(t);
  }
  flush();

  // 편집 메모
  const sources: { label: string; url: string }[] = [];
  const needsCheck: string[] = [];
  let thumbnail = "";
  let inCheck = false;
  for (const l of memoLines) {
    const t = l.trim();
    if (/^\[확인 필요\]$/.test(t)) {
      inCheck = true;
      continue;
    }
    if (/^\[[^\]]+\]$/.test(t) || /^#/.test(t)) inCheck = false;
    if (inCheck) {
      const item = /^(?:\d+[.)]|[-*])\s+(.+)$/.exec(t);
      if (item) needsCheck.push(plain(item[1]!));
      else if (t) inCheck = false;
    }
    const src = /^[-*]\s+(.+?)\s+(https?:\/\/\S+)\s*$/.exec(t);
    if (src) sources.push({ label: plain(src[1]!), url: src[2]! });
    const th = /^썸네일 파일명\s*[:：]\s*(\S+)/.exec(t);
    if (th) thumbnail = safeImagePath(th[1]!) ?? "";
  }

  return {
    section: one("섹션"),
    title,
    titleAlternatives,
    subtitle: (fields.get("부제") ?? []).map(plain).filter(Boolean).join(" / "),
    leadCaption: one("이미지 캡션"),
    byline,
    keywords,
    summary: one("요약"),
    blocks,
    memo: { text: memoLines.join("\n").trim(), sources, needsCheck, thumbnail },
    warnings,
  };
}
