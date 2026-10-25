// 기사 본문 블록 -> 읽을 글자 (ART-12 추출기 입력). 순수 모듈 - DB 함수 article_search_parts(마이그레이션 20)와 같은 규칙으로 글 칸만 모은다.
// 블록 종류·번호·주소·근거 참조 같은 값 칸은 뺀다. 문단의 링크 표기 [글](주소)는 글만 남긴다.
const SKIP_KEYS = new Set(["type", "kind", "template", "origin", "refId", "mediaId", "embedUrl", "thumbnailMediaId", "thumbnail", "rightsStatus", "credit", "license", "mediaAlt", "captions", "durationSeconds", "checklist"]);

function collect(v: unknown, out: string[]): void {
  if (typeof v === "string") out.push(v.replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, "$1"));
  else if (Array.isArray(v)) for (const x of v) collect(x, out);
  else if (v !== null && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!SKIP_KEYS.has(k)) collect(x, out);
}

export function articleBodyText(body: unknown): string {
  const blocks = (body as { blocks?: unknown } | null)?.blocks;
  if (!Array.isArray(blocks)) return "";
  const out: string[] = [];
  for (const b of blocks) collect(b, out);
  return out.join("\n");
}
