// 법령 주소 (LAW-04) - /law/<법령 이름 또는 번호>/<조>[-<가지>]?date=YYYY-MM-DD#p<항>. 순수 모듈.
export interface ArticleRef {
  no: number;
  branch: number;
}

export const articleSegment = (no: number, branch = 0) => (branch > 0 ? `${no}-${branch}` : `${no}`);

/** '11' -> {11, 0}, '11-2' -> {11, 2}. 형식 밖은 null */
export function parseArticleSegment(seg: string): ArticleRef | null {
  const m = /^([1-9]\d{0,3})(?:-([1-9]\d{0,2}))?$/.exec(seg);
  return m ? { no: Number(m[1]), branch: m[2] ? Number(m[2]) : 0 } : null;
}

/** 주소 한 칸(법령) - 번호면 번호, 아니면 이름 */
export function parseLawSegment(seg: string): { id: number } | { name: string } | null {
  let v: string;
  try {
    v = decodeURIComponent(seg);
  } catch {
    return null;
  }
  v = v.trim();
  if (v === "" || v.length > 100) return null;
  return /^[1-9]\d{0,15}$/.test(v) ? { id: Number(v) } : { name: v };
}

export interface LawHrefOpts {
  article?: ArticleRef;
  /** 기준일 - 사용자가 입력한 일자는 넣지 않는다(적용 기준일만) */
  date?: string | null;
  anchor?: string | null;
  extra?: Record<string, string>;
}

export function lawHref(lawName: string, opts: LawHrefOpts = {}): string {
  let path = `/law/${encodeURIComponent(lawName)}`;
  if (opts.article) path += `/${articleSegment(opts.article.no, opts.article.branch)}`;
  const q = new URLSearchParams();
  if (opts.date) q.set("date", opts.date);
  for (const [k, v] of Object.entries(opts.extra ?? {})) q.set(k, v);
  const qs = q.toString();
  return `${path}${qs ? `?${qs}` : ""}${opts.anchor ? `#${opts.anchor}` : ""}`;
}

export function lawThreeHref(lawName: string, date?: string | null, article?: ArticleRef): string {
  const q = new URLSearchParams();
  if (date) q.set("date", date);
  if (article) q.set("article", articleSegment(article.no, article.branch));
  const qs = q.toString();
  return `/law/${encodeURIComponent(lawName)}/three${qs ? `?${qs}` : ""}`;
}

export const articleLabel = (no: number, branch = 0) => (branch > 0 ? `제${no}조의${branch}` : `제${no}조`);
