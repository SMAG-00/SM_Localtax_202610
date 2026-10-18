// search_submitted 한 번만 (W2-c 2.2 · docs/dev/W2-d_설계.md 8장) — 순수 모듈 (시험 search-measure.test.ts). 브라우저 측정 컴포넌트가 쓴다.
//  · 같은 검색(검색어·거르개)에서 탭·쪽만 바꾸는 것은 새 검색이 아니다 — 주소(쿼리)에서 탭·쪽·빈 칸을 뺀 열쇠가 바로 앞과 같으면 보내지 않는다
//  · 열쇠에는 검색어가 들어 있지만 브라우저 메모리에만 있다 — 이벤트에는 넣지 않는다(이벤트 속성은 길이·수·참거짓뿐)

const NOT_A_NEW_SEARCH = new Set(["tab", "page"]);

/** 주소 쿼리(location.search) → 검색 한 번의 열쇠 */
export function searchMeasureKey(search: string): string {
  const params = new URLSearchParams(search);
  return [...params.entries()]
    .filter(([k, v]) => !NOT_A_NEW_SEARCH.has(k) && v !== "")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

/** 바로 앞에 보낸 검색과 다를 때만 보낸다 (문서 하나 안 — 새로 열면 처음부터) */
export function createSearchMeasure() {
  let last: string | null = null;
  return {
    shouldSend(search: string): boolean {
      const key = searchMeasureKey(search);
      if (key === last) return false;
      last = key;
      return true;
    },
  };
}
