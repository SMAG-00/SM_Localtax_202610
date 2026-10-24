// 옛 주소 정규형 (docs/dev/W9_설계.md 3장) — 같은 글의 여러 표기를 한 글자열로 모은다.
//  · 호스트(www·apex·http·https)는 떼고 경로 + 의미 있는 쿼리만 남긴다
//  · 기사: /news/articleView.html?idxno=N (N은 앞 0 없는 정수)
//  · 목록: /news/articleList.html?sc_section_code=S1Nx (쪽·정렬·보기 방식 쿼리는 뗀다) · 코드가 없으면 /news/articleList.html
//  · 그 밖의 경로: 끝의 '/' 뗀 경로만 (쿼리 버림)
//  proxy(apps/web/lib/site/legacy-redirect.ts)가 같은 규칙으로 찾는다 — 두 곳을 함께 고친다.

export function normalizeLegacyUrl(input) {
  if (typeof input !== "string") return null;
  let raw = input.trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw, "http://legacy.invalid");
  } catch {
    return null;
  }
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path.toLowerCase() === "/news/articleview.html") {
    const id = url.searchParams.get("idxno");
    if (!id || !/^[0-9]+$/.test(id)) return null;
    return `/news/articleView.html?idxno=${String(Number(id))}`;
  }
  if (path.toLowerCase() === "/news/articlelist.html") {
    const code = (url.searchParams.get("sc_section_code") ?? "").toUpperCase();
    if (!code) return "/news/articleList.html";
    return /^S[0-9]N[0-9]+$/.test(code) ? `/news/articleList.html?sc_section_code=${code}` : null;
  }
  const p = url.searchParams.get("p");
  if (path === "/" && p && /^[0-9]+$/.test(p)) return `/?p=${String(Number(p))}`; // 워드프레스 기본 주소
  return path;
}

/** 정규형 주소에서 기사 번호 */
export function articleIdOf(normalized) {
  const m = /^\/news\/articleView\.html\?idxno=([0-9]+)$/.exec(normalized ?? "");
  return m ? m[1] : null;
}

/** 기사 번호 → 정규형 주소 */
export const articleUrlOf = (id) => `/news/articleView.html?idxno=${String(Number(id))}`;
