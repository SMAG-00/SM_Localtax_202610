// 법령 본문 응답(JSON) → 조문 목록. 글자는 응답에서 옮길 뿐 만들어 내지 않는다 (PIPE-07).
// 응답 모양(법령 → 조문 → 조문단위, 한글 키)은 [확인 필요: 실응답 견본 계약 시험 통과 전까지 미확인] — 이 저장소의 시험 견본은 지어낸 값(시험용)이다.
// 모양이 다르면 ok=false로 돌려 호출자가 '조문 0건, 검수에서 확인'으로 표시한다(조용히 비우지 않는다).

export interface ParsedArticle {
  articleNo: number;
  branchNo: number;
  title: string | null;
  body: string;
  effectiveOn: string | null;
}

const asArray = <T>(v: T | T[] | undefined | null): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

function isoOrNull(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
}

function textOf(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join("\n");
  return "";
}

export function parseLawArticles(responseText: string): { ok: boolean; articles: ParsedArticle[] } {
  let root: unknown;
  try {
    root = JSON.parse(responseText);
  } catch {
    return { ok: false, articles: [] };
  }
  const units = (root as { 법령?: { 조문?: { 조문단위?: unknown } } } | null)?.법령?.조문?.조문단위;
  if (units === undefined) return { ok: false, articles: [] };
  const articles: ParsedArticle[] = [];
  const seen = new Set<string>();
  for (const unit of asArray(units as Record<string, unknown> | Record<string, unknown>[])) {
    if (!unit || typeof unit !== "object") continue;
    if (unit["조문여부"] === "전문") continue; // 장·절 제목 줄
    const no = Number(String(unit["조문번호"] ?? "").trim());
    const branchRaw = String(unit["조문가지번호"] ?? "").trim();
    const branch = branchRaw === "" ? 0 : Number(branchRaw);
    const body = textOf(unit["조문내용"]);
    if (!Number.isInteger(no) || no <= 0 || !Number.isInteger(branch) || branch < 0 || body === "") continue;
    const key = `${no}:${branch}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const title = textOf(unit["조문제목"]);
    articles.push({ articleNo: no, branchNo: branch, title: title || null, body, effectiveOn: isoOrNull(unit["조문시행일자"]) });
  }
  return { ok: true, articles };
}
