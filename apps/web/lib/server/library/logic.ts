// 지식창고 순수 로직 (W13-a a3·a4) - 서버 전용 모듈에 의존하지 않아 단위 시험이 바로 읽는다.
//  · 조문 인용 자동 링크(LIB-01): "OO법 제N조(의M)" 모양만 찾아 검색 링크로 바꾼다. 조문 글을 만들거나 해석하지 않는다.
//    발행 당시 조문(기준일)이 있으면 링크에 asOf를 붙이고, 조문 버전이 DB에 없을 때의 안내는 화면이 한 줄로 보여 준다(문구는 설정 자리).
//  · 열람 속도 제한 키: 로그인이면 계정, 아니면 IP. 원문 IP를 기록에 남기지 않도록 해시한 앞부분만 쓴다.

export type Segment = { kind: "text"; text: string } | { kind: "cite"; text: string; href: string };

const CITE = /([가-힣A-Za-z0-9·]{2,30}법(?:\s?시행령|\s?시행규칙)?)\s?제(\d{1,4})조(?:의(\d{1,3}))?/g;

export function citationSegments(text: string, asOf?: string | null): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(CITE)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ kind: "text", text: text.slice(last, start) });
    const q = `${m[1]} 제${m[2]}조${m[3] ? `의${m[3]}` : ""}`;
    const params = new URLSearchParams({ q });
    if (asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf)) params.set("asOf", asOf);
    out.push({ kind: "cite", text: m[0], href: `/search?${params.toString()}` });
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** 문단 나누기 (빈 줄 기준) */
export function paragraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

/** 속도 제한 키 - 로그인이면 계정 번호, 아니면 IP 해시 앞부분 (IP 원문은 남기지 않는다) */
export async function rateKeyOf(userId: string | null, ip: string): Promise<string> {
  if (userId) return `u:${userId}`;
  const bytes = new TextEncoder().encode(`library:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `ip:${hex.slice(0, 24)}`;
}

/** library_read가 돌려주는 모양 */
export interface LibraryReadResult {
  ok: boolean;
  code: string;
  title?: string;
  tier?: "public" | "premium";
  full?: boolean;
  text?: string;
  locked?: boolean;
  reason?: "login" | "subscribe" | "sale_rights";
}

/** 응답에 실을 본문 - 잠긴 글은 미리보기만 (서버 함수가 이미 잘랐지만 한 번 더 비구독자 전문 요청을 거부한다) */
export function visibleText(r: LibraryReadResult): string | null {
  if (!r.ok || typeof r.text !== "string") return null;
  if (r.tier === "premium" && r.full !== true && r.locked !== true) return null;
  return r.text;
}
